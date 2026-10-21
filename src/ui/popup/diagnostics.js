/* global __VSC_BROWSER__ */

import { sanitizeDiagnosticReport } from '../../utils/diagnostic-report.js';

const FRAME_LIMIT = 8;
const TOTAL_BYTES = 1024 * 1024 - 4096; // Reserve wrapper/metadata overhead.
const ACTIONS = new Set(['start', 'stop', 'report', 'clear']);
export const projectDiagnosticReport = sanitizeDiagnosticReport;

export function collectTabDiagnostics(tabId, action, { signal } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0 || !ACTIONS.has(action)) {
    return Promise.reject(new Error('Invalid diagnostic command'));
  }
  return new Promise((resolve, reject) => {
    const commandId = crypto.randomUUID();
    const frames = new Map();
    let firstReply;
    let timer;
    let settled = false;
    let totalBytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', onClose);
      signal?.removeEventListener('abort', onClose);
      try {
        chrome.runtime.onMessage.removeListener(onReply);
      } catch {
        // Extension context can disappear as the popup closes.
      }
    };
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      if (!frames.size && firstReply) {
        accept(null, firstReply);
      }
      resolve({
        ok: frames.size > 0,
        frames: [...frames.values()].map(({ frameId, report }) => ({ frameId, report })),
      });
    };
    const accept = (frameId, response) => {
      try {
        if (!response?.ok || frames.has(frameId)) {
          return;
        }
        const report = sanitizeDiagnosticReport(response.diagnostics);
        const bytes = new TextEncoder().encode(JSON.stringify(report)).length;
        const priority =
          frameId === 0
            ? 4
            : report.events.some(
                  (event) => Number.isFinite(event.mediaId) || event.event === 'suspected-top-jump'
                )
              ? 3
              : report.events.length
                ? 2
                : report.active
                  ? 1
                  : 0;
        // A busy ad frame must not consume the main page's diagnostic slot.
        // Keep earlier peers; among lower-priority peers evict larger frame IDs
        // first so replacement is deterministic and independent of Map order.
        const candidates = [...frames.values()]
          .filter((frame) => frame.priority < priority)
          .sort((a, b) => a.priority - b.priority || b.frameId - a.frameId);
        const evictions = [];
        let remainingBytes = totalBytes;
        let remainingCount = frames.size;
        while (
          (remainingCount >= FRAME_LIMIT || remainingBytes + bytes > TOTAL_BYTES) &&
          candidates.length
        ) {
          const victim = candidates.shift();
          evictions.push(victim.frameId);
          remainingBytes -= victim.bytes;
          remainingCount--;
        }
        if (remainingCount >= FRAME_LIMIT || remainingBytes + bytes > TOTAL_BYTES) {
          return;
        }
        evictions.forEach((id) => frames.delete(id));
        frames.set(frameId, { frameId, report, bytes, priority });
        totalBytes = remainingBytes + bytes;
      } catch {
        // Invalid or over-budget frame reports never enter the export.
      }
    };
    const onClose = () => finish(new Error('Popup closed'));
    const onReply = (message, sender) => {
      try {
        if (
          !settled &&
          message?.type === 'VSC_FRAME_RESULT' &&
          message.commandId === commandId &&
          sender?.id === chrome.runtime.id &&
          sender.tab?.id === tabId &&
          Number.isInteger(sender.frameId) &&
          sender.frameId >= 0
        ) {
          accept(sender.frameId, message.response);
        }
      } catch {
        // Ignore malformed senders and an invalidated runtime.
      }
    };
    try {
      if (signal?.aborted) {
        finish(new Error('Popup closed'));
        return;
      }
      signal?.addEventListener('abort', onClose, { once: true });
      chrome.runtime.onMessage.addListener(onReply);
      window.addEventListener('pagehide', onClose, { once: true });
      timer = setTimeout(() => finish(), 350);
      chrome.tabs.sendMessage(
        tabId,
        { type: 'VSC_VIDEO_DIAGNOSTICS', payload: { action }, commandId },
        (response) => {
          if (settled) {
            return;
          }
          try {
            if (chrome.runtime.lastError) {
              // A child frame can still reply after the first channel fails.
              // Keep the full collection deadline; do not expose raw errors.
              return;
            }
            firstReply = response;
          } catch {
            finish(new Error('Unable to contact this tab'));
          }
        }
      );
    } catch {
      finish(new Error('Unable to contact this tab'));
    }
  });
}

