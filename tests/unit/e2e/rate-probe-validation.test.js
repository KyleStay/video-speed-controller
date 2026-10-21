import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  RATE_PROBE_RATES,
  summarizeFrameCadence,
  validateRateProbeReport,
} from '../../e2e/rate-probe-validation.js';
import { rateProbeHtml } from '../../e2e/fixture-server.js';

function goodReport(mode = 'native-baseline') {
  return {
    mode,
    setterAcceptance: [],
    pageErrors: [],
    results: RATE_PROBE_RATES.map((requested) => ({
      requested,
      readback: requested,
      setterAccepted: true,
      firstFrame: 'presented',
      warmupElapsed: 1,
      elapsed: 6,
      startTime: 5 + requested,
      time: 5 + requested * 7,
      duration: 180,
      measuredTimeRate: requested,
      ...summarizeFrameCadence(
        Array.from({ length: 180 }, (_, index) => index * (1000 / 30)),
        6000
      ),
      qualityStart: {
        totalVideoFrames: 0,
        droppedVideoFrames: 0,
        corruptedVideoFrames: null,
        webkitDecodedFrameCount: 0,
        webkitDroppedFrameCount: null,
      },
      qualityEnd: {
        totalVideoFrames: 180,
        droppedVideoFrames: 0,
        corruptedVideoFrames: null,
        webkitDecodedFrameCount: 180,
        webkitDroppedFrameCount: null,
      },
      events: { waiting: 0, stalled: 0, pause: 0, ended: 0, error: 0, hidden: 0 },
      eventStates: [],
      eventStatesTruncated: false,
      paused: false,
      ended: false,
      error: 0,
      readyState: 4,
      visibility: 'visible',
      extensionControlled: mode === 'extension',
      ownershipChanged: false,
    })),
  };
}

function addNetworkEvent(report, rate = 2, event = 'stalled', overrides = {}) {
  const sample = report.results.find((item) => item.requested === rate);
  const currentTime = sample.startTime + rate;
  sample.events[event]++;
  sample.eventStates.push({
    event,
    elapsedMs: 1000,
    currentTime,
    readyState: 4,
    networkState: 2,
    bufferedAhead: sample.duration - currentTime,
    ...overrides,
  });
  return sample;
}

describe('rate probe cadence measurements', () => {
  it('includes the initial and trailing silence in percentiles and the maximum', () => {
    expect(summarizeFrameCadence([100, 300, 600], 1000)).toEqual({
      frameCallbacks: 3,
      callbackHz: 3,
      initialFrameGapMs: 100,
      trailingFrameGapMs: 400,
      p50FrameGapMs: 200,
      p95FrameGapMs: 400,
      maxFrameGapMs: 400,
    });
  });

  it('reports starvation for zero or one callback rather than a zero maximum gap', () => {
    expect(summarizeFrameCadence([], 6000)).toMatchObject({
      frameCallbacks: 0,
      callbackHz: 0,
      initialFrameGapMs: 6000,
      trailingFrameGapMs: 6000,
      maxFrameGapMs: 6000,
    });
    expect(summarizeFrameCadence([100], 6000)).toMatchObject({
      frameCallbacks: 1,
      initialFrameGapMs: 100,
      trailingFrameGapMs: 5900,
      maxFrameGapMs: 5900,
    });
  });

  it.each([
    [[20, 10], 100],
    [[NaN], 100],
    [[-1], 100],
    [[101], 100],
    [[], 0],
    [[], Infinity],
    [null, 100],
  ])('rejects invalid callback clocks %j and window %s', (times, elapsed) => {
    expect(summarizeFrameCadence(times, elapsed)).toBeNull();
  });
});

