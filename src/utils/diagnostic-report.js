// Shared trust boundary for diagnostics entering extension contexts. This module
// is pure: it never touches page globals, extension APIs, storage, or the DOM.
const MAX_BYTES = 512 * 1024;
const labels = new Set([
  'loadstart',
  'emptied',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'play',
  'playing',
  'pause',
  'webkitbeginfullscreen',
  'webkitendfullscreen',
  'webkitpresentationmodechanged',
  'enterpictureinpicture',
  'leavepictureinpicture',
  'capture-start',
  'capture-stop',
  'duration-limit',
  'before-controller',
  'after-controller',
  'before-inline-policy',
  'after-inline-policy',
  'controller-remove',
  'focusin',
  'scroll',
  'viewport-scroll',
  'viewport-resize',
  'pointerdown',
  'touchstart',
  'wheel',
  'keydown',
  'pagehide',
  'pageshow',
  'visibilitychange',
  'popstate',
  'frame',
  'suspected-top-jump',
  'fullscreenchange',
  'extension-teardown',
  'scroll-restore-before',
  'scroll-restore-after',
  'scroll-before-jump',
]);
const reasons = new Set([
  'manual',
  'popup',
  'command',
  'test',
  'debug',
  'resume',
  'other',
  'suspected-top-jump',
  'diagnostic-build',
]);
const tags = new Set([
  'BODY',
  'HTML',
  'VIDEO',
  'AUDIO',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'DIV',
  'A',
  'DIALOG',
  'OTHER',
]);
const modes = new Set(['inline', 'fullscreen', 'picture-in-picture', 'unknown']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);

// Bound the input without JSON.stringify(raw): neither accessors nor toJSON are
// invoked. Unknown fields are discarded later, but cannot hide an enormous tree.
function inspect(raw) {
  let nodes = 0;
  let bytes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 50000 || depth > 8 || bytes > MAX_BYTES) {
      throw new Error('Diagnostic report exceeds limits');
    }
    if (value === null || typeof value === 'boolean') {
      bytes += 5;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      bytes += String(value).length;
    } else if (typeof value === 'string') {
      if (value.length > MAX_BYTES) {
        throw new Error('Diagnostic text exceeds limits');
      }
      bytes += new TextEncoder().encode(JSON.stringify(value)).length;
    } else if (value && typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && proto !== null && Object.getPrototypeOf(proto) !== null) {
        throw new Error('Invalid diagnostic prototype');
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.length > 2000) {
        throw new Error('Too many diagnostic fields');
      }
      for (const key of names) {
        if (Array.isArray(value) && key === 'length') {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (unsafe.has(key) || descriptor.get || descriptor.set) {
          throw new Error('Unsafe diagnostic property');
        }
        if (key.length > MAX_BYTES) {
          throw new Error('Diagnostic field name exceeds limits');
        }
        bytes += new TextEncoder().encode(JSON.stringify(key)).length + 2;
        visit(descriptor.value, depth + 1);
      }
    } else {
      throw new Error('Invalid diagnostic value');
    }
  };
  visit(raw);
  if (bytes > MAX_BYTES) {
    throw new Error('Diagnostic report exceeds limits');
  }
}
const number = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) {
    throw new Error('Invalid diagnostic number');
  }
  return value;
};
function numbers(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid diagnostic geometry');
  }
  const result = {};
  for (const key of keys) {
    if (Object.hasOwn(raw, key)) {
      result[key] = number(raw[key]);
    }
  }
  return result;
}
const geometry = (raw) =>
  numbers(raw, ['x', 'y', 'width', 'height', 'scrollWidth', 'scrollHeight']);
const rect = (raw) => (raw === null ? null : numbers(raw, ['x', 'y', 'width', 'height']));

function ownData(raw, key) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Missing diagnostic field');
  }
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new Error('Missing diagnostic data field');
  }
  return descriptor.value;
}

