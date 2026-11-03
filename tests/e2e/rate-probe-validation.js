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

// Live measurements keep command/startup time; the six-second fixture remains a separate diagnostic.
export const LIVE_RATE_PROBE_RATES = Object.freeze([2.1, 4]);

/** Self-contained for WebDriver injection. Starts observing now, before the trusted command. */
export function collectPlaybackObservations(initialVideo, options = {}) {
  const view = initialVideo.ownerDocument.defaultView;
  const native = Object.fromEntries(
    ['currentTime', 'duration', 'playbackRate'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(view.HTMLMediaElement.prototype, key)?.get,
    ])
  );
  const durationMs = options.durationMs ?? 20000;
  const sampleIntervalMs = options.sampleIntervalMs ?? 25;
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 1000 ||
    durationMs > 120000 ||
    !Number.isFinite(sampleIntervalMs) ||
    sampleIntervalMs < 10 ||
    sampleIntervalMs > 100
  ) {
    throw new Error('Invalid bounded observation window');
  }
  const document = initialVideo.ownerDocument;
  const start = view.performance.now();
  const record = {
    schemaVersion: 1,
    elapsedMs: 0,
    finished: false,
    reason: null,
    observations: [],
    frames: [],
    events: [],
    handoffs: [],
    inputs: [],
    // Earlier window handlers can suppress document delivery; this capture is best-effort.
    inputCaptureComplete: false,
    truncated: false,
  };
  const read = (getter) => {
    try {
      return getter();
    } catch {
      return null;
    }
  };
  const number = (getter) => {
    const value = read(getter);
    return Number.isFinite(value) ? value : null;
  };
  let video;
  let sourceEpoch = 0;
  let seekEpoch = 0;
  let targetEpoch = -1;
  let source;
  let frameToken;
  let interval = null;
  let deadline = null;
  let listeners = [];
  let resolve;
  const result = new Promise((done) => {
    resolve = done;
  });
  const at = () => view.performance.now() - start;
  const quality = () => {
    const value = read(() => video.getVideoPlaybackQuality());
    return {
      totalVideoFrames: number(() => value?.totalVideoFrames),
      droppedVideoFrames: number(() => value?.droppedVideoFrames),
      webkitDecodedFrameCount: number(() => video.webkitDecodedFrameCount),
    };
  };
  const snapshot = () => ({
    elapsedMs: at(),
    nativeTime: number(() => native.currentTime.call(video)),
    uiTime: number(() => video.currentTime),
    duration: number(() => video.duration),
    nativeDuration: number(() => native.duration.call(video)),
    sourceIdentity: read(() => video.currentSrc),
    sourceEpoch,
    seekEpoch,
    targetEpoch,
    seeking: read(() => video.seeking),
    paused: read(() => video.paused),
    rate: number(() => native.playbackRate.call(video)),
    muted: read(() => video.muted),
    volume: number(() => video.volume),
    preservesPitch: read(() => video.preservesPitch),
    readyState: read(() => video.readyState),
    visibility: document.visibilityState,
    quality: quality(),
  });
  const push = (array, value) => {
    if (array.length >= 24000) {
      record.truncated = true;
      stop('observation-budget');
      return;
    }
    array.push(value);
  };
  const sample = () => {
    if (record.finished) {
      return;
    }
    if (video.ownerDocument !== document || !video.isConnected) {
      stop('target-lost');
      return;
    }
    const current = read(() => video.currentSrc);
    if (current !== source) {
      sourceEpoch++;
      source = current;
    }
    push(record.observations, snapshot());
  };
  const detach = () => {
    if (frameToken !== undefined) {
      read(() => video.cancelVideoFrameCallback(frameToken));
    }
    frameToken = undefined;
    listeners.forEach(([type, listener]) => video.removeEventListener(type, listener));
    listeners = [];
  };
  function stop(reason = 'cancelled') {
    if (record.finished) {
      return record;
    }
    // Capture the trailing edge even when no callback is delivered there.
    if (record.observations.length < 24000) {
      record.observations.push(snapshot());
    }
    record.elapsedMs = at();
    record.reason = reason;
    record.finished = true;
    detach();
    for (const type of ['pointerdown', 'click', 'keydown', 'change']) {
      document.removeEventListener(type, captureInput, true);
    }
    view.clearInterval(interval);
    view.clearTimeout(deadline);
    resolve(record);
    return record;
  }
  function attach(nextVideo) {
    if (record.finished || nextVideo.ownerDocument !== document || !nextVideo.isConnected) {
      throw new Error('Observation target must remain in the owned document');
    }
    const before = video ? snapshot() : null;
    if (video) {
      detach();
    }
    video = nextVideo;
    source = read(() => video.currentSrc);
    targetEpoch++;
    sourceEpoch++;
    const after = snapshot();
    if (before) {
      push(record.observations, before);
      record.handoffs.push({ elapsedMs: at(), before, after });
    }
    for (const type of [
      'seeking',
      'seeked',
      'emptied',
      'loadstart',
      'waiting',
      'stalled',
      'playing',
      'pause',
      'ended',
      'error',
    ]) {
      const listener = (event) => {
        if (type === 'seeking') {
          seekEpoch++;
        }
        if (type === 'emptied' || type === 'loadstart') {
          sourceEpoch++;
          source = read(() => video.currentSrc);
        }
        push(record.events, { type, isTrusted: event.isTrusted === true, ...snapshot() });
        sample();
      };
      video.addEventListener(type, listener);
      listeners.push([type, listener]);
    }
    const ownedVideo = video;
    const frame = (callbackNow, metadata) => {
      frameToken = undefined;
      if (record.finished || video !== ownedVideo) {
        return;
      }
      sample();
      push(record.frames, {
        ...snapshot(),
        callbackNow,
        mediaTime: metadata.mediaTime,
        presentedFrames: metadata.presentedFrames,
        expectedDisplayTime: metadata.expectedDisplayTime,
        processingDuration: metadata.processingDuration,
      });
      if (!record.finished) {
        frameToken = read(() => video.requestVideoFrameCallback(frame));
      }
    };
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameToken = read(() => video.requestVideoFrameCallback(frame));
    }
    sample();
  }
  const captureInput = (event) => {
    if (event.isTrusted) {
      push(record.inputs, {
        elapsedMs: at(),
        type: event.type,
        key: event.key ?? null,
        isTrusted: true,
      });
    }
  };
  for (const type of ['pointerdown', 'click', 'keydown', 'change']) {
    document.addEventListener(type, captureInput, true);
  }
  try {
    attach(initialVideo);
  } catch (error) {
    stop('target-unavailable');
    throw error;
  }
  interval = view.setInterval(sample, sampleIntervalMs);
  deadline = view.setTimeout(() => stop('window-complete'), durationMs);
  return { result, record, stop, attach };
}