describe('functional rate probe acceptance', () => {
  it.each(['native-baseline', 'extension'])('accepts a complete %s run', (mode) => {
    expect(validateRateProbeReport(goodReport(mode))).toMatchObject({
      passed: true,
      functional: { passed: true, failures: [] },
      cadence: { passed: true, failures: [] },
    });
  });

  it.each([
    [
      'empty results',
      (report) => {
        report.results = [];
      },
    ],
    [
      'missing rate',
      (report) => {
        report.results.pop();
      },
    ],
    [
      'duplicate rate',
      (report) => {
        report.results[6] = report.results[0];
      },
    ],
    [
      'unexpected rate',
      (report) => {
        report.results[6].requested = 32;
      },
    ],
    [
      'missing mode',
      (report) => {
        delete report.mode;
      },
    ],
    [
      'missing error capture',
      (report) => {
        delete report.pageErrors;
      },
    ],
    [
      'page exception',
      (report) => {
        report.pageErrors.push('Uncaught error');
      },
    ],
    [
      'failed setter',
      (report) => {
        report.results[0].setterAccepted = false;
      },
    ],
    [
      'clamped setter',
      (report) => {
        report.results[6].readback = 2;
      },
    ],
    [
      'media error',
      (report) => {
        report.results[0].error = 3;
      },
    ],
    [
      'sample exception',
      (report) => {
        report.results[0] = { requested: 1, error: 'seek timeout' };
      },
    ],
    [
      'unavailable callback API',
      (report) => {
        report.results[0].firstFrame = 'unavailable';
      },
    ],
    [
      'first-frame timeout',
      (report) => {
        report.results[0].firstFrame = 'timedOut';
      },
    ],
    [
      'short 400ms measurement',
      (report) => {
        report.results[6].elapsed = 0.4;
      },
    ],
    [
      'delayed measurement timer',
      (report) => {
        report.results[6].elapsed = 8;
      },
    ],
    [
      'missing warmup',
      (report) => {
        report.results[0].warmupElapsed = 0;
      },
    ],
    [
      'no progress',
      (report) => {
        report.results[0].measuredTimeRate = 0;
      },
    ],
    [
      'wrong progress',
      (report) => {
        report.results[6].measuredTimeRate = 8;
      },
    ],
    [
      'contradictory time progress',
      (report) => {
        report.results[6].time -= 16;
      },
    ],
    [
      'insufficient clip headroom',
      (report) => {
        report.results[6].duration = 15;
      },
    ],
    [
      'ended clip',
      (report) => {
        report.results[6].ended = true;
      },
    ],
    [
      'paused media',
      (report) => {
        report.results[0].paused = true;
      },
    ],
    [
      'hidden media',
      (report) => {
        report.results[0].visibility = 'hidden';
      },
    ],
    [
      'transient hidden document',
      (report) => {
        report.results[0].events.hidden = 1;
      },
    ],
    [
      'waiting event',
      (report) => {
        report.results[0].events.waiting = 1;
      },
    ],
    [
      'stalled event',
      (report) => {
        report.results[0].events.stalled = 1;
      },
    ],
    [
      'transient pause',
      (report) => {
        report.results[0].events.pause = 1;
      },
    ],
    [
      'missing event capture',
      (report) => {
        delete report.results[0].events;
      },
    ],
    [
      'insufficient readiness',
      (report) => {
        report.results[0].readyState = 1;
      },
    ],
    [
      'controller on baseline',
      (report) => {
        report.results[0].extensionControlled = true;
      },
    ],
    [
      'transient controller change',
      (report) => {
        report.results[0].ownershipChanged = true;
      },
    ],
    [
      'zero callbacks',
      (report) => {
        Object.assign(report.results[0], summarizeFrameCadence([], 6000));
      },
    ],
    [
      'one callback',
      (report) => {
        Object.assign(report.results[0], summarizeFrameCadence([100], 6000));
      },
    ],
    [
      'missing edge measurement',
      (report) => {
        delete report.results[0].trailingFrameGapMs;
      },
    ],
    [
      'contradictory callback Hz',
      (report) => {
        report.results[0].callbackHz = 60;
      },
    ],
    [
      'counter names missing',
      (report) => {
        delete report.results[0].qualityStart;
      },
    ],
    [
      'negative frame counter',
      (report) => {
        report.results[0].qualityEnd.totalVideoFrames = -1;
      },
    ],
    [
      'frame counter reset',
      (report) => {
        report.results[0].qualityStart.webkitDecodedFrameCount = 200;
      },
    ],
  ])('fails %s instead of reporting functional success', (_name, change) => {
    const report = goodReport();
    change(report);
    const validation = validateRateProbeReport(report);
    expect(validation.passed).toBe(false);
    expect(validation.functional.failures.length).toBeGreaterThan(0);
    expect(validation.cadence.passed).toBe(false);
  });

  it('rejects missing controller ownership in an extension run', () => {
    const report = goodReport('extension');
    report.results[0].extensionControlled = false;
    expect(validateRateProbeReport(report).passed).toBe(false);
  });

  it('handles absent and malformed report values as failures', () => {
    for (const report of [null, undefined, {}, { mode: 'extension', results: [null] }]) {
      expect(validateRateProbeReport(report).passed).toBe(false);
    }
  });

  it('does not require unsupported raw counters to pretend they decoded frames', () => {
    const report = goodReport();
    for (const sample of report.results) {
      for (const key of Object.keys(sample.qualityStart)) {
        sample.qualityStart[key] = sample.qualityEnd[key] = null;
      }
    }
    expect(validateRateProbeReport(report).passed).toBe(true);
  });
});

