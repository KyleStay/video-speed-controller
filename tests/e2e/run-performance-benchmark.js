#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { launchFixtureBrowser } from './browser-runtime.js';
import { monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const SCENARIOS = ['media-less-churn', 'media-heavy-feed', 'same-origin-frames'];
const requestedRepetitions = Number(process.env.STAYFAST_BENCHMARK_REPETITIONS || 3);
const REPETITIONS = Number.isInteger(requestedRepetitions)
  ? Math.min(10, Math.max(1, requestedRepetitions))
  : 3;
const NATIVE_METRICS = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'JSHeapUsedSize',
  'Nodes',
  'Documents',
  'Frames',
  'JSEventListeners',
];

function subtractMetrics(after, before) {
  return Object.fromEntries(
    NATIVE_METRICS.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)])
  );
}

async function readNativeMetrics(session) {
  const { metrics } = await session.send('Performance.getMetrics');
  const available = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
  return Object.fromEntries(NATIVE_METRICS.map((name) => [name, available[name] ?? null]));
}

async function collectExtensionTelemetry(page) {
  const samples = [];
  for (const frame of page.frames()) {
    try {
      samples.push(
        await frame.evaluate(() => {
          const observer = window.VSC_controller?.mutationObserver;
          const stats = observer?.mutationStats || {};
          return {
            url: location.href,
            initialized: Boolean(window.VSC_controller?.initialized),
            controlled: window.VSC?.stateManager?.getControlledElements?.().length || 0,
            pendingWork:
              typeof observer?.getPendingWorkCount === 'function'
                ? observer.getPendingWorkCount()
                : observer?.pendingMutations?.length || 0,
            mutationStats: {
              queued: stats.queued || 0,
              processed: stats.processed || 0,
              coalesced: stats.coalesced || 0,
              slices: stats.slices || 0,
              maxSliceMs: stats.maxSliceMs || 0,
              maxQueueSize: stats.maxQueueSize || 0,
            },
          };
        })
      );
    } catch {
      // Cross-origin frames are intentionally excluded from this local fixture.
    }
  }
  return samples;
}

async function waitForScenario(page, scenario, enabled, expectedMedia) {
  if (scenario === 'media-less-churn') {
    if (enabled) {
      await page.waitForFunction(
        () => window.VSC_controller.mutationObserver.getPendingWorkCount() === 0
      );
    }
    return;
  }

  if (scenario === 'media-heavy-feed') {
    await page.waitForFunction(
      (count, extensionEnabled) => {
        const videos = [...document.querySelectorAll('video')];
        const nativeReady = videos.filter((video) => video.readyState >= 2).length;
        if (nativeReady !== count) {
          return false;
        }
        if (!extensionEnabled) {
          return true;
        }
        return (
          videos.every((video) => video.vsc?.div.isConnected) &&
          window.VSC_controller.mutationObserver.getPendingWorkCount() === 0
        );
      },
      { timeout: 30000 },
      expectedMedia,
      enabled
    );
    return;
  }

  await page.waitForFunction(
    (count, extensionEnabled) => {
      const frames = [...document.querySelectorAll('iframe')];
      if (frames.length !== count) {
        return false;
      }
      return frames.every((frame) => {
        const child = frame.contentWindow;
        const video = frame.contentDocument?.querySelector('video');
        return (
          video?.readyState >= 2 &&
          (!extensionEnabled ||
            (video.vsc?.div.isConnected &&
              child.VSC_controller?.mutationObserver?.getPendingWorkCount() === 0))
        );
      });
    },
    { timeout: 30000 },
    expectedMedia,
    enabled
  );
}

