import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packageCandidate } from '../../../scripts/package-identity-candidate.mjs';

describe('Safari repository boundary', () => {
  it('rejects Safari resource builds before creating distribution output', () => {
    const result = spawnSync(process.execPath, ['scripts/build.mjs', '--browser=safari'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Safari development moved');
    expect(existsSync('dist/safari')).toBe(false);
    expect(existsSync('apple')).toBe(false);
    expect(readFileSync('LICENSE', 'utf8')).toContain('MIT License');
  });

  it('rejects Safari candidate packaging before reading removed native identity inputs', async () => {
    await expect(packageCandidate({ browser: 'safari', mode: 'resources' })).rejects.toThrow(
      'Safari development moved'
    );
  });
});