describe('independent cadence targets', () => {
  it('allows 21Hz at 1x while requiring at least 24Hz for the faster rates', () => {
    const report = goodReport();
    const cadence = summarizeFrameCadence(
      Array.from({ length: 126 }, (_, index) => index * (1000 / 21)),
      6000
    );
    Object.assign(report.results[0], cadence);
    Object.assign(report.results[1], cadence);
    const validation = validateRateProbeReport(report);
    expect(validation.passed).toBe(true);
    expect(validation.samples[0].cadencePassed).toBe(true);
    expect(validation.samples[1].cadencePassed).toBe(false);
  });

  it('fails the p95 target independently of average Hz and maximum-gap targets', () => {
    const report = goodReport();
    Object.assign(
      report.results[1],
      summarizeFrameCadence(
        Array.from({ length: 144 }, (_, index) => Math.floor(index / 2) * 83 + (index % 2) * 10),
        6000
      )
    );
    expect(report.results[1].callbackHz).toBe(24);
    expect(report.results[1].maxFrameGapMs).toBeLessThan(150);
    expect(report.results[1].p95FrameGapMs).toBeGreaterThan(50);
    expect(validateRateProbeReport(report)).toMatchObject({
      passed: true,
      cadence: { passed: false },
    });
  });

  it('keeps slow callback delivery separate from valid media-time progression', () => {
    const report = goodReport();
    Object.assign(
      report.results[2],
      summarizeFrameCadence(
        Array.from({ length: 90 }, (_, i) => i * (1000 / 15)),
        6000
      )
    );
    const validation = validateRateProbeReport(report);
    expect(validation.passed).toBe(true);
    expect(validation.functional.passed).toBe(true);
    expect(validation.cadence.passed).toBe(false);
    expect(validation.samples[2]).toMatchObject({ functionalPassed: true, cadencePassed: false });
  });

  it('fails cadence on a trailing freeze even when average callback Hz meets the target', () => {
    const report = goodReport();
    Object.assign(
      report.results[6],
      summarizeFrameCadence(
        Array.from({ length: 172 }, (_, i) => i * (1000 / 30)),
        6000
      )
    );
    const validation = validateRateProbeReport(report);
    expect(report.results[6].callbackHz).toBeGreaterThan(24);
    expect(report.results[6].p95FrameGapMs).toBeLessThan(50);
    expect(report.results[6].trailingFrameGapMs).toBeGreaterThan(150);
    expect(validation.passed).toBe(true);
    expect(validation.cadence.passed).toBe(false);
  });

  it('reports the explicit engineering cadence targets', () => {
    expect(validateRateProbeReport(goodReport()).cadence.targets).toEqual({
      minimumCallbackHzAt1x: 20,
      minimumCallbackHzAbove1x: 24,
      p95GapMs: 50,
      maxGapMs: 150,
    });
  });
});

