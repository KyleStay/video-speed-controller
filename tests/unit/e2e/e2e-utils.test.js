import { describe, expect, it } from 'vitest';
import { getChromeLaunchArgs } from '../../e2e/e2e-utils.js';

describe('E2E Chrome launch arguments', () => {
  it('enables the no-sandbox fallback only on Linux CI', () => {
    expect(getChromeLaunchArgs({ ci: 'true', platform: 'linux' })).toEqual(
      expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox'])
    );
    expect(getChromeLaunchArgs({ ci: 'false', platform: 'linux' })).not.toContain('--no-sandbox');
    expect(getChromeLaunchArgs({ ci: 'true', platform: 'darwin' })).not.toContain('--no-sandbox');
  });
});