/** Signed, epoch-bounded arithmetic. Raw records are never rewritten or corrected. */
export function summarizePlaybackObservations(record, verifiedEvidence = {}) {
  const errors = [];
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const rows = Array.isArray(record?.observations) ? record.observations : [];
  const frames = Array.isArray(record?.frames) ? record.frames : [];
  const elapsedMs = record?.elapsedMs;
  const sameEpoch = (a, b) =>
    ['sourceIdentity', 'sourceEpoch', 'seekEpoch', 'targetEpoch'].every((key) => a[key] === b[key]);
  const samePlayback = (a, b) =>
    ['sourceIdentity', 'sourceEpoch', 'targetEpoch'].every((key) => a[key] === b[key]);
  const events = Array.isArray(record?.events) ? record.events : [];
  const provenWrap = (before, after) => {
    const period = before.nativeDuration;
    if (
      !samePlayback(before, after) ||
      !finite(period) ||
      period <= 0 ||
      after.nativeDuration !== period ||
      before.nativeTime < period - 0.5 ||
      before.nativeTime > period ||
      after.nativeTime < 0 ||
      after.nativeTime > 0.5
    ) {
      return null;
    }
    const boundaryEvents = events.filter(
      (event) =>
        event.elapsedMs >= before.elapsedMs - 1 &&
        event.elapsedMs <= after.elapsedMs + 1000 &&
        samePlayback(event, before) &&
        event.isTrusted === true
    );
    let next = 0;
    for (const event of boundaryEvents) {
      if (event.type === ['ended', 'seeking', 'seeked', 'playing'][next]) {
        next++;
      }
    }
    const ended = boundaryEvents.find((event) => event.type === 'ended');
    const seeking = boundaryEvents.find((event) => event.type === 'seeking');
    const playing = boundaryEvents.find((event) => event.type === 'playing');
    return next === 4 &&
      ended.elapsedMs <= after.elapsedMs &&
      ended.nativeDuration === period &&
      ended.nativeTime >= period - 0.5 &&
      seeking.elapsedMs <= after.elapsedMs + 100 &&
      playing.nativeTime <= 0.5 &&
      playing.paused === false &&
      verifiedEvidence.inputCaptureComplete === true &&
      Array.isArray(record.inputs) &&
      !record.inputs.some(
        (input) =>
          input.isTrusted === true &&
          input.elapsedMs >= ended.elapsedMs &&
          input.elapsedMs <= playing.elapsedMs
      )
      ? period
      : null;
  };
  const validRows = (items) =>
    items.every(
      (row, index) =>
        row &&
        finite(row.elapsedMs) &&
        row.elapsedMs >= 0 &&
        row.elapsedMs <= elapsedMs &&
        (index === 0 || row.elapsedMs >= items[index - 1].elapsedMs) &&
        finite(row.nativeTime) &&
        finite(row.uiTime) &&
        finite(row.rate) &&
        row.rate >= 0 &&
        typeof row.seeking === 'boolean' &&
        typeof row.paused === 'boolean' &&
        typeof row.sourceIdentity === 'string' &&
        ['sourceEpoch', 'seekEpoch', 'targetEpoch'].every(
          (key) => Number.isInteger(row[key]) && row[key] >= 0
        )
    );
  if (
    !finite(elapsedMs) ||
    elapsedMs <= 0 ||
    rows.length < 2 ||
    !validRows(rows) ||
    !validRows(frames) ||
    frames.some((frame) => !finite(frame.mediaTime) || !finite(frame.presentedFrames))
  ) {
    return {
      valid: false,
      errors: ['Missing or invalid raw observation clocks/epochs'],
      raw: record,
    };
  }
  const naturalSeekTimes = new Set();
  let endedEvent;
  let seekingEvent;
  for (const event of events) {
    if (event.type === 'ended') {
      endedEvent = event;
      seekingEvent = null;
    }
    if (event.type === 'seeking') {
      seekingEvent = event;
    }
    if (
      event.type === 'playing' &&
      endedEvent &&
      seekingEvent &&
      provenWrap(endedEvent, event) !== null
    ) {
      naturalSeekTimes.add(seekingEvent.elapsedMs);
      endedEvent = null;
      seekingEvent = null;
    }
  }
  // A native seek assignment may be visible before its queued `seeking` event.
  const seekUncertaintyWindows = events
    .filter((event) => event.type === 'seeking' && !naturalSeekTimes.has(event.elapsedMs))
    .map((event) => {
      const before = [
        ...new Set(
          rows
            .filter((row) => row.elapsedMs < event.elapsedMs && samePlayback(row, event))
            .map((row) => row.elapsedMs)
        ),
      ];
      return { fromMs: before.at(-2) ?? before.at(-1) ?? 0, toMs: event.elapsedMs };
    });
  const suspiciousNativeStep = (before, after) =>
    after.nativeTime - before.nativeTime >
    Math.max(
      0.5,
      ((Math.max(before.rate, after.rate) * (after.elapsedMs - before.elapsedMs)) / 1000) * 2
    );
  const overlapsQueuedSeek = (before, after) =>
    seekUncertaintyWindows.some(
      (window) => before.elapsedMs < window.toMs && after.elapsedMs > window.fromMs
    );
  let nativeAdvance = 0;
  let nativeSignedAdvance = 0;
  let uiAdvance = 0;
  let actualWraps = 0;
  const excludedDisplacements = [];
  const negativeAdvancement = [];
  const positiveDisplacements = [];
  const naturalWraps = [];
  const wrapTimesMs = [];
  const wrapObservations = [];
  const counterResets = [];
  const counterAdvances = {
    totalVideoFrames: 0,
    droppedVideoFrames: 0,
    webkitDecodedFrameCount: 0,
  };
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    for (const key of Object.keys(counterAdvances)) {
      const before = previous.quality?.[key];
      const after = current.quality?.[key];
      if (!finite(before) || !finite(after)) {
        continue;
      }
      if (after < before) {
        counterResets.push({ key, atMs: current.elapsedMs, before, after });
      } else if (sameEpoch(previous, current)) {
        counterAdvances[key] += after - before;
      }
    }
    if (['sourceEpoch', 'seekEpoch', 'targetEpoch'].some((key) => current[key] < previous[key])) {
      errors.push('Epoch moved backwards');
    }
    const delta = current.nativeTime - previous.nativeTime;
    if (samePlayback(previous, current)) {
      nativeSignedAdvance += delta;
    }
    const period = provenWrap(previous, current);
    if (period !== null) {
      nativeAdvance += delta + period;
      actualWraps++;
      wrapTimesMs.push(current.elapsedMs);
      wrapObservations.push(current);
      naturalWraps.push({
        fromMs: previous.elapsedMs,
        toMs: current.elapsedMs,
        rawDelta: delta,
        period,
      });
      continue;
    }
    if (
      !sameEpoch(previous, current) ||
      previous.seeking ||
      current.seeking ||
      previous.paused ||
      current.paused ||
      overlapsQueuedSeek(previous, current)
    ) {
      excludedDisplacements.push({
        fromMs: previous.elapsedMs,
        toMs: current.elapsedMs,
        nativeDelta: current.nativeTime - previous.nativeTime,
        reason: 'source/seek/target/paused or unlocalized pre-seeking interval',
      });
      continue;
    }
    if (suspiciousNativeStep(previous, current)) {
      positiveDisplacements.push({ fromMs: previous.elapsedMs, toMs: current.elapsedMs, delta });
      continue;
    }
    nativeAdvance += delta;
    uiAdvance += current.uiTime - previous.uiTime;
    if (delta < 0) {
      negativeAdvancement.push({ fromMs: previous.elapsedMs, toMs: current.elapsedMs, delta });
    }
    const uiDelta = current.uiTime - previous.uiTime;
    const uiPeriod = previous.duration;
    // Count observed clip seams only; periods never inflate the native clock.
    if (
      delta >= 0 &&
      uiDelta < 0 &&
      finite(uiPeriod) &&
      uiPeriod > 0 &&
      current.duration === uiPeriod &&
      Math.abs(delta - uiDelta - uiPeriod) < 0.15
    ) {
      actualWraps++;
      wrapTimesMs.push(current.elapsedMs);
      wrapObservations.push(current);
    }
  }
  const rawFrameAdvance = frames.reduce((sum, frame, index) => {
    const previous = frames[index - 1];
    return index && samePlayback(previous, frame)
      ? sum + frame.mediaTime - previous.mediaTime
      : sum;
  }, 0);
  // Clock lag alone never certifies a cached callback. Require an exact prior raw tail.
  const first = frames[0];
  const second = frames[1];
  // The artifact loader supplies a verified raw tail; assertions inside the report have no authority.
  const tail = verifiedEvidence.priorFrameTail;
  const cachedHeadCertified = !!(
    tail &&
    typeof tail.artifact === 'string' &&
    tail.artifact &&
    first &&
    second &&
    tail.sourceIdentity === first.sourceIdentity &&
    finite(tail.mediaTime) &&
    finite(tail.presentedFrames) &&
    first.mediaTime >= tail.mediaTime &&
    first.mediaTime - tail.mediaTime <=
      (finite(tail.frameDuration) && tail.frameDuration > 0 && tail.frameDuration <= 0.1
        ? tail.frameDuration + 0.001
        : 0) &&
    first.presentedFrames >= tail.presentedFrames &&
    first.presentedFrames - tail.presentedFrames <= 1 &&
    Math.abs(first.nativeTime - first.mediaTime) > 1 &&
    sameEpoch(first, second) &&
    Math.abs(second.nativeTime - second.mediaTime) <= 0.5
  );
  const currentFrames = cachedHeadCertified ? frames.slice(1) : frames;
  let frameAdvance = 0;
  const frameBacksteps = [];
  for (let index = 1; index < currentFrames.length; index++) {
    const before = currentFrames[index - 1];
    const after = currentFrames[index];
    const delta = after.mediaTime - before.mediaTime;
    const wrap = naturalWraps.find(
      (item) =>
        item.fromMs >= before.elapsedMs &&
        item.toMs <= after.elapsedMs &&
        before.mediaTime >= item.period - 0.5 &&
        before.mediaTime <= item.period &&
        after.mediaTime >= 0 &&
        after.mediaTime <= 0.5
    );
    if (wrap && samePlayback(before, after)) {
      frameAdvance += delta + wrap.period;
      continue;
    }
    if (
      !sameEpoch(before, after) ||
      before.seeking ||
      after.seeking ||
      before.paused ||
      after.paused ||
      overlapsQueuedSeek(before, after)
    ) {
      continue;
    }
    if (
      suspiciousNativeStep(before, after) ||
      delta > Math.max(0.5, after.nativeTime - before.nativeTime + 0.5)
    ) {
      positiveDisplacements.push({
        fromMs: before.elapsedMs,
        toMs: after.elapsedMs,
        frameDelta: delta,
      });
      continue;
    }
    if (after.presentedFrames < before.presentedFrames) {
      counterResets.push({
        key: 'presentedFrames',
        atMs: after.elapsedMs,
        before: before.presentedFrames,
        after: after.presentedFrames,
      });
    }
    frameAdvance += delta;
    if (delta < 0) {
      frameBacksteps.push({ atMs: after.elapsedMs, delta });
    }
  }
  const callbackGaps = [];
  const boundaries = [{ elapsedMs: 0 }, ...currentFrames, { elapsedMs }];
  for (let index = 1; index < boundaries.length; index++) {
    const before = boundaries[index - 1];
    const after = boundaries[index];
    const gapMs = after.elapsedMs - before.elapsedMs;
    if (gapMs < 150) {
      continue;
    }
    const during = rows.filter(
      (row) => row.elapsedMs >= before.elapsedMs && row.elapsedMs <= after.elapsedMs
    );
    let classification = 'insufficient-evidence';
    if (during.length >= 2 && during.every((row) => sameEpoch(row, during[0]) && !row.seeking)) {
      const totals = during.map((row) => row.quality?.totalVideoFrames);
      if (
        totals.every(finite) &&
        totals.every((value, at) => at === 0 || value >= totals[at - 1])
      ) {
        // A closing frame cannot certify continuity through the preceding hole.
        let lastProgressMs = before.elapsedMs;
        let maximumCounterGapMs = 0;
        for (let at = 1; at < during.length; at++) {
          if (totals[at] > totals[at - 1]) {
            maximumCounterGapMs = Math.max(
              maximumCounterGapMs,
              during[at].elapsedMs - lastProgressMs
            );
            lastProgressMs = during[at].elapsedMs;
          }
        }
        maximumCounterGapMs = Math.max(maximumCounterGapMs, after.elapsedMs - lastProgressMs);
        classification =
          maximumCounterGapMs < 150
            ? 'counter-progress-during-callback-hole'
            : 'no-observed-counter-progress';
      }
    }
    callbackGaps.push({ fromMs: before.elapsedMs, toMs: after.elapsedMs, gapMs, classification });
  }
  if (
    record.truncated !== false ||
    record.finished !== true ||
    record.reason !== 'window-complete'
  ) {
    errors.push('Incomplete or truncated observation window');
  }
  if (positiveDisplacements.length) {
    errors.push('Unexplained positive displacement is not playback');
  }
  if (negativeAdvancement.length || frameBacksteps.length) {
    errors.push('Unexplained signed negative advancement');
  }
  if (rows[0].elapsedMs > 100 || elapsedMs - rows.at(-1).elapsedMs > 100) {
    errors.push('Missing initial or trailing native observation');
  }
  return {
    valid: errors.length === 0,
    errors,
    elapsedMs,
    nativeAdvance,
    nativeSignedAdvance,
    terminalNativeRate: rows.at(-1).rate,
    nativeRate: nativeAdvance / (elapsedMs / 1000),
    uiAdvance,
    rawFrameAdvance,
    frameAdvance,
    frameRate: frameAdvance / (elapsedMs / 1000),
    actualWraps,
    wrapTimesMs,
    postWrapFrameProgress: wrapObservations.map((wrap) =>
      currentFrames.some((frame, index) => {
        const before = currentFrames[index - 1];
        return (
          before &&
          before.elapsedMs > wrap.elapsedMs &&
          sameEpoch(before, wrap) &&
          sameEpoch(before, frame) &&
          !before.seeking &&
          !frame.seeking &&
          frame.mediaTime > before.mediaTime
        );
      })
    ),
    excludedDisplacements,
    negativeAdvancement,
    positiveDisplacements,
    naturalWraps,
    seekUncertaintyWindows,
    frameBacksteps,
    counterResets,
    counterAdvances,
    cachedHeadCertified,
    initialFrameGapMs: currentFrames[0]?.elapsedMs ?? elapsedMs,
    trailingFrameGapMs: elapsedMs - (currentFrames.at(-1)?.elapsedMs ?? 0),
    callbackGaps,
    audioEvidence:
      'Not measured: audio flags/counters do not establish audible continuity or smoothness',
  };
}