describe('buffered network-stalled notices', () => {
  it.each(RATE_PROBE_RATES)(
    'reports a buffered %sx notice separately without failing playback',
    (rate) => {
      const report = goodReport();
      addNetworkEvent(report, rate);
      const validation = validateRateProbeReport(report);
      expect(validation.passed).toBe(true);
      expect(validation.cadence.passed).toBe(true);
      expect(validation.functional.failures).toEqual([]);
      expect(validation.functional.warnings).toHaveLength(1);
      expect(validation.functional.warnings[0]).toContain(`${rate}x: 1 buffered network-stalled`);
      expect(validation.samples.find((sample) => sample.rate === rate).warnings).toHaveLength(1);
    }
  );

  it.each([1, 2])(
    'allows a notice only with buffered future data and networkState %s',
    (networkState) => {
      const report = goodReport();
      addNetworkEvent(report, 2, 'stalled', { readyState: 3, networkState, bufferedAhead: 2 });
      expect(validateRateProbeReport(report).passed).toBe(true);
    }
  );

  it.each([151, 174])(
    'retains a %sms cadence failure despite a harmless buffered downloading notice',
    (gap) => {
      const report = goodReport();
      const sample = addNetworkEvent(report, 2.5);
      Object.assign(
        sample,
        summarizeFrameCadence(
          Array.from({ length: 175 }, (_, index) => index * ((6000 - gap) / 174)),
          6000
        )
      );
      expect(sample.maxFrameGapMs).toBeCloseTo(gap, 8);
      const validation = validateRateProbeReport(report);
      expect(validation.passed).toBe(true);
      expect(validation.functional.warnings).toHaveLength(1);
      expect(validation.cadence.passed).toBe(false);
    }
  );

  it('never excuses waiting with buffered data or a simultaneous network notice', () => {
    const report = goodReport();
    addNetworkEvent(report, 2, 'waiting');
    addNetworkEvent(report, 2, 'stalled');
    const validation = validateRateProbeReport(report);
    expect(validation.passed).toBe(false);
    expect(
      validation.functional.failures.some((failure) => failure.includes('Playback waited'))
    ).toBe(true);
  });

  it.each([
    ['no future data', { readyState: 2 }],
    ['current data unavailable', { readyState: 1 }],
    ['too little buffered playback', { bufferedAhead: 1.9 }],
    ['empty network state', { networkState: 0 }],
    ['no media source', { networkState: 3 }],
    ['missing ready state', { readyState: null }],
    ['invalid ready state', { readyState: 5 }],
    ['invalid network state', { networkState: 4 }],
    ['non-numeric network state', { networkState: '2' }],
    ['missing buffer evidence', { bufferedAhead: null }],
    ['negative buffered amount', { bufferedAhead: -1 }],
    ['non-finite buffered amount', { bufferedAhead: Infinity }],
    ['buffer beyond clip end', { bufferedAhead: 180 }],
    ['missing event clock', { elapsedMs: null }],
    ['negative event clock', { elapsedMs: -1 }],
    ['event after window', { elapsedMs: 6001 }],
    ['missing media clock', { currentTime: null }],
    ['media clock beyond duration', { currentTime: 181 }],
    ['unexpected event', { event: 'progress' }],
  ])('fails closed for %s', (_reason, overrides) => {
    const report = goodReport();
    addNetworkEvent(report, 2, 'stalled', overrides);
    const validation = validateRateProbeReport(report);
    expect(validation.passed).toBe(false);
    expect(validation.functional.warnings).toEqual([]);
  });

  it('requires one wall-clock second of buffer at the requested high rate', () => {
    const report = goodReport();
    const sample = addNetworkEvent(report, 16, 'stalled', { bufferedAhead: 15.9 });
    expect(validateRateProbeReport(report).passed).toBe(false);
    sample.eventStates[0].bufferedAhead = 16;
    expect(validateRateProbeReport(report).passed).toBe(true);
  });

  it.each([
    [
      'missing event capture',
      (sample) => {
        delete sample.eventStates;
      },
    ],
    [
      'truncated event capture',
      (sample) => {
        sample.eventStatesTruncated = true;
      },
    ],
    [
      'unreported notice',
      (sample) => {
        sample.events.stalled = 0;
      },
    ],
    [
      'missing event state',
      (sample) => {
        sample.eventStates = [];
      },
    ],
    [
      'fractional event count',
      (sample) => {
        sample.events.stalled = 0.5;
      },
    ],
    [
      'reversed event times',
      (sample) => {
        sample.events.stalled = 2;
        sample.eventStates.push({ ...sample.eventStates[0], elapsedMs: 500 });
      },
    ],
    [
      'excessive event states',
      (sample) => {
        sample.events.stalled = 33;
        sample.eventStates = Array.from({ length: 33 }, () => ({ ...sample.eventStates[0] }));
      },
    ],
  ])('fails closed with %s', (_reason, change) => {
    const report = goodReport();
    const sample = addNetworkEvent(report);
    change(sample);
    expect(validateRateProbeReport(report).passed).toBe(false);
  });
});

