/** Fixture-only observer of genuine pointer paths; never drives the player. */
export function installPrecisionTrace(video) {
  const trace = { gestures: [], active: null, report: null, sequence: 0 };
  window.__stayfastPrecision = trace;
  // An independent piecewise path oracle, rather than the product's overlap formula.
  const segmentGain = (from, to, center) => {
    const cuts = [0, 1];
    if (to !== from) {
      for (const offset of [-132, -88, -44, 44, 88, 132]) {
        const fraction = (center + offset - from) / (to - from);
        if (fraction > 0 && fraction < 1) {
          cuts.push(fraction);
        }
      }
    }
    cuts.sort((a, b) => a - b);
    let gain = 0;
    for (let index = 1; index < cuts.length; index++) {
      const distance = Math.abs(
        from + ((to - from) * (cuts[index - 1] + cuts[index])) / 2 - center
      );
      const rate = distance < 44 ? 1 : distance < 88 ? 0.5 : distance < 132 ? 0.25 : 0.1;
      gain += (cuts[index] - cuts[index - 1]) * rate;
    }
    return gain;
  };
  const gestureTypes = ['pointermove', 'pointerup', 'pointercancel'];
  let boundRange;
  let boundListener;
  let gestureSurface;
  const surfaceFor = (range) => {
    if (!range) {
      return null;
    }
    const owner = video.vsc?.iosPlayer;
    if (owner?.scrubber?.range === range) {
      return { owner, scrubber: owner.scrubber, mode: 'fullscreen' };
    }
    const inline = video.vsc?.controlsManager?.inlinePlayer;
    if (inline?.scrubber?.range === range) {
      return { owner: inline.scrubber.owner, scrubber: inline.scrubber, mode: 'inline' };
    }
    return null;
  };
  const stopGesture = () => {
    for (const type of gestureTypes) {
      window.removeEventListener(type, record, true);
    }
  };
  function record(event) {
    const surface = event.type === 'pointerdown' ? surfaceFor(boundRange) : gestureSurface;
    if (!surface) {
      return;
    }
    const { owner: player, scrubber, mode } = surface;
    const range = scrubber.range;
    if (event.type === 'pointerdown' && scrubber.active) {
      stopGesture();
      gestureSurface = surface;
      // Registered after the product's capture listeners, so snapshots are
      // synchronous and observe each delivered event after its seek preview.
      for (const type of gestureTypes) {
        window.addEventListener(type, record, true);
      }
      const gesture = {
        number: ++trace.sequence,
        pointer: event.pointerId,
        mode,
        points: [],
        truncated: false,
      };
      trace.active = gesture;
      trace.gestures.push(gesture);
      if (trace.gestures.length > 12) {
        trace.gestures.shift();
      }
    }
    const gesture = trace.active;
    if (!gesture || event.pointerId !== gesture.pointer) {
      return;
    }
    const rect = range.getBoundingClientRect();
    const bounds = player.seekBounds();
    const point = {
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      center: rect.top + rect.height / 2,
      width: rect.width,
      bounds,
    };
    point.value = scrubber.value;
    point.rate = scrubber.rate;
    point.active = scrubber.active;
    point.hint = player.ui.refs.scrubHint?.textContent || '';
    point.selectedTime =
      (mode === 'inline'
        ? video.vsc?.controlsManager?.inlinePlayer?.refs.time
        : player.ui.refs.current
      )?.textContent || '';
    point.fill = parseFloat(getComputedStyle(range).getPropertyValue('--seek-progress'));
    if (gesture.points.length < 512) {
      gesture.points.push(point);
    } else {
      gesture.truncated = true;
    }
    if (event.type !== 'pointerup' && event.type !== 'pointercancel') {
      return;
    }
    trace.active = null;
    gestureSurface = null;
    stopGesture();
    let maxError = 0;
    let verticalDrift = 0;
    const bands = [];
    for (let index = 0; index < gesture.points.length; index++) {
      const current = gesture.points[index];
      if (current.active && bands.at(-1) !== current.rate) {
        bands.push(current.rate);
      }
      if (!index || event.type === 'pointercancel') {
        continue;
      }
      const previous = gesture.points[index - 1];
      const delta =
        ((current.x - previous.x) / current.width) *
        (current.bounds[1] - current.bounds[0]) *
        segmentGain(previous.y, current.y, current.center);
      const expected = Math.max(
        current.bounds[0],
        Math.min(current.bounds[1], previous.value + delta)
      );
      maxError = Math.max(maxError, Math.abs(current.value - expected));
      if (Math.abs(current.x - previous.x) < 0.001) {
        verticalDrift = Math.max(verticalDrift, Math.abs(current.value - previous.value));
      }
    }
    const last = gesture.points.at(-1);
    trace.report = {
      gesture: gesture.number,
      mode,
      samples: gesture.points.length,
      truncated: gesture.truncated,
      bands,
      rateLabelsValid: gesture.points.every(
        (point) =>
          !point.active ||
          point.hint ===
            (point.rate === 0.5
              ? '×1/2'
              : point.rate === 0.25
                ? '×1/4'
                : point.rate === 0.1
                  ? '×1/10'
                  : '')
      ),
      fractionalFeedback: gesture.points.some(
        (point) => point.active && /\d+:\d{2}\.\d{2}/.test(point.selectedTime)
      ),
      maxError: Number(maxError.toFixed(6)),
      verticalDrift: Number(verticalDrift.toFixed(6)),
      finalError: Number(Math.abs(video.currentTime - last.value).toFixed(6)),
      delta: Number((last.value - gesture.points[0].value).toFixed(6)),
      active: scrubber.active,
      paused: video.paused,
    };
    trace.onReport?.();
  }
  trace.bind = (range) => {
    const listener = surfaceFor(range)?.scrubber.listeners[0];
    if (!listener || (range === boundRange && listener === boundListener)) {
      return;
    }
    boundRange?.removeEventListener('pointerdown', record);
    stopGesture();
    trace.active = null;
    gestureSurface = null;
    boundRange = range;
    boundListener = listener;
    range.addEventListener('pointerdown', record);
  };
  window.addEventListener(
    'pagehide',
    () => {
      stopGesture();
      boundRange?.removeEventListener('pointerdown', record);
      boundRange = null;
      boundListener = null;
      trace.active = null;
      gestureSurface = null;
    },
    { once: true }
  );
}