export function sanitizeDiagnosticReport(raw) {
  inspect(raw);
  const schema = ownData(raw, 'schema');
  const active = ownData(raw, 'active');
  const reason = ownData(raw, 'reason');
  const rawEvents = ownData(raw, 'events');
  const eventCount = Array.isArray(rawEvents) ? ownData(rawEvents, 'length') : null;
  if (
    schema !== 1 ||
    typeof active !== 'boolean' ||
    !reasons.has(reason) ||
    !Array.isArray(rawEvents) ||
    !Number.isInteger(eventCount) ||
    eventCount < 0 ||
    eventCount > 240
  ) {
    throw new Error('Unsupported diagnostic report');
  }
  const events = Array.from({ length: eventCount }, (_, index) => {
    const entry = ownData(rawEvents, String(index));
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Invalid diagnostic event');
    }
    const event = ownData(entry, 'event');
    if (!labels.has(event)) {
      throw new Error('Invalid diagnostic event label');
    }
    const item = { seq: number(ownData(entry, 'seq')), t: number(ownData(entry, 't')), event };
    if (Object.hasOwn(entry, 'phase')) {
      if (![1, 2].includes(entry.phase)) {
        throw new Error('Invalid diagnostic phase');
      }
      item.phase = entry.phase;
    }
    if (Object.hasOwn(entry, 'trigger')) {
      if (!labels.has(entry.trigger)) {
        throw new Error('Invalid diagnostic trigger');
      }
      item.trigger = entry.trigger;
    }
    if (Object.hasOwn(entry, 'mediaId')) {
      item.mediaId = number(entry.mediaId);
    }
    if (Object.hasOwn(entry, 'inputAgoMs')) {
      item.inputAgoMs = entry.inputAgoMs === null ? null : number(entry.inputAgoMs);
    }
    if (Object.hasOwn(entry, 'page')) {
      item.page = geometry(entry.page);
    }
    if (Object.hasOwn(entry, 'viewport')) {
      item.viewport = numbers(entry.viewport, ['x', 'y', 'width', 'height', 'scale']);
    }
    if (Object.hasOwn(entry, 'activeTag')) {
      if (!tags.has(entry.activeTag)) {
        throw new Error('Invalid diagnostic focus tag');
      }
      item.activeTag = entry.activeTag;
    }
    if (Object.hasOwn(entry, 'scrollers')) {
      const scrollers = ownData(entry, 'scrollers');
      const count = Array.isArray(scrollers) ? ownData(scrollers, 'length') : null;
      if (!Array.isArray(scrollers) || !Number.isInteger(count) || count < 0 || count > 8) {
        throw new Error('Invalid diagnostic scrollers');
      }
      item.scrollers = Array.from({ length: count }, (_, index) =>
        numbers(ownData(scrollers, String(index)), [
          'id',
          'x',
          'y',
          'width',
          'height',
          'scrollWidth',
          'scrollHeight',
        ])
      );
    }
    if (Object.hasOwn(entry, 'media')) {
      const media = numbers(entry.media, ['readyState', 'networkState', 'rate', 'time']);
      for (const key of ['rect', 'controllerRect', 'hostRect']) {
        if (Object.hasOwn(entry.media, key)) {
          media[key] = rect(entry.media[key]);
        }
      }
      for (const key of [
        'paused',
        'playsInline',
        'webkitInline',
        'controls',
        'nativeFullscreen',
        'custom',
      ]) {
        if (Object.hasOwn(entry.media, key)) {
          if (typeof entry.media[key] !== 'boolean') {
            throw new Error('Invalid diagnostic media state');
          }
          media[key] = entry.media[key];
        }
      }
      if (Object.hasOwn(entry.media, 'nativeMode')) {
        if (!modes.has(entry.media.nativeMode)) {
          throw new Error('Invalid diagnostic native mode');
        }
        media.nativeMode = entry.media.nativeMode;
      }
      item.media = media;
    }
    return item;
  });
  const result = { schema: 1, active, reason, events };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) {
    throw new Error('Diagnostic report exceeds limits');
  }
  return result;
}