describe('owned player probe presentation', () => {
  function ownedReport() {
    const report = goodReport('extension');
    report.presentation = 'owned';
    for (const sample of report.results) {
      Object.assign(sample, {
        ownedPresentation: true,
        originalIdentityAtStart: true,
        originalIdentityAtEnd: true,
        originalSourceAtStart: true,
        originalSourceAtEnd: true,
      });
    }
    return report;
  }

  it('accepts complete owned sessions while preserving old inline reports', () => {
    expect(validateRateProbeReport(ownedReport()).cadence.passed).toBe(true);
    for (const mode of ['native-baseline', 'extension']) {
      const report = goodReport(mode);
      expect(report).not.toHaveProperty('presentation');
      expect(validateRateProbeReport(report).passed).toBe(true);
      report.presentation = 'inline';
      expect(validateRateProbeReport(report).passed).toBe(true);
    }
  });

  it.each([
    'ownedPresentation',
    'originalIdentityAtStart',
    'originalIdentityAtEnd',
    'originalSourceAtStart',
    'originalSourceAtEnd',
  ])('fails closed when owned evidence %s is absent or false', (key) => {
    for (const value of [undefined, false, 'true']) {
      const report = ownedReport();
      report.results[3][key] = value;
      const validation = validateRateProbeReport(report);
      expect(validation.passed).toBe(false);
      expect(validation.cadence.passed).toBe(false);
    }
  });

  it('rejects a transiently closed or replaced owned session', () => {
    const report = ownedReport();
    report.results[0].ownershipChanged = true;
    expect(validateRateProbeReport(report).passed).toBe(false);
  });

  it.each([null, '', 'native', {}])(
    'rejects an explicit invalid presentation %j',
    (presentation) => {
      const report = goodReport();
      report.presentation = presentation;
      expect(validateRateProbeReport(report).passed).toBe(false);
    }
  );

  it('does not report baseline video as an owned extension presentation', () => {
    const report = ownedReport();
    report.mode = 'native-baseline';
    expect(validateRateProbeReport(report).passed).toBe(false);
    report.presentation = 'native';
    expect(validateRateProbeReport(report).passed).toBe(false);
  });
});

describe('HTTP fixture integration', () => {
  it('embeds the shared validator and complete browser script with compatible output fields', () => {
    const script = rateProbeHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script)).not.toThrow();
    expect(script).toContain(validateRateProbeReport.toString());
    expect(script).toContain(summarizeFrameCadence.toString());
    expect(script).toContain(JSON.stringify(RATE_PROBE_RATES));
    expect(script).toContain("mode:controlled ? 'extension' : 'native-baseline'");
    expect(script).toContain('presentation,setterAcceptance,results,pageErrors');
    expect(script.indexOf('const activation = video.play()')).toBeLessThan(
      script.indexOf('ownedPlayer.open({fullscreen:true})')
    );
    expect(script.indexOf('ownedPlayer.open({fullscreen:true})')).toBeLessThan(
      script.indexOf('await activation')
    );
    expect(script.indexOf('ownedPlayer?.close()')).toBeLessThan(
      script.indexOf("status.textContent = 'Rate probe complete:")
    );
    expect(script).toContain('ownedPresentation:ownedAtStart && ownedActive()');
    expect(script).toContain('validateRateProbeReport(window.__nativeRateResults)');
    // Evaluate only the pure browser preamble: neither a server nor media runs.
    const preamble = script.slice(0, script.indexOf('const controlled ='));
    const evaluate = (report) =>
      new Script(`${preamble}\nvalidateRateProbeReport(report)`).runInNewContext({ report });
    expect(evaluate(goodReport()).passed).toBe(true);
    const invalid = goodReport();
    invalid.results = [];
    expect(evaluate(invalid).passed).toBe(false);
  });
});