export function validateLiveRateProbeReport(report, requirements = {}, verifiedEvidence = {}) {
  const rates = requirements.rates ?? LIVE_RATE_PROBE_RATES;
  const minimumDurationMs = Math.max(20000, requirements.minimumDurationMs ?? 20000);
  const minimumWraps = requirements.shortLoop
    ? Math.max(5, requirements.minimumWraps ?? 5)
    : (requirements.minimumWraps ?? 0);
  const failures = [];
  const results = Array.isArray(report?.results) ? report.results : [];
  if (
    report?.protocol !== 'live-case' ||
    !Array.isArray(report.pageErrors) ||
    report.pageErrors.length
  ) {
    failures.push('Missing live-case protocol or page-error capture');
  }
  if (results.length !== rates.length) {
    failures.push('Missing or extra live-case rates');
  }
  const samples = rates.map((requested) => {
    const matches = results.filter((sample) => sample?.requested === requested);
    const summary = summarizePlaybackObservations(matches[0]?.observation, {
      priorFrameTail: verifiedEvidence.priorFrameTails?.[requested],
      inputCaptureComplete: verifiedEvidence.inputCaptureComplete === true,
    });
    if (
      matches.length !== 1 ||
      !summary.valid ||
      summary.elapsedMs < minimumDurationMs ||
      summary.callbackGaps.some(
        (gap) => gap.classification !== 'counter-progress-during-callback-hole'
      ) ||
      !Number.isFinite(summary.terminalNativeRate) ||
      Math.abs(summary.terminalNativeRate / requested - 1) > 0.001 ||
      summary.actualWraps < minimumWraps ||
      (minimumWraps > 0 && summary.postWrapFrameProgress?.[minimumWraps - 1] !== true) ||
      Math.abs(summary.nativeRate / requested - 1) > 0.1 ||
      Math.abs(summary.frameRate / requested - 1) > 0.1
    ) {
      failures.push(
        `${requested}x: incomplete window/wraps, unexplained gaps or incorrect signed native/presented progress`
      );
    }
    return { requested, summary };
  });
  return {
    passed: failures.length === 0,
    failures,
    samples,
    scope:
      'Measurement only; physical-device, navigation, presentation and audio acceptance require case evidence',
  };
}
