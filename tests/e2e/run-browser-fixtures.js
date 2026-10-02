#!/usr/bin/env node

import { launchFixtureBrowser } from './browser-runtime.js';
import { startFixtureServer } from './fixture-server.js';
import { runReliabilityChecks } from './reliability-checks.js';

const requested = process.argv.slice(2);
const browserNames =
  requested.length && !requested.includes('all') ? requested : ['chrome', 'firefox'];
if (browserNames.some((name) => !['chrome', 'firefox'].includes(name))) {
  throw new Error('Use chrome, firefox, or all');
}

const fixture = await startFixtureServer();
let activeBrowser = null;
let stopping = false;

async function cleanup() {
  if (stopping) {
    return;
  }
  stopping = true;
  try {
    await activeBrowser?.close();
    activeBrowser = null;
  } finally {
    await fixture.stop();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => cleanup().finally(() => process.exit(1)));
}

const summary = [];
try {
  for (const browserName of browserNames) {
    let passed = 0;
    let failed = 0;
    try {
      const launched = await launchFixtureBrowser(browserName);
      activeBrowser = launched.browser;
      console.log(
        `\nRunning deterministic ${browserName} fixtures (${await activeBrowser.version()})`
      );
      const runTest = async (testName, testFunction) => {
        try {
          console.log(`   🧪 ${testName}`);
          await testFunction();
          console.log(`   ✅ ${testName}`);
          passed++;
        } catch (error) {
          console.error(`   ❌ ${testName}: ${error.stack || error.message}`);
          failed++;
        }
      };
      await runReliabilityChecks(launched.page, runTest, {
        browserName,
        fixtureBaseUrl: fixture.baseUrl,
        mediaUrl: fixture.mediaUrl,
      });
    } catch (error) {
      console.error(`   💥 ${browserName} fixture setup failed: ${error.stack || error.message}`);
      failed++;
    } finally {
      await activeBrowser?.close();
      activeBrowser = null;
    }
    summary.push({ browser: browserName, passed, failed });
  }
} finally {
  await cleanup();
}

console.log(`\nBROWSER_FIXTURE_RESULT=${JSON.stringify(summary)}`);
process.exitCode = summary.some(({ failed }) => failed > 0) ? 1 : 0;
