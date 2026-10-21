/** Pure measurement/acceptance rules, shared by the native fixture and unit tests. */
export const RATE_PROBE_RATES = Object.freeze([1, 2, 2.5, 3, 4, 8, 16]);

export function summarizeFrameCadence(callbackTimesMs, elapsedMs) {
  if (
    !Array.isArray(callbackTimesMs) ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0 ||
    callbackTimesMs.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time < 0 ||
        time > elapsedMs ||
        (index > 0 && time < callbackTimesMs[index - 1])
    )
  ) {
    return null;
  }
  const gaps = [];
  let previous = 0;
  for (const time of callbackTimesMs) {
    gaps.push(time - previous);
    previous = time;
  }
  gaps.push(elapsedMs - previous);
  const sorted = [...gaps].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    frameCallbacks: callbackTimesMs.length,
    callbackHz: callbackTimesMs.length / (elapsedMs / 1000),
    initialFrameGapMs: gaps[0],
    trailingFrameGapMs: gaps.at(-1),
    p50FrameGapMs: percentile(0.5),
    p95FrameGapMs: percentile(0.95),
    maxFrameGapMs: sorted.at(-1),
  };
}

// Self-contained so the HTTP fixture embeds these exact rules without a bundler.
// `passed` means functional playback only; cadence is an independent target.
export function validateRateProbeReport(report) {
  const rates = [1, 2, 2.5, 3, 4, 8, 16];
  const failures = [];
  const warnings = [];
  const cadenceFailures = [];
  const samples = [];
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const nonnegative = (value) => finite(value) && value >= 0;
  const modes = ['native-baseline', 'extension'];
  const presentation = report?.presentation === undefined ? 'inline' : report.presentation;
  if (
    !['inline', 'owned'].includes(presentation) ||
    (presentation === 'owned' && report?.mode !== 'extension')
  ) {
    failures.push('Invalid probe presentation or owned player without extension control');
  }
  if (!report || !modes.includes(report.mode) || !Array.isArray(report.results)) {
    failures.push('Missing probe mode or results');
  }
  if (!Array.isArray(report?.pageErrors) || report.pageErrors.length !== 0) {
    failures.push('Page errors or missing page-error capture');
  }
  const results = Array.isArray(report?.results) ? report.results : [];
  if (
    results.length !== rates.length ||
    results.some((sample) => !rates.includes(sample?.requested))
  ) {
    failures.push('Expected exactly the seven approved rates');
  }
  for (const rate of rates) {
    const matches = results.filter((sample) => sample?.requested === rate);
    const errors = [];
    const sampleWarnings = [];
    const cadenceErrors = [];
    const item = matches[0];
    const minimumHz = rate === 1 ? 20 : 24;
    if (matches.length !== 1) {
      errors.push('Missing or duplicate rate');
    } else {
      if (item.error !== 0 || item.setterAccepted !== true || item.firstFrame !== 'presented') {
        errors.push('Media error, rejected rate, or missing first frame');
      }
      if (!finite(item.readback) || Math.abs(item.readback - rate) > rate * 0.001) {
        errors.push('Requested rate was not accepted');
      }
      if (
        !finite(item.elapsed) ||
        item.elapsed < 6 ||
        item.elapsed > 6.5 ||
        !finite(item.warmupElapsed) ||
        item.warmupElapsed < 1 ||
        !finite(item.measuredTimeRate) ||
        Math.abs(item.measuredTimeRate / rate - 1) > 0.1 ||
        Math.abs(item.measuredTimeRate - (item.time - item.startTime) / item.elapsed) > 0.001
      ) {
        errors.push('Incomplete window, warmup, or incorrect media-time progress');
      }
      if (
        !finite(item.duration) ||
        !finite(item.startTime) ||
        item.startTime < 5 ||
        item.duration - item.startTime < rate * 6 + 1 ||
        !finite(item.time) ||
        item.time <= item.startTime ||
        item.time >= item.duration ||
        item.paused !== false ||
        item.ended !== false ||
        item.visibility !== 'visible' ||
        item.extensionControlled !== (report.mode === 'extension') ||
        item.ownershipChanged !== false ||
        !Number.isInteger(item.readyState) ||
        item.readyState < 2 ||
        item.readyState > 4
      ) {
        errors.push('Insufficient headroom, invalid playback state, or wrong controller ownership');
      }
      if (
        presentation === 'owned' &&
        [
          'ownedPresentation',
          'originalIdentityAtStart',
          'originalIdentityAtEnd',
          'originalSourceAtStart',
          'originalSourceAtEnd',
        ].some((key) => item[key] !== true)
      ) {
        errors.push(
          'Owned presentation closed or original media identity/source was not preserved'
        );
      }
      if (
        !item.events ||
        ['waiting', 'pause', 'ended', 'error', 'hidden'].some((name) => item.events[name] !== 0)
      ) {
        errors.push('Playback waited, paused, ended, errored, or became hidden');
      }
      // `stalled` describes downloading. Buffered playback can continue, so
      // retain it as a warning only with complete event-time evidence of at
      // least one wall-clock second of future data at the requested speed.
      const states = item.eventStates;
      const stateMetadataValid =
        Array.isArray(states) &&
        states.length <= 32 &&
        item.eventStatesTruncated === false &&
        ['waiting', 'stalled'].every(
          (name) =>
            Number.isInteger(item.events?.[name]) &&
            item.events[name] >= 0 &&
            states.filter((state) => state?.event === name).length === item.events[name]
        ) &&
        states.every(
          (state, index) =>
            state &&
            ['waiting', 'stalled'].includes(state.event) &&
            nonnegative(state.elapsedMs) &&
            state.elapsedMs <= item.elapsed * 1000 &&
            (index === 0 || state.elapsedMs >= states[index - 1].elapsedMs) &&
            nonnegative(state.currentTime) &&
            state.currentTime <= item.duration &&
            Number.isInteger(state.readyState) &&
            state.readyState >= 0 &&
            state.readyState <= 4 &&
            Number.isInteger(state.networkState) &&
            state.networkState >= 0 &&
            state.networkState <= 3 &&
            nonnegative(state.bufferedAhead) &&
            state.bufferedAhead <= item.duration - state.currentTime + 0.001
        );
      if (!stateMetadataValid) {
        errors.push('Missing, truncated, or invalid waiting/stalled event-time state');
      } else {
        const stalls = states.filter((state) => state.event === 'stalled');
        if (
          stalls.some(
            (state) =>
              state.readyState <= 2 ||
              ![1, 2].includes(state.networkState) ||
              state.bufferedAhead < Math.max(1, rate)
          )
        ) {
          errors.push('Playback stalled without sufficient buffered future data');
        } else if (stalls.length > 0) {
          sampleWarnings.push(
            `${stalls.length} buffered network-stalled notice(s), at least ${Math.max(1, rate)} media seconds ahead`
          );
        }
      }
      const counterKeys = [
        'totalVideoFrames',
        'droppedVideoFrames',
        'corruptedVideoFrames',
        'webkitDecodedFrameCount',
        'webkitDroppedFrameCount',
      ];
      if (
        counterKeys.some((key) => {
          const start = item.qualityStart?.[key];
          const end = item.qualityEnd?.[key];
          return (
            (start !== null && !nonnegative(start)) ||
            (end !== null && !nonnegative(end)) ||
            (start !== null && end !== null && end < start)
          );
        })
      ) {
        errors.push('Missing or inconsistent raw frame counters');
      }
      if (
        !Number.isInteger(item.frameCallbacks) ||
        item.frameCallbacks < 2 ||
        !finite(item.callbackHz) ||
        item.callbackHz <= 0 ||
        Math.abs(item.callbackHz - item.frameCallbacks / item.elapsed) > 0.001 ||
        ![
          'initialFrameGapMs',
          'trailingFrameGapMs',
          'p50FrameGapMs',
          'p95FrameGapMs',
          'maxFrameGapMs',
        ].every((key) => nonnegative(item[key])) ||
        item.p50FrameGapMs > item.p95FrameGapMs ||
        item.p95FrameGapMs > item.maxFrameGapMs ||
        item.initialFrameGapMs > item.maxFrameGapMs ||
        item.trailingFrameGapMs > item.maxFrameGapMs ||
        item.maxFrameGapMs > item.elapsed * 1000
      ) {
        errors.push('Missing or inconsistent callback cadence');
      }
      if (
        !finite(item.callbackHz) ||
        item.callbackHz < minimumHz ||
        !finite(item.p95FrameGapMs) ||
        item.p95FrameGapMs > 50 ||
        !finite(item.maxFrameGapMs) ||
        item.maxFrameGapMs > 150
      ) {
        cadenceErrors.push('Callback cadence target not met');
      }
    }
    for (const error of errors) {
      failures.push(`${rate}x: ${error}`);
    }
    for (const error of cadenceErrors) {
      cadenceFailures.push(`${rate}x: ${error}`);
    }
    for (const warning of sampleWarnings) {
      warnings.push(`${rate}x: ${warning}`);
    }
    samples.push({
      rate,
      functionalPassed: errors.length === 0,
      cadencePassed: errors.length === 0 && cadenceErrors.length === 0,
      warnings: sampleWarnings,
    });
  }
  return {
    passed: failures.length === 0,
    functional: { passed: failures.length === 0, failures, warnings },
    cadence: {
      passed: failures.length === 0 && cadenceFailures.length === 0,
      targets: {
        minimumCallbackHzAt1x: 20,
        minimumCallbackHzAbove1x: 24,
        p95GapMs: 50,
        maxGapMs: 150,
      },
      failures: cadenceFailures,
    },
    samples,
  };
}