/** Fixture-only evidence of native picture swipes; never changes media or input. */
export function installSurfaceTrace(video) {
  const trace = { report: null, sequence: 0 };
  window.__stayfastSurface = trace;
  let pending = null;
  const surface = () => {
    const owner = video.vsc?.iosPlayer;
    const inline = video.vsc?.controlsManager?.inlinePlayer;
    return owner?.active
      ? { stage: owner.ui.stage, scrubber: owner.scrubber, mode: 'fullscreen' }
      : { stage: video, scrubber: inline?.scrubber, mode: 'inline' };
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(
      type,
      (event) => {
        if (event.pointerType !== 'touch') {return;}
        if (type === 'pointerdown') {
          if (pending) {return;}
          const current = surface();
          const path = event.composedPath();
          if (
            !path.includes(current.stage) &&
            event.target.getAttribute?.('aria-label') !== 'Video picture'
          )
            {return;}
          pending = {
            id: event.pointerId,
            wasPlaying: !video.paused,
            trusted: event.isTrusted,
            report: null,
          };
          return;
        }
        const gesture = pending;
        if (!gesture || gesture.id !== event.pointerId) {return;}
        // Native event dispatch can run a microtask checkpoint between capture
        // listeners. Observe next task, after the product's target handlers finish.
        setTimeout(() => {
          if (pending !== gesture) {return;}
          const current = surface();
          const scrubber = current.scrubber;
          if (!gesture.report && scrubber?.active && scrubber.surface) {
            gesture.report = {
              gesture: ++trace.sequence,
              mode: current.mode,
              moves: 0,
              bands: [],
              active: true,
              trusted: gesture.trusted,
              start: scrubber.startTime,
              after: video.currentTime,
              selected: scrubber.value,
              delta: 0,
              wasPlaying: gesture.wasPlaying,
              paused: video.paused,
              labelsValid: true,
              fractionalFeedback: false,
            };
          }
          const report = gesture.report;
          if (report) {
            report.trusted = report.trusted && event.isTrusted;
            if (scrubber.active) {
              report.moves++;
              if (!report.bands.includes(scrubber.rate)) {report.bands.push(scrubber.rate);}
              const expected =
                scrubber.rate === 0.1
                  ? '×1/10'
                  : scrubber.rate === 0.25
                    ? '×1/4'
                    : scrubber.rate === 0.5
                      ? '×1/2'
                      : '';
              report.labelsValid =
                report.labelsValid && scrubber.ui.refs.scrubHint.textContent === expected;
              report.fractionalFeedback =
                report.fractionalFeedback ||
                /\d+:\d{2}\.\d{2}/.test(scrubber.range.getAttribute('aria-valuetext') || '');
            }
            report.active = scrubber.active;
            report.after = video.currentTime;
            report.selected = scrubber.value;
            report.delta = report.after - report.start;
            report.paused = video.paused;
            trace.report = { ...report, bands: [...report.bands] };
            trace.onReport?.();
          }
          if (type === 'pointerup' || type === 'pointercancel') {pending = null;}
        }, 0);
      },
      true
    );
  }
}
