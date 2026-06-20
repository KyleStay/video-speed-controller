/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start. Communicates with inject.js (MAIN world) via
 * CustomEvents on document.documentElement.
 *
 * Settings handshake:
 *   1. Bridge stashes settings in closure, registers VSC_REQUEST_SETTINGS listener
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_start
 *   3. Bridge responds with VSC_SETTINGS_READY once chrome.storage resolves
 */

import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';

// Speed limits for page→bridge write validation.
// Duplicated from constants.js (ISOLATED world can't import page modules).
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

const docEl = document.documentElement;
let bridgeInitialized = false;

async function loadSettingsPayload() {
  const settings = await chrome.storage.sync.get(null);

  const disabled = settings.enabled === false;
  // Legacy blacklist: only checked when siteRules hasn't been initialized yet
  // (pre-migration devices). Once migration runs, siteRules is the source of
  // truth. The blacklist is preserved in storage for sync compat with older
  // extension versions but must not shadow siteRules edits.
  const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, location.href);
  const siteRuleMatch = matchSiteRule(settings.siteRules, location.href);
  const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
  const shouldAbort = disabled || blacklisted || siteDisabled;

  if (shouldAbort) {
    return { abort: true };
  }

  const hostname = location.hostname.replace(/^www\./, '');

  // Strip keys the MAIN world shouldn't see
  delete settings.blacklist;
  delete settings.enabled;

  return { settings, hostname };
}

async function init() {
  try {
    // Skip about:blank frames — they share the parent window
    if (location.href === 'about:blank') {
      return;
    }

    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    let settingsPayload = null;
    const settingsPayloadPromise = loadSettingsPayload().then((payload) => {
      settingsPayload = payload;
      return payload;
    });

    // Always respond — inject.js runs unconditionally and needs the abort
    // signal to skip init. { once: true } limits event forgery exposure.
    docEl.addEventListener(
      'VSC_REQUEST_SETTINGS',
      () => {
        if (settingsPayload) {
          docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: settingsPayload }));
          return;
        }

        settingsPayloadPromise.then((payload) => {
          docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: payload }));
        });
      },
      { once: true }
    );

    settingsPayload = await settingsPayloadPromise;
    if (settingsPayload.abort) {
      return;
    }

    // --- Ongoing: storage change relay + lifecycle ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      // Lifecycle: only the popup's enabled toggle triggers teardown/reinit.
      // Options page never writes `enabled`, so saving options can't trigger
      // lifecycle — it only relays settings via VSC_STORAGE_CHANGED below.
      // siteRules/blacklist changes take effect on next page load.
      if (changes.enabled?.newValue === false) {
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } }));
        return;
      }
      if (changes.enabled?.oldValue === false && changes.enabled?.newValue !== false) {
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_REINIT' } }));
      }

      // Relay changes to MAIN world (filter out keys MAIN never received)
      const relayChanges = { ...changes };
      delete relayChanges.enabled;
      delete relayChanges.blacklist;
      if (Object.keys(relayChanges).length > 0) {
        docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: relayChanges }));
      }
    });

    // --- Ongoing: popup/background message relay ---
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      const requestId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const requestWithId = { ...request, requestId };

      const timeout = setTimeout(() => {
        docEl.removeEventListener('VSC_MESSAGE_RESULT', handleResult);
        sendResponse({ ok: false, mediaCount: null, error: 'timeout' });
      }, 250);

      const handleResult = (event) => {
        if (event.detail?.requestId !== requestId) {
          return;
        }
        clearTimeout(timeout);
        docEl.removeEventListener('VSC_MESSAGE_RESULT', handleResult);
        sendResponse(event.detail);
      };

      docEl.addEventListener('VSC_MESSAGE_RESULT', handleResult);
      docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: requestWithId }));
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
            const clamped = Math.min(Math.max(speed, SPEED_MIN), SPEED_MAX);
            chrome.storage.sync.set({ lastSpeed: clamped });
          }
        }
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          docEl.removeEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
        }
      }
    };
    docEl.addEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
  } catch (error) {
    console.error('[VSC] Bridge init failed:', error);
  }
}

init();
