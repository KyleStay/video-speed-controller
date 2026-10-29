import { bridgeEvents } from '../utils/bridge-events.js';

/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start. Communicates with inject.js (MAIN world) via
 * CustomEvents on document.documentElement.
 *
 * Settings handshake:
 *   1. Bridge registers a persistent VSC_REQUEST_SETTINGS listener
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_start
 *   3. Bridge responds with VSC_SETTINGS_READY once chrome.storage resolves
 */

import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';
import { SYNCED_SETTING_KEYS } from '../utils/setting-keys.js';

import { SPEED_LIMITS } from '../utils/speed-limits.js';
import { sanitizeDiagnosticReport } from '../utils/diagnostic-report.js';

let bridgeInitialized = false;
let pendingLastSpeed = null;
let lastSpeedWriteTimer = null;
let latestSettingsSnapshot = null;
let pageShouldAbort = null;
let storageGeneration = 0;
let resumeReadPromise = null;
let settingsReadSequence = 0;
let latestCompletedRead = null;
const storageKeyChanges = new Map();

// Firefox denies page access to objects created in a content-script realm.
// Clone only the already-filtered bridge payload into the page's realm; Chrome
// uses its native CustomEvent transfer. Never expose extension APIs/functions.
export function dispatchPageEvent(type, detail) {
  const pageDetail =
    detail !== null && typeof detail === 'object' && typeof globalThis.cloneInto === 'function'
      ? globalThis.cloneInto(detail, document.defaultView)
      : detail;
  bridgeEvents.dispatchEvent(new CustomEvent(type, { detail: pageDetail }));
}

function shouldAbortForSettings(settings) {
  const disabled = settings.enabled === false;
  // Legacy blacklist: only checked when siteRules hasn't been initialized yet
  // (pre-migration devices). Once migration runs, siteRules is the source of
  // truth. The blacklist is preserved in storage for sync compat with older
  // extension versions but must not shadow siteRules edits.
  const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, location.href);
  const siteRuleMatch = matchSiteRule(settings.siteRules, location.href);
  const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
  return disabled || blacklisted || siteDisabled;
}

