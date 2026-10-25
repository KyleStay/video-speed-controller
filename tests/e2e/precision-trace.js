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
