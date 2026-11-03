import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { expect, it, vi } from 'vitest';

const udid = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';

// Execute the actual runner with virtual OS/filesystem boundaries. No browser,
// simulator, network listener, process signal or real report is created.
async function nativeRun(termination) {
  const source = readFileSync('tests/safari-ios/run-media-profiles.mjs', 'utf8')
    .replace(/^#!.*\n/, '')
    .replace(/^import .*;\n/gm, '')
    .replaceAll(
      'import.meta.url',
      JSON.stringify(pathToFileURL(resolve('tests/safari-ios/run-media-profiles.mjs')).href)
    );
  const reports = [];
  const servers = [];
  const process = {
    argv: ['node', 'runner', '--udid', udid, '--case', 'loop-feed'],
    chdir: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
  const boundaries = {
    process,
    createHash,
    join,
    resolve,
    fileURLToPath,
    URL,
    console: { log: vi.fn(), error: vi.fn() },
    MEDIA_MOCK_CASES: [{ id: 'loop-feed', contract: 'recycled clip' }],
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    mkdtemp: vi.fn(async () => '/owned/native-run'),
    readFile: vi.fn(async () => Buffer.from('fixture')),
    readdir: vi.fn(async (_path, options) =>
      options?.withFileTypes
        ? [{ name: 'Fixture.swift', isDirectory: () => false, isFile: () => true }]
        : ['Fixture.swift', 'project.yml']
    ),
    writeFile: vi.fn(async (_path, bytes) => reports.push(JSON.parse(bytes))),
    createWriteStream: () =>
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    startFixtureServer: vi.fn(async () => {
      const server = { baseUrl: `http://127.0.0.1:${5000 + servers.length}`, stop: vi.fn() };
      servers.push(server);
      return server;
    }),
    spawn: (_command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        const closing = args.includes('terminate');
        if (closing && termination instanceof Error) {
          child.emit('error', termination);
          return;
        }
        let output = '';
        if (args.includes('devices'))
          {output = JSON.stringify({
            devices: { runtime: [{ udid, state: 'Booted', deviceTypeIdentifier: 'iPhone' }] },
          });}
        if (args.includes('test')) {output = 'NATIVE_PROFILE_PASS loop-feed observed';}
        if (args.includes('test-results'))
          {output = JSON.stringify({
            nodeType: 'Test Case',
            name: 'testLoopFeed()',
            result: 'Passed',
          });}
        child.stdout.end(output);
        child.stderr.end();
        child.emit('close', closing ? termination : 0);
      });
      return child;
    },
  };
  const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
    ...Object.keys(boundaries),
    source
  );
  await execute(...Object.values(boundaries));
  return { report: reports.at(-1), process, servers };
}

it('retains passing native evidence only after successful owned Safari cleanup', async () => {
  const { report, process, servers } = await nativeRun(0);
  expect(report.cases[0].status).toBe('passed');
  expect(report.status).toBe('passed');
  expect(report.cleanup.safari).toBe('terminated');
  expect(process.exitCode).toBe(0);
  expect(servers).toHaveLength(2);
  servers.forEach((server) => expect(server.stop).toHaveBeenCalledOnce());
});

it.each([1, new Error('Simulator service unavailable')])(
  'retains a finished failed report when Safari cleanup fails (%s)',
  async (termination) => {
    const { report, process, servers } = await nativeRun(termination);
    expect(report.cases[0].status).toBe('passed');
    expect(report.status).toBe('failed');
    expect(report.cleanup.safari).toBe('termination-failed');
    expect(report.finishedAt).toEqual(expect.any(String));
    if (termination instanceof Error)
      {expect(report.cleanup.safariError).toContain(termination.message);}
    else {expect(report.cleanup.safariExitCode).toBe(termination);}
    expect(process.exitCode).toBe(1);
    servers.forEach((server) => expect(server.stop).toHaveBeenCalledOnce());
  }
);
