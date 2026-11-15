import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';

const root = process.cwd();

it('refuses an unsupported browser without changing its existing output', () => {
  mkdirSync(join(root, 'dist'), { recursive: true });
  const output = mkdtempSync(join(root, 'dist', 'unsupported-'));
  const sentinel = join(output, 'retained.txt');
  writeFileSync(sentinel, 'Keep this verified product.');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/build.mjs', `--browser=${basename(output)}`],
      { cwd: root, encoding: 'utf8' }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported browser');
    expect(readFileSync(sentinel, 'utf8')).toBe('Keep this verified product.');
  } finally {
    rmSync(output, { recursive: true });
  }
});
