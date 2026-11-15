import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageCandidate } from '../../../scripts/package-identity-candidate.mjs';

function retainedSafariResources() {
  const directory = 'dist/safari';
  if (!existsSync(directory)) {
    return null;
  }
  return readdirSync(directory, { recursive: true })
    .filter((name) => statSync(join(directory, name)).isFile())
    .sort()
    .map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(join(directory, name)))
        .digest('hex'),
    ]);
}

describe('Safari repository boundary', () => {
  it('rejects Safari resource builds before creating distribution output', () => {
    const retained = retainedSafariResources();
    const result = spawnSync(process.execPath, ['scripts/build.mjs', '--browser=safari'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Safari development moved');
    expect(retainedSafariResources()).toEqual(retained);
    expect(existsSync('apple')).toBe(false);
    expect(readFileSync('LICENSE', 'utf8')).toContain('MIT License');
  });

  it('rejects Safari candidate packaging before reading removed native identity inputs', async () => {
    await expect(packageCandidate({ browser: 'safari', mode: 'resources' })).rejects.toThrow(
      'Safari development moved'
    );
  });
});
