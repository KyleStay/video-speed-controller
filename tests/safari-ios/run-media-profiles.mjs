#!/usr/bin/env node
/** Native Safari acceptance on an explicitly selected disposable iPhone simulator. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from '../e2e/fixture-server.js';
import { MEDIA_MOCK_CASES } from '../e2e/media-mock-fixture.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (!['--udid', '--app', '--case', '--output-root'].includes(name) || !process.argv[i + 1]) {
    throw new Error(
      'Use --udid <disposable-simulator> [--app <built-app>] [--case <profile-id>] [--output-root <folder>]'
    );
  }
  flags.set(name, process.argv[i + 1]);
}
const udid = flags.get('--udid');
if (!/^[\dA-F-]{36}$/i.test(udid || ''))
  throw new Error('An explicit simulator --udid is required');
const selected = flags.get('--case');
if (selected && !MEDIA_MOCK_CASES.some(({ id }) => id === selected))
  throw new Error('Unknown neutral profile ID');
const parent = resolve(flags.get('--output-root') || 'test-results/iphone-media-profiles');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'run-'));
const report = {
  startedAt: new Date().toISOString(),
  status: 'running',
  selection: selected || 'all',
  udid,
  output,
  scope: 'iPhone simulator Safari; generated local media; genuine native UI input',
  cases: MEDIA_MOCK_CASES.map(({ id, contract }) => ({ id, contract, status: 'unrun' })),
  incomplete: ['Physical iPhone', 'Acoustic output', 'AirPlay receiver', 'Live HLS transport'],
  cleanup: {},
};
const save = () => writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
await save();
console.log('Native profile evidence: ' + output);
let activeChild;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  activeChild?.kill('SIGINT');
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
async function run(command, args, name) {
  if (interrupted && name !== 'close-fixture') throw new Error('Native run interrupted');
  const log = createWriteStream(join(output, name + '.log'));
  return await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = child;
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      log.write(chunk);
    });
    child.stderr.pipe(log, { end: false });
    child.once('error', (error) => {
      activeChild = null;
      log.end();
      reject(error);
    });
    child.once('close', (code) => {
      activeChild = null;
      log.end();
      accept({ code, stdout });
    });
  });
}
async function checked(command, args, name) {
  const result = await run(command, args, name);
  if (result.code !== 0) throw new Error(`${name} exited ${result.code}; see ${name}.log`);
  return result.stdout;
}
async function hashes(folder, base = folder, result = {}) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await hashes(path, base, result);
    else if (entry.isFile())
      result[path.slice(base.length + 1)] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  return result;
}
let primary,
  secondary,
  fixtureOpened = false;
try {
  const inventory = JSON.parse(
    await checked('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], 'simulators')
  );
  const candidates = Object.entries(inventory.devices).flatMap(([runtime, devices]) =>
    devices.map((device) => ({ ...device, runtime }))
  );
  const device = candidates.find((item) => item.udid === udid);
  if (!device || !device.deviceTypeIdentifier?.includes('iPhone') || device.state !== 'Booted') {
    throw new Error(
      'Select an already booted disposable iPhone simulator; this runner never boots or erases devices'
    );
  }
  report.device = device;
  if (flags.has('--app')) {
    const app = resolve(flags.get('--app'));
    report.app = { path: app, sha256: await hashes(app) };
    await checked('xcrun', ['simctl', 'install', udid, app], 'install');
  }
  const qa = join(output, 'qa');
  await mkdir(qa);
  const qaSource = join(root, 'tests/safari-ios');
  for (const name of await readdir(qaSource)) {
    if (name.endsWith('.swift') || name === 'project.yml')
      await copyFile(join(qaSource, name), join(qa, name));
  }
  report.qaInputs = await hashes(qa);
  report.fixtureInputs = Object.fromEntries(
    await Promise.all(
      [
        'fixture-server.js',
        'media-mock-fixture.js',
        'media-profile-fixture.js',
        'media-native-probe.js',
        'media-mocks.html',
        'media-mock-entry.js',
      ].map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(join(root, 'tests/e2e', name)))
          .digest('hex'),
      ])
    )
  );
  await checked('xcodegen', ['generate', '--spec', join(qa, 'project.yml')], 'xcodegen');
  primary = await startFixtureServer();
  secondary = await startFixtureServer();
  const url = new URL('/media-mocks.html', primary.baseUrl);
  url.search = new URLSearchParams({
    case: 'loop-feed',
    mp4: '',
    'native-qa': '',
    run: output.split('/').pop(),
    framePort: new URL(secondary.baseUrl).port,
  });
  report.origins = [primary.baseUrl, secondary.baseUrl];
  await checked('xcrun', ['simctl', 'openurl', udid, url.href], 'open-local-fixture');
  fixtureOpened = true;
  await save();
  const only = selected
    ? 'test' +
      selected
        .split('-')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
    : '';
  const resultBundle = join(output, 'profiles.xcresult');
  const result = await run(
    'xcodebuild',
    [
      '-project',
      join(qa, 'StayFastSafariQA.xcodeproj'),
      '-scheme',
      'StayFastSafariQA',
      '-destination',
      `platform=iOS Simulator,id=${udid}`,
      '-parallel-testing-enabled',
      'NO',
      '-derivedDataPath',
      join(qa, 'DerivedData'),
      '-resultBundlePath',
      resultBundle,
      '-test-timeouts-enabled',
      'YES',
      '-default-test-execution-time-allowance',
      '300',
      '-maximum-test-execution-time-allowance',
      '360',
      '-collect-test-diagnostics',
      'never',
      '-only-testing:StayFastSafariQATests/MediaProfileQATests' + (only ? '/' + only : ''),
      'test',
    ],
    'xcodebuild'
  );
  report.xcodebuildExit = result.code;
  const tests = JSON.parse(
    await checked(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle],
      'test-results'
    )
  );
  const flat = [];
  const visit = (node) => {
    if (node && typeof node === 'object') {
      flat.push(node);
      Object.values(node).forEach((value) =>
        Array.isArray(value) ? value.forEach(visit) : visit(value)
      );
    }
  };
  visit(tests);
  for (const row of report.cases) {
    const method =
      'test' +
      row.id
        .split('-')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('');
    const leaf = flat.find(
      (node) =>
        node.nodeType === 'Test Case' &&
        (node.name === method + '()' || node.nodeIdentifier?.endsWith('/' + method + '()'))
    );
    const passed =
      leaf?.result === 'Passed' && result.stdout.includes('NATIVE_PROFILE_PASS ' + row.id + ' ');
    row.status = passed ? 'passed' : leaf ? 'failed' : 'unrun';
    if (leaf) row.nativeResult = leaf;
    console.log(`${row.id}: ${row.status}`);
  }
  await checked(
    'xcrun',
    [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      resultBundle,
      '--output-path',
      join(output, 'attachments'),
    ],
    'export-attachments'
  );
  report.status =
    report.cases
      .filter(({ id }) => !selected || selected === id)
      .every(({ status }) => status === 'passed') && result.code === 0
      ? 'passed'
      : 'failed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack || String(error);
  console.error(error.message);
} finally {
  for (const [name, server] of [
    ['primary', primary],
    ['secondary', secondary],
  ]) {
    if (!server) continue;
    try {
      await server.stop();
      report.cleanup[name] = 'stopped';
    } catch (error) {
      report.cleanup[name] = error.message;
      report.status = 'failed';
    }
  }
  if (fixtureOpened) {
    try {
      const close = await run(
        'xcrun',
        ['simctl', 'terminate', udid, 'com.apple.mobilesafari'],
        'close-fixture'
      );
      report.cleanup.safariExitCode = close.code;
      report.cleanup.safari = close.code === 0 ? 'terminated' : 'termination-failed';
      if (close.code !== 0) report.status = 'failed';
    } catch (error) {
      report.cleanup.safari = 'termination-failed';
      report.cleanup.safariError = error.message;
      report.status = 'failed';
    }
  } else {
    report.cleanup.safari = 'no fixture opened';
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  report.finishedAt = new Date().toISOString();
  await save();
}
process.exitCode = report.status === 'passed' ? 0 : 1;
