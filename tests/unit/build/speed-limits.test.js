import { execFileSync } from 'node:child_process';
import { getBuildDefines } from '../../../scripts/browser-config.mjs';

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

  it('allows Safari rates above 16 without overflowing native Float transport', async () => {
    const { SPEED_LIMITS, SAFARI_SPEED_REQUESTS, speedRangeDescription } =
      await builtLimits('safari');
    expect(SPEED_LIMITS.MIN).toBe(0.07);
    expect(SPEED_LIMITS.MAX).toBeGreaterThan(64);
    expect(Number.isFinite(Math.fround(SPEED_LIMITS.MAX))).toBe(true);
    expect(Math.fround(SPEED_LIMITS.MAX * 1.000001)).toBe(Infinity);
    expect(SAFARI_SPEED_REQUESTS).toBe(true);
    expect(speedRangeDescription()).toBe('at least 0.07×');
  });
});
