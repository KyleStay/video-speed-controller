import { execFileSync } from 'node:child_process';
import { getBuildDefines } from '../../../scripts/browser-config.mjs';
import { normalizeSpeedSetting } from '../../../src/utils/speed-limits.js';

function builtLimits(browser) {
  const script = `
    import { build } from 'esbuild';
    import { runInNewContext } from 'node:vm';
    const built = await build({
      stdin: {
        contents: "import * as limits from './src/utils/speed-limits.js'; globalThis.result = limits;",
        resolveDir: process.cwd(),
      },
      bundle: true, write: false, format: 'iife',
      define: ${JSON.stringify(getBuildDefines(browser))},
    });
    const context = {};
    runInNewContext(built.outputFiles[0].text, context);
    const limits = context.result;
    process.stdout.write(JSON.stringify({ ...limits, description: limits.speedRangeDescription() }));
  `;
  const result = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  );
  return { ...result, speedRangeDescription: () => result.description };
}

describe('browser-specific requested playback speed range', () => {
  it.each(['chrome', 'firefox'])('retains the existing %s range', async (browser) => {
    const { SPEED_LIMITS, SAFARI_SPEED_REQUESTS, speedRangeDescription } =
      await builtLimits(browser);
    expect(SPEED_LIMITS.MIN).toBe(0.07);
    expect(SPEED_LIMITS.MAX).toBe(16);
    expect(SAFARI_SPEED_REQUESTS).toBe(false);
    expect(speedRangeDescription()).toBe('between 0.07× and 16×');
  });

  it('caps Safari requests at 16 with the same advertised range', async () => {
    const { SPEED_LIMITS, SAFARI_SPEED_REQUESTS, speedRangeDescription } =
      await builtLimits('safari');
    expect(SPEED_LIMITS.MIN).toBe(0.07);
    expect(SPEED_LIMITS.MAX).toBe(16);
    expect(SAFARI_SPEED_REQUESTS).toBe(true);
    expect(speedRangeDescription()).toBe('between 0.07× and 16×');
  });
});

describe('legacy absolute speed normalization', () => {
  it('preserves null, valid rates and invalid values for ordinary validation', () => {
    expect(normalizeSpeedSetting('lastSpeed', 64)).toBe(16);
    expect(normalizeSpeedSetting('siteDefaultSpeed', 32)).toBe(16);
    for (const value of [null, undefined, 0.07, 1, 16, Infinity, -Infinity, '64']) {
      expect(normalizeSpeedSetting('lastSpeed', value)).toBe(value);
    }
    expect(normalizeSpeedSetting('lastSpeed', NaN)).toBeNaN();
  });

  it('lowers absolute binding and site-rule speeds without mutating input or other units', () => {
    const bindings = [
      { action: 'fast', value: 64 },
      { action: 'reset', value: 32 },
      { action: 'faster', value: 32 },
      { action: 'slower', value: 64 },
      { action: 'rewind', value: 64 },
      { action: 'advanceFrame', value: 120 },
    ];
    const rules = [
      { pattern: 'example.test', speed: 64 },
      { pattern: 'other.test', speed: null },
    ];
    expect(normalizeSpeedSetting('keyBindings', bindings).map((binding) => binding.value)).toEqual([
      16, 16, 32, 64, 64, 120,
    ]);
    expect(normalizeSpeedSetting('siteRules', rules).map((rule) => rule.speed)).toEqual([16, null]);
    expect(bindings[0].value).toBe(64);
    expect(rules[0].speed).toBe(64);
    expect(normalizeSpeedSetting('controllerButtonSize', 32)).toBe(32);
  });
});