function cloneSettingsSnapshot(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function storageValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyStorageChangesToSnapshot(changes, snapshot = latestSettingsSnapshot) {
  if (!snapshot) {
    return;
  }
  for (const [key, change] of Object.entries(changes)) {
    if (change.newValue === undefined) {
      delete snapshot[key];
    } else {
      snapshot[key] = cloneSettingsSnapshot({ value: change.newValue }).value;
    }
  }
}

function createSnapshotChanges(previous, current) {
  const changes = {};
  for (const key of SYNCED_SETTING_KEYS) {
    const oldValue = previous?.[key];
    const newValue = current[key];
    if (storageValuesEqual(oldValue, newValue)) {
      continue;
    }
    changes[key] = { oldValue };
    if (newValue !== undefined) {
      changes[key].newValue = newValue;
    }
  }
  return changes;
}

function relayStorageChanges(changes) {
  const relayChanges = { ...changes };
  delete relayChanges.enabled;
  delete relayChanges.blacklist;
  if (Object.keys(relayChanges).length > 0) {
    dispatchPageEvent('VSC_STORAGE_CHANGED', relayChanges);
  }
}

function reconcilePageLifecycle(nextShouldAbort) {
  if (nextShouldAbort === pageShouldAbort) {
    return;
  }
  pageShouldAbort = nextShouldAbort;
  dispatchPageEvent('VSC_MESSAGE', {
    type: nextShouldAbort ? 'VSC_TEARDOWN' : 'VSC_REINIT',
  });
}

async function readSettingsSnapshot() {
  // Bounded fetch (not get(null)): this content script runs in every frame, so
  // we pull only the keys the controller actually uses instead of the whole
  // sync store. SYNCED_SETTING_KEYS is the shared contract with the MAIN world.
  const generationAtStart = storageGeneration;
  const sequence = ++settingsReadSequence;
  const settings = cloneSettingsSnapshot(await chrome.storage.sync.get(SYNCED_SETTING_KEYS));

  // A storage event may arrive while get() resolves an older snapshot. Merge
  // only the affected keys, preserving other changes missed during suspension.
  // This map holds at most one entry per bounded synced key; no retries/polling.
  for (const [key, { generation, change }] of storageKeyChanges) {
    if (generation > generationAtStart) {
      applyStorageChangesToSnapshot({ [key]: change }, settings);
    }
  }

  // A delayed handshake must not replace a later read that already completed.
  if (latestCompletedRead && sequence < latestCompletedRead.sequence) {
    return latestCompletedRead.settings;
  }
  latestCompletedRead = { sequence, settings };
  return settings;
}

function cancelPendingSpeedWrite() {
  clearTimeout(lastSpeedWriteTimer);
  lastSpeedWriteTimer = null;
  pendingLastSpeed = null;
}

function schedulePendingSpeedWrite() {
  if (pendingLastSpeed === null || lastSpeedWriteTimer !== null || resumeReadPromise) {
    return;
  }
  // MAIN already debounces writes. Bridge coalescing also bounds page-forged
  // event loops without losing the latest legitimate speed.
  lastSpeedWriteTimer = setTimeout(async () => {
    const lastSpeed = pendingLastSpeed;
    pendingLastSpeed = null;
    lastSpeedWriteTimer = null;
    try {
      await chrome.storage.sync.set({ lastSpeed });
    } catch (error) {
      console.error('[VSC] Speed persistence failed:', error);
    }
  }, 1000);
}

function createSettingsPayload(settings) {
  const shouldAbort = shouldAbortForSettings(settings);

  latestSettingsSnapshot = cloneSettingsSnapshot(settings);
  pageShouldAbort = shouldAbort;

  if (shouldAbort) {
    return { abort: true };
  }

  const hostname = location.hostname.replace(/^www\./, '');

  // Strip keys the MAIN world shouldn't see
  const pageSettings = cloneSettingsSnapshot(settings);
  delete pageSettings.blacklist;
  delete pageSettings.enabled;

  return { settings: pageSettings, hostname };
}

async function reconcileSettingsAfterResume() {
  if (resumeReadPromise) {
    return resumeReadPromise;
  }

  // Pause queued persistence until the snapshot tells us whether an external
  // reset/replacement superseded it. Unchanged storage preserves a recent user
  // speed even if they switched apps before the bridge debounce completed.
  clearTimeout(lastSpeedWriteTimer);
  lastSpeedWriteTimer = null;
  const speedBeforeResume = latestSettingsSnapshot?.lastSpeed;
  resumeReadPromise = (async () => {
    try {
      const settings = await readSettingsSnapshot();

      const changes = createSnapshotChanges(latestSettingsSnapshot, settings);
      if (!storageValuesEqual(speedBeforeResume, settings.lastSpeed)) {
        cancelPendingSpeedWrite();
      }
      latestSettingsSnapshot = cloneSettingsSnapshot(settings);
      reconcilePageLifecycle(shouldAbortForSettings(settings));
      relayStorageChanges(changes);
    } catch (error) {
      console.error('[VSC] Settings reconciliation read failed:', error);
      cancelPendingSpeedWrite();
      reconcilePageLifecycle(true);
    } finally {
      resumeReadPromise = null;
      schedulePendingSpeedWrite();
    }
  })();

  return resumeReadPromise;
}

async function init() {
  try {
    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    // Re-initialization after an enable toggle or document replacement performs
    // a new settings load. Keep this listener alive and fetch the bounded key
    // set for every request so the MAIN world never falls back to stale defaults.
    // Storage failures fail closed: an invalidated extension context must not
    // accidentally initialize an extension that may be disabled for this site.
    bridgeEvents.addEventListener('VSC_REQUEST_SETTINGS', async () => {
      let payload;
      try {
        payload = createSettingsPayload(await readSettingsSnapshot());
      } catch (error) {
        console.error('[VSC] Settings bridge read failed:', error);
        payload = { abort: true };
      }
      dispatchPageEvent('VSC_SETTINGS_READY', payload);
    });

    // --- Ongoing: storage change relay + lifecycle ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      storageGeneration += 1;
      for (const key of SYNCED_SETTING_KEYS) {
        if (Object.hasOwn(changes, key)) {
          storageKeyChanges.set(key, {
            generation: storageGeneration,
            change: cloneSettingsSnapshot(changes[key]),
          });
        }
      }
      applyStorageChangesToSnapshot(changes);
      applyStorageChangesToSnapshot(changes, latestCompletedRead?.settings);

      if (changes.lastSpeed && changes.lastSpeed.newValue === undefined) {
        cancelPendingSpeedWrite();
      }

      // Lifecycle: only the popup's enabled toggle triggers teardown/reinit.
      // Options page never writes `enabled`, so saving options can't trigger
      // lifecycle — it only relays settings via VSC_STORAGE_CHANGED below.
      // siteRules/blacklist changes take effect on next page load.
      if (changes.enabled?.newValue === false) {
        pageShouldAbort = true;
        dispatchPageEvent('VSC_MESSAGE', { type: 'VSC_TEARDOWN' });
        return;
      }
      if (changes.enabled?.oldValue === false && changes.enabled?.newValue !== false) {
        const nextShouldAbort = latestSettingsSnapshot
          ? shouldAbortForSettings(latestSettingsSnapshot)
          : false;
        reconcilePageLifecycle(nextShouldAbort);
      }

      // Relay changes to MAIN world (filter out keys MAIN never received)
      relayStorageChanges(changes);
    });

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        void reconcileSettingsAfterResume();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void reconcileSettingsAfterResume();
      }
    });

    // --- Ongoing: popup/background message relay ---
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request?.type === 'VSC_GET_SITE_INFO') {
        // tabs.query exposes the ID without granting access to tab URLs. Read
        // this isolated top frame directly; page events must not supply the site
        // whose extension setting the popup will change.
        try {
          const url = new URL(window.location.href);
          sendResponse(
            window === window.top && ['http:', 'https:'].includes(url.protocol)
              ? { ok: true, href: url.href }
              : { ok: false }
          );
        } catch {
          sendResponse({ ok: false });
        }
        return false;
      }
      const requestId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const requestWithId = { ...request, requestId };

      const timeout = setTimeout(() => {
        bridgeEvents.removeEventListener('VSC_MESSAGE_RESULT', handleResult);
        sendResponse({ ok: false, mediaCount: null, error: 'timeout' });
      }, 250);

      const handleResult = (event) => {
        if (event.detail?.requestId !== requestId) {
          return;
        }
        clearTimeout(timeout);
        bridgeEvents.removeEventListener('VSC_MESSAGE_RESULT', handleResult);
        let response = event.detail;
        if (request.type === 'VSC_VIDEO_DIAGNOSTICS') {
          try {
            response = {
              requestId,
              ok: event.detail.ok === true,
              diagnostics: sanitizeDiagnosticReport(event.detail.diagnostics),
            };
          } catch {
            response = { requestId, ok: false, error: 'invalid-diagnostics' };
          }
        }
        sendResponse(response);
        // Only popup requests opt into per-frame replies. tabs.sendMessage's
        // callback otherwise reports whichever frame answered first.
        if (typeof request.commandId === 'string') {
          try {
            chrome.runtime.sendMessage(
              {
                type: 'VSC_FRAME_RESULT',
                commandId: request.commandId,
                response,
              },
              () => {
                // The popup can close before the frame finishes responding.
                void chrome.runtime.lastError;
              }
            );
          } catch {
            // An invalidated bridge must not break a page's media controls.
          }
        }
      };

      bridgeEvents.addEventListener('VSC_MESSAGE_RESULT', handleResult);
      dispatchPageEvent('VSC_MESSAGE', requestWithId);
      return true;
    });

    // --- Ongoing: speed write-back from MAIN world ---
    const handleWriteStorage = (e) => {
      try {
        const data = e.detail;
        if (!data || typeof data !== 'object') {
          return;
        }

        // Only lastSpeed can be written from MAIN world (trust boundary)
        if ('lastSpeed' in data) {
          const speed = data.lastSpeed;
          if (typeof speed === 'number' && Number.isFinite(speed)) {
            pendingLastSpeed = Math.min(Math.max(speed, SPEED_LIMITS.MIN), SPEED_LIMITS.MAX);
            schedulePendingSpeedWrite();
          }
        }
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          bridgeEvents.removeEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
        }
      }
    };
    bridgeEvents.addEventListener('VSC_WRITE_STORAGE', handleWriteStorage);

    // Script worlds can start in either order. Pending MAIN requests retry on
    // this signal; a startup that already timed out can also recover safely.
    dispatchPageEvent('VSC_BRIDGE_READY');
  } catch (error) {
    console.error('[VSC] Bridge init failed:', error);
  }
}

init();
