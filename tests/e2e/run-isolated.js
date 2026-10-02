/** macOS browser verification through the disposable Chrome skill runner. */
import puppeteer from 'puppeteer';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import runBasic from './basic.e2e.js';
import runYouTube from './youtube.e2e.js';

const execFileAsync = promisify(execFile);
const runner =
  process.env.STAYFAST_CHROME_RUNNER ||
  join(homedir(), '.codex/skills/chrome-extension-test-runner/scripts/launch_test_chrome.py');
const suites = { basic: runBasic, youtube: runYouTube };
const externalSuites = {
  fixtures: ['tests/e2e/run-browser-fixtures.js', 'all'],
  'fixtures-chrome': ['tests/e2e/run-browser-fixtures.js', 'chrome'],
  'fixtures-firefox': ['tests/e2e/run-browser-fixtures.js', 'firefox'],
  benchmarks: ['tests/e2e/run-performance-benchmark.js'],
};
const names = process.argv.slice(2);
if (!names.length) {
  names.push('basic', 'youtube');
}
if (names.some((name) => name !== 'cleanup' && !suites[name] && !externalSuites[name])) {
  throw new Error('Use basic, youtube, fixtures, and/or benchmarks');
}

const needsBrowserBuilds = names.some((name) => externalSuites[name]);
if (needsBrowserBuilds) {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/build.mjs', '--all'], {
    env: { ...process.env, RELEASE: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
const extensionDirectory = resolve(needsBrowserBuilds ? 'dist/chrome' : 'dist');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let owned = null;
let cleaning = null;

async function processTree(pid) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=']);
  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const pids = new Set([pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [child, parent] of rows) {
      if (pids.has(parent) && !pids.has(child)) {
        pids.add(child);
        grew = true;
      }
    }
  }
  return pids;
}

async function profileProcesses(profile) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  return stdout
    .split('\n')
    .filter((line) => line.includes(`--user-data-dir=${profile}`))
    .map((line) => Number(line.trim().split(/\s+/, 1)[0]));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
    return false;
  }
}

async function cleanup() {
  if (!owned) {
    return;
  }
  if (cleaning) {
    return cleaning;
  }
  cleaning = (async () => {
    const { browser, profile, pid } = owned;
    const pids = new Set(owned.pids || []);
    if (pid && isAlive(pid)) {
      for (const child of await processTree(pid)) {
        pids.add(child);
      }
    }
    // The launcher may fail after spawning Chrome but before returning JSON.
    // Recover only processes carrying this run's unique disposable profile.
    const profilePids = await profileProcesses(profile);
    for (const profilePid of profilePids) {
      for (const child of await processTree(profilePid)) {
        pids.add(child);
      }
    }
    if (browser) {
      try {
        const session = await browser.target().createCDPSession();
        await session.send('Browser.close');
      } catch {
        // Suites may already have closed the browser in their finally block.
      }
    }
    if (!browser) {
      for (const profilePid of profilePids) {
        if (isAlive(profilePid)) {
          process.kill(profilePid, 'SIGTERM');
        }
      }
    }
    for (let attempt = 0; attempt < 30 && [...pids].some(isAlive); attempt++) {
      await sleep(100);
    }
    // A connected Browser.close can return while native Chrome is shutting
    // down. Terminate only this run's recorded process tree if it stays alive.
    for (const ownedPid of [...pids].reverse()) {
      if (isAlive(ownedPid)) {
        process.kill(ownedPid, 'SIGTERM');
      }
    }
    for (let attempt = 0; attempt < 100 && [...pids].some(isAlive); attempt++) {
      await sleep(50);
    }
    const surviving = [...pids].filter(isAlive);
    if (surviving.length) {
      throw new Error(`Chrome PIDs ${surviving.join(', ')} remain; retain ${profile}`);
    }
    await rm(profile, { recursive: true, force: true });
    console.log('Cleanup verified: 0 owned Chrome PIDs, 0 disposable profiles');
    owned = null;
  })();
  try {
    await cleaning;
  } finally {
    cleaning = null;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => cleanup().finally(() => process.exit(1)));
}

async function runExternal(script, arguments_) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...arguments_], { stdio: 'inherit' });
    const stopChild = () => child.kill('SIGTERM');
    process.once('SIGINT', stopChild);
    process.once('SIGTERM', stopChild);
    const removeSignals = () => {
      process.off('SIGINT', stopChild);
      process.off('SIGTERM', stopChild);
    };
    child.once('error', (error) => {
      removeSignals();
      rejectRun(error);
    });
    child.once('exit', (code, signal) => {
      removeSignals();
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${script} failed (${signal || code})`));
      }
    });
  });
}

let failed = 0;
for (const name of names) {
  try {
    if (name === 'cleanup') {
      const profile = resolve(process.env.STAYFAST_CLEANUP_PROFILE || '');
      if (
        dirname(profile) !== resolve(tmpdir()) ||
        !/^stayfast-browser-qa-[\w-]+$/.test(basename(profile))
      ) {
        throw new Error(
          'Cleanup requires an exact generated disposable profile in the temporary directory'
        );
      }
      owned = { profile };
      await cleanup();
      continue;
    }
    if (externalSuites[name]) {
      const [script, ...arguments_] = externalSuites[name];
      await runExternal(script, arguments_);
      continue;
    }
    const result = await suites[name]({
      launch: async () => {
        const profile = await mkdtemp(join(tmpdir(), 'stayfast-browser-qa-'));
        owned = { profile };
        const { stdout } = await execFileAsync(
          'python3',
          [runner, '--extension', extensionDirectory, '--profile', profile, '--url', 'about:blank'],
          { timeout: 30000 }
        );
        const info = JSON.parse(stdout);
        owned.pid = info.pid;
        if (!info.debugger_ready || !info.extension_loaded) {
          throw new Error(`Extension failed to load; inspect ${info.log_file}`);
        }
        console.log(`Disposable Chrome ${info.pid}, extension ${info.extension_id}`);
        const browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${info.debug_port}`,
          protocolTimeout: 30000,
        });
        owned.browser = browser;
        owned.pids = await processTree(info.pid);
        const close = browser.close.bind(browser);
        browser.close = async () => {
          if (isAlive(info.pid)) {
            owned.pids = await processTree(info.pid);
          }
          await close();
        };
        const page = (await browser.pages())[0] || (await browser.newPage());
        await page.setViewport({ width: 1280, height: 800 });
        page.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
        return { browser, page };
      },
    });
    failed += result.failed;
  } catch (error) {
    failed++;
    console.error(`${name}: ${error.stack || error.message}`);
  } finally {
    await cleanup();
  }
}
process.exitCode = failed ? 1 : 0;
