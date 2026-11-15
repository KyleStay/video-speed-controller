#!/usr/bin/env node

/** Defaults to Chrome frames. Use firefox frames or all for the matrix. */
import { cleanupFixtureBrowsers, launchFixtureBrowser } from './browser-runtime.js';
import runFrameControls from './frame-controls.e2e.js';

const args = process.argv.slice(2);
if (args.some((argument) => !['chrome', 'firefox', 'frames', 'all'].includes(argument))) {
  throw new Error('Use [chrome|firefox|all] [frames].');
}
const matrix = args.includes('all');
const browsers = matrix
  ? ['chrome', 'firefox']
  : args.includes('firefox')
    ? ['firefox']
    : ['chrome'];
if (!matrix && args.includes('chrome') && args.includes('firefox')) {
  throw new Error('Use all to run both browsers.');
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () =>
    cleanupFixtureBrowsers().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  );
}

const results = [];
try {
  for (const browserName of browsers) {
    for (const [suite, run] of [['frames', runFrameControls]]) {
      console.log(`\nRunning ${browserName} ${suite} player controls`);
      try {
        const result = await run({
          browserName,
          launch: () => launchFixtureBrowser(browserName),
        });
        if (
          !Number.isInteger(result?.passed) ||
          result.passed < 1 ||
          !Number.isInteger(result?.failed) ||
          result.failed < 0
        ) {
          throw new Error('Player control suite did not return a valid nonempty test result.');
        }
        results.push({ browser: browserName, suite, ...result });
      } catch (error) {
        console.error(`${browserName} ${suite}: ${error.stack || error.message}`);
        results.push({ browser: browserName, suite, passed: 0, failed: 1 });
      } finally {
        // Suites close their fixture/browser; also cover launch/install or thrown cleanup failures.
        await cleanupFixtureBrowsers();
      }
    }
  }
} finally {
  await cleanupFixtureBrowsers();
}

console.log(`\nPLAYER_CONTROLS_RESULT=${JSON.stringify(results)}`);
process.exitCode = results.length === 0 || results.some(({ failed }) => failed > 0) ? 1 : 0;
