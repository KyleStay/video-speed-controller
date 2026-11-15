import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeletionOnlyPush } from '../../../scripts/pre-push-check.mjs';

const zero = '0'.repeat(40);
const sha = 'a'.repeat(40);
const deletion = `(delete) ${zero} refs/heads/stale ${sha}\n`;
const update = `refs/heads/main ${sha} refs/heads/main ${sha}\n`;
const temporary = [];

afterEach(() => temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true })));

describe('pre-push checks', () => {
  it.each([
    deletion,
    deletion + deletion,
    deletion.replaceAll(zero, '0'.repeat(64)).replaceAll(sha, 'b'.repeat(64)),
  ])('skips checks only for valid deletion-only input', (input) =>
    expect(isDeletionOnlyPush(input)).toBe(true)
  );

  it.each([
    update,
    deletion + update,
    update + deletion,
    '',
    '\n',
    `${deletion}\n`,
    deletion.replace('(delete)', 'refs/heads/stale'),
    deletion.replace(zero, '0'),
    deletion.replace(sha, zero),
    deletion.replace(sha, 'z'.repeat(40)),
    deletion.replace('refs/heads/stale', 'refs/heads/stale..bad'),
    `${deletion.trim()} extra\n`,
  ])('retains checks for updates, mixed pushes and malformed input', (input) => {
    expect(isDeletionOnlyPush(input)).toBe(false);
  });

  it.each([
    [deletion, ''],
    [update, 'run lint\ntest\n'],
    [deletion + update, 'run lint\ntest\n'],
    ['', 'run lint\ntest\n'],
    ['malformed\n', 'run lint\ntest\n'],
  ])('executes the hook with safe checks for %j', (input, expected) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stayfast-pre-push-'));
    temporary.push(directory);
    const log = path.join(directory, 'npm.log');
    writeFileSync(log, '');
    writeFileSync(
      path.join(directory, 'npm'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PRE_PUSH_TEST_LOG"\n',
      { mode: 0o755 }
    );
    const result = spawnSync('sh', ['-e', '.husky/pre-push'], {
      cwd: process.cwd(),
      input,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PRE_PUSH_TEST_LOG: log },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe(expected);
  });
});