export function initializeDiagnosticsPanel(doc = document) {
  const section = doc.querySelector('#video-diagnostics');
  if (!section) {
    return () => {};
  }
  const view = doc.defaultView;
  const status = section.querySelector('[role="status"]');
  const output = section.querySelector('textarea');
  const start = section.querySelector('[data-diagnostic="start"]');
  const stop = section.querySelector('[data-diagnostic="stop"]');
  const clear = section.querySelector('[data-diagnostic="clear"]');
  const copy = section.querySelector('[data-diagnostic="copy"]');
  const share = section.querySelector('[data-diagnostic="share"]');
  let prepared = '';
  let generation = 0;
  let closed = false;
  let collection = null;
  const listeners = [];
  const urls = new Map();
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  const say = (text) => {
    if (!closed) {
      status.textContent = text;
    }
  };
  const revoke = (url) => {
    view.clearTimeout(urls.get(url));
    urls.delete(url);
    try {
      view.URL.revokeObjectURL(url);
    } catch {
      // Closing extension contexts may have already released the URL.
    }
  };
  const fallback = (text) => {
    say(`${text} Select the report below and use Copy or Save to Files.`);
    output.focus();
    output.select();
  };
  const run = async (action) => {
    const ownGeneration = ++generation;
    collection?.abort();
    collection = new AbortController();
    const signal = collection.signal;
    start.disabled = stop.disabled = clear.disabled = copy.disabled = share.disabled = true;
    if (action === 'start' || action === 'clear') {
      prepared = '';
      output.value = '';
      output.hidden = true;
    }
    say(action === 'start' ? 'Starting a new capture…' : 'Preparing diagnostics…');
    try {
      const tabId = await new Promise((resolve, reject) => {
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError || !Number.isInteger(tabs?.[0]?.id)) {
              reject(new Error('No active tab'));
            } else {
              resolve(tabs[0].id);
            }
          });
        } catch {
          reject(new Error('No active tab'));
        }
      });
      if (closed || ownGeneration !== generation) {
        return;
      }
      const result = await collectTabDiagnostics(tabId, action, { signal });
      if (closed || ownGeneration !== generation) {
        return;
      }
      if (!result.ok) {
        throw new Error('No diagnostic report');
      }
      if (action === 'clear') {
        say('Capture cleared. Start a new capture to record more events.');
        return;
      }
      let extensionVersion = 'unknown';
      try {
        const version = chrome.runtime.getManifest().version;
        if (/^\d+(?:\.\d+){1,3}$/.test(version)) {
          extensionVersion = version;
        }
      } catch {
        // Keep metadata bounded when the extension context is invalidated.
      }
      const browser =
        typeof __VSC_BROWSER__ === 'string' &&
        ['safari', 'chrome', 'firefox'].includes(__VSC_BROWSER__)
          ? __VSC_BROWSER__
          : 'unknown';
      prepared = JSON.stringify({
        schema: 1,
        extensionVersion,
        browser,
        generatedAt: new Date().toISOString(),
        frames: result.frames,
      });
      output.value = prepared;
      output.hidden = false;
      copy.disabled = share.disabled = false;
      const active = result.frames.some(({ report }) => report.active);
      const count = result.frames.reduce((sum, { report }) => sum + report.events.length, 0);
      say(
        `${active ? 'Capturing' : 'Capture stopped'} · ${count} events in ${result.frames.length} frame${result.frames.length === 1 ? '' : 's'}. Report ready to copy or share.`
      );
    } catch {
      if (!closed && ownGeneration === generation) {
        say(
          'No report received. Keep this tab open and try again; check StayFast is enabled for this page.'
        );
      }
    } finally {
      if (!closed && ownGeneration === generation) {
        start.disabled = stop.disabled = clear.disabled = false;
        copy.disabled = share.disabled = !prepared;
      }
    }
  };
  on(start, 'click', () => run('start'));
  on(stop, 'click', () => run('stop'));
  on(clear, 'click', () => run('clear'));
  on(copy, 'click', async () => {
    if (!prepared || closed) {
      return;
    }
    try {
      // Invoke clipboard in this button's gesture, never after collection.
      await view.navigator.clipboard.writeText(prepared);
      say('Report copied.');
    } catch {
      fallback('Clipboard unavailable.');
    }
  });
  on(share, 'click', async () => {
    if (!prepared || closed) {
      return;
    }
    const name = 'stayfast-video-diagnostics.json';
    try {
      const file = new view.File([prepared], name, { type: 'application/json' });
      if (
        view.navigator.share &&
        (!view.navigator.canShare || view.navigator.canShare({ files: [file] }))
      ) {
        // Prepared File is shared directly from this later user gesture.
        await view.navigator.share({ files: [file] });
        say('Report shared.');
        return;
      }
      const url = view.URL.createObjectURL(file);
      urls.set(
        url,
        view.setTimeout(() => revoke(url), 30000)
      );
      const link = doc.createElement('a');
      link.href = url;
      link.download = name;
      doc.body.append(link);
      link.click();
      link.remove();
      say('Report download requested. If unavailable, select the report below to save it.');
    } catch (error) {
      fallback(error?.name === 'AbortError' ? 'Share cancelled.' : 'Sharing unavailable.');
    }
  });
  const cleanup = () => {
    closed = true;
    generation++;
    collection?.abort();
    collection = null;
    listeners.splice(0).forEach((remove) => remove());
    for (const url of [...urls.keys()]) {
      revoke(url);
    }
    prepared = '';
    output.value = '';
  };
  on(view, 'pagehide', cleanup);
  run('report');
  return cleanup;
}