async function runScenario(page, scenario, { enabled, fixture, session }) {
  await page.goto(`${fixture.baseUrl}/fixture.html?scenario=${scenario}&enabled=${enabled}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.VSC_controller?.mutationObserver?.observer);
  if (scenario === 'same-origin-frames') {
    await page.evaluate(
      ({ count, baseUrl }) => {
        const root = document.querySelector('main');
        for (let index = 0; index < count; index++) {
          const frame = document.createElement('iframe');
          frame.src = `${baseUrl}/frame.html?empty=${index}`;
          root.append(frame);
        }
      },
      { count: 8, baseUrl: fixture.baseUrl }
    );
    await page.waitForFunction(
      (count) => {
        const frames = [...document.querySelectorAll('iframe')];
        return (
          frames.length === count &&
          frames.every((frame) => frame.contentWindow?.VSC_controller?.mutationObserver?.observer)
        );
      },
      {},
      8
    );
  }
  if (!enabled) {
    await page.evaluate(() => {
      const documents = [
        document,
        ...[...document.querySelectorAll('iframe')].map((frame) => frame.contentDocument),
      ];
      for (const ownerDocument of documents) {
        ownerDocument.documentElement.dispatchEvent(
          new ownerDocument.defaultView.CustomEvent('VSC_MESSAGE', {
            detail: { type: 'VSC_TEARDOWN' },
          })
        );
      }
    });
    await page.waitForFunction(
      () =>
        !window.VSC_controller.initialized &&
        [...document.querySelectorAll('iframe')].every(
          (frame) => !frame.contentWindow.VSC_controller.initialized
        )
    );
  }

  await session.send('HeapProfiler.collectGarbage');
  const before = await readNativeMetrics(session);
  await page.evaluate(() => {
    window.__stayfastBenchmark = {
      attachmentLatenciesMs: [],
      eventLoopDelaysMs: [],
      longTaskDurationMs: 0,
      longTaskCount: 0,
      startedAt: performance.now(),
      expectedTick: performance.now() + 10,
    };
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      window.__stayfastBenchmark.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__stayfastBenchmark.longTaskCount++;
          window.__stayfastBenchmark.longTaskDurationMs += entry.duration;
        }
      });
      window.__stayfastBenchmark.longTaskObserver.observe({ entryTypes: ['longtask'] });
    }
    window.__stayfastBenchmark.queueTimer = setInterval(() => {
      const now = performance.now();
      window.__stayfastBenchmark.eventLoopDelaysMs.push(
        Math.max(0, now - window.__stayfastBenchmark.expectedTick)
      );
      window.__stayfastBenchmark.expectedTick = now + 10;
    }, 10);
    window.__stayfastBenchmark.attachmentObserver = new MutationObserver(() => {
      for (const media of document.querySelectorAll('video[data-appended-at]')) {
        if (media.vsc?.div.isConnected && !media.dataset.attachedAt) {
          media.dataset.attachedAt = String(performance.now());
          window.__stayfastBenchmark.attachmentLatenciesMs.push(
            Number(media.dataset.attachedAt) - Number(media.dataset.appendedAt)
          );
        }
      }
    });
    window.__stayfastBenchmark.attachmentObserver.observe(document, {
      childList: true,
      subtree: true,
    });
  });

  let expectedMedia = 0;
  if (scenario === 'media-less-churn') {
    await page.evaluate(async () => {
      const root = document.querySelector('main');
      for (let round = 0; round < 20; round++) {
        const batch = document.createElement('section');
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 200; index++) {
          const node = document.createElement('span');
          node.className = `churn-${round % 4}`;
          node.textContent = String(index);
          fragment.append(node);
        }
        batch.append(fragment);
        root.append(batch);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
        batch.remove();
      }
    });
  } else if (scenario === 'media-heavy-feed') {
    expectedMedia = 24;
    await page.evaluate(
      async ({ mediaUrl }) => {
        const root = document.querySelector('main');
        for (let round = 0; round < 4; round++) {
          for (let offset = 0; offset < 8; offset++) {
            const index = round * 8 + offset;
            const article = document.createElement('article');
            const video = document.createElement('video');
            video.muted = true;
            video.preload = 'auto';
            video.dataset.appendedAt = String(performance.now());
            video.src = `${mediaUrl}?feed=${index}`;
            article.append(video);
            root.append(article);
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
          [...root.querySelectorAll('article')].slice(0, 2).forEach((article) => article.remove());
        }
      },
      { mediaUrl: fixture.mediaUrl }
    );
  } else {
    expectedMedia = 8;
    await page.evaluate(
      async ({ mediaUrl }) => {
        const frames = [...document.querySelectorAll('iframe')];
        for (const [index, frame] of frames.entries()) {
          const child = frame.contentWindow;
          const childDocument = frame.contentDocument;
          child.__stayfastFrameBenchmark = { appendedAt: child.performance.now(), latencyMs: null };
          const attachmentObserver = new child.MutationObserver(() => {
            const video = childDocument.querySelector('video');
            if (video?.vsc?.div.isConnected && child.__stayfastFrameBenchmark.latencyMs === null) {
              child.__stayfastFrameBenchmark.latencyMs =
                child.performance.now() - child.__stayfastFrameBenchmark.appendedAt;
              attachmentObserver.disconnect();
            }
          });
          attachmentObserver.observe(childDocument, { childList: true, subtree: true });
          const video = childDocument.createElement('video');
          video.muted = true;
          video.preload = 'auto';
          video.src = `${mediaUrl}?frame=${index}`;
          childDocument.querySelector('main').append(video);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
        }
      },
      { mediaUrl: fixture.mediaUrl }
    );
  }

  await waitForScenario(page, scenario, enabled, expectedMedia);
  if (scenario === 'same-origin-frames' && enabled) {
    await page.evaluate(() => {
      for (const frame of document.querySelectorAll('iframe')) {
        window.__stayfastBenchmark.attachmentLatenciesMs.push(
          frame.contentWindow.__stayfastFrameBenchmark.latencyMs
        );
      }
    });
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));

  const browserTelemetry = await page.evaluate(() => {
    const benchmark = window.__stayfastBenchmark;
    clearInterval(benchmark.queueTimer);
    benchmark.longTaskObserver?.disconnect();
    benchmark.attachmentObserver.disconnect();
    const delays = benchmark.eventLoopDelaysMs;
    const sortedDelays = [...delays].sort((left, right) => left - right);
    const percentile = (fraction) =>
      sortedDelays.length
        ? sortedDelays[
            Math.min(sortedDelays.length - 1, Math.floor(sortedDelays.length * fraction))
          ]
        : null;
    return {
      wallDurationMs: performance.now() - benchmark.startedAt,
      longTaskCount: benchmark.longTaskCount,
      longTaskDurationMs: benchmark.longTaskDurationMs,
      eventLoopDelay: {
        samples: delays.length,
        maxMs: sortedDelays.at(-1) ?? null,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
      },
      attachmentLatenciesMs: benchmark.attachmentLatenciesMs,
      nativePlayableMedia: [
        ...document.querySelectorAll('video'),
        ...[...document.querySelectorAll('iframe')].flatMap((frame) => [
          ...(frame.contentDocument?.querySelectorAll('video') || []),
        ]),
      ].filter((video) => video.readyState >= 2).length,
    };
  });
  const afterWork = await readNativeMetrics(session);
  const extensionTelemetry = await collectExtensionTelemetry(page);

  await page.evaluate(() => {
    const documents = [
      document,
      ...[...document.querySelectorAll('iframe')].map((frame) => frame.contentDocument),
    ];
    window.__stayfastRetainedRefs = documents.map((ownerDocument) => ({
      observer: ownerDocument.defaultView.VSC_controller?.mutationObserver,
      eventManager: ownerDocument.defaultView.VSC_controller?.eventManager,
    }));
    for (const ownerDocument of documents) {
      if (ownerDocument.defaultView.VSC_controller?.initialized) {
        ownerDocument.documentElement.dispatchEvent(
          new ownerDocument.defaultView.CustomEvent('VSC_MESSAGE', {
            detail: { type: 'VSC_TEARDOWN' },
          })
        );
      }
    }
  });
  await page.waitForFunction(() => {
    const media = [...document.querySelectorAll('video')];
    const frameMedia = [...document.querySelectorAll('iframe')].flatMap((frame) => [
      ...(frame.contentDocument?.querySelectorAll('video') || []),
    ]);
    return (
      !window.VSC_controller.initialized &&
      [...document.querySelectorAll('iframe')].every(
        (frame) => !frame.contentWindow.VSC_controller.initialized
      ) &&
      [...media, ...frameMedia].every((element) => !element.vsc) &&
      document.querySelectorAll('.vsc-controller').length === 0 &&
      [...document.querySelectorAll('iframe')].every(
        (frame) => frame.contentDocument?.querySelectorAll('.vsc-controller').length === 0
      )
    );
  });
  await session.send('HeapProfiler.collectGarbage');
  const afterTeardown = await readNativeMetrics(session);
  const retainedControllers = await page.evaluate(() => {
    const documents = [
      document,
      ...[...document.querySelectorAll('iframe')].map((frame) => frame.contentDocument),
    ];
    const media = documents.flatMap((owner) => [...(owner?.querySelectorAll('video,audio') || [])]);
    return {
      stateEntries: documents.reduce(
        (total, owner) => total + (owner?.defaultView?.VSC?.stateManager?.controllers?.size || 0),
        0
      ),
      mediaProperties: media.filter((element) => Boolean(element.vsc)).length,
      wrapperElements: documents.reduce(
        (total, owner) => total + (owner?.querySelectorAll('.vsc-controller').length || 0),
        0
      ),
      rateStates: window.__stayfastRetainedRefs.reduce(
        (total, reference) => total + (reference.eventManager?.mediaRateStates?.size || 0),
        0
      ),
      pendingMutationWork: window.__stayfastRetainedRefs.reduce(
        (total, reference) => total + (reference.observer?.getPendingWorkCount?.() || 0),
        0
      ),
      shadowObservers: window.__stayfastRetainedRefs.reduce(
        (total, reference) => total + (reference.observer?.shadowObservers?.size || 0),
        0
      ),
    };
  });

  for (const [name, value] of Object.entries(retainedControllers)) {
    if (value !== 0) {
      throw new Error(`${scenario} ${enabled ? 'enabled' : 'disabled'} retained ${name}: ${value}`);
    }
  }

  return {
    mode: enabled ? 'enabled' : 'disabled',
    browserTelemetry,
    extensionTelemetry,
    nativeMetrics: {
      before,
      afterWork,
      afterTeardown,
      workDelta: subtractMetrics(afterWork, before),
      teardownDelta: subtractMetrics(afterTeardown, afterWork),
      totalDelta: subtractMetrics(afterTeardown, before),
    },
    retainedControllers,
  };
}

const fixture = await startFixtureServer();
let browser;
try {
  const launched = await launchFixtureBrowser('chrome');
  browser = launched.browser;
  const page = launched.page;
  const pageErrors = monitorPageErrors(page);
  const session = await page.target().createCDPSession();
  await session.send('Performance.enable');

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    browser: await browser.version(),
    platform: process.platform,
    repetitions: REPETITIONS,
    scenarios: [],
  };

  for (let scenarioIndex = 0; scenarioIndex < SCENARIOS.length; scenarioIndex++) {
    const scenario = SCENARIOS[scenarioIndex];
    const executionOrder = [];
    const samples = [];
    for (let repetition = 0; repetition < REPETITIONS; repetition++) {
      const order = (scenarioIndex + repetition) % 2 === 0 ? [false, true] : [true, false];
      for (const enabled of order) {
        pageErrors.clear();
        const mode = enabled ? 'enabled' : 'disabled';
        console.log(
          `Benchmarking ${scenario} with extension ${mode} (pair ${repetition + 1}/${REPETITIONS})`
        );
        executionOrder.push({ repetition: repetition + 1, mode });
        samples.push({
          repetition: repetition + 1,
          ...(await runScenario(page, scenario, { enabled, fixture, session })),
        });
        pageErrors.assertNone(`${scenario} (${mode}, pair ${repetition + 1})`);
      }
    }
    evidence.scenarios.push({ name: scenario, executionOrder, samples });
  }
  pageErrors.dispose();

  const output = resolve(
    process.env.STAYFAST_BENCHMARK_OUTPUT ||
      join(tmpdir(), `stayfast-browser-benchmark-${Date.now()}.json`)
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`BENCHMARK_EVIDENCE=${output}`);
} finally {
  await browser?.close();
  await fixture.stop();
}
