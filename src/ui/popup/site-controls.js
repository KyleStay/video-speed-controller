import { isBlacklisted, matchSiteRule } from '../../utils/site-pattern.js';

const KEYS = ['enabled', 'siteRules', 'blacklist'];
const escapePattern = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

// Domain-literal rules also match subdomains. This override deliberately affects
// only the displayed hostname, while retaining its effective first-match policy.
function hostPattern(hostname, port = null) {
  const host = `(?:[^/?#]*@)?${escapePattern(hostname)}`;
  if (port) {
    const defaultScheme = port === '443' ? 'https' : port === '80' ? 'http' : null;
    const origin = `https?:\\/\\/${host}:${port}`;
    return `/^(?:${origin}${defaultScheme ? `|${defaultScheme}:\\/\\/${host}` : ''})(?:[/?#]|$)/i`;
  }
  return `/^https?:\\/\\/${host}(?::[0-9]+)?(?:[/?#]|$)/i`;
}

function rulesFor(settings) {
  if (Array.isArray(settings.siteRules)) {
    return settings.siteRules;
  }
  if (settings.siteRules !== null && settings.siteRules !== undefined) {
    throw new Error('Invalid site rules');
  }
  // Creating the first structured rule must retain the legacy blacklist on all
  // other hosts, because structured rules supersede it in the content bridge.
  return typeof settings.blacklist === 'string'
    ? settings.blacklist
        .split('\n')
        .map((pattern) => pattern.trim())
        .filter(Boolean)
        .map((pattern) => ({ pattern, enabled: false, speed: null }))
    : [];
}

function siteState(settings, tab) {
  const url = new URL(tab?.url);
  if (!Number.isInteger(tab?.id) || tab.id < 0 || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('No website');
  }
  const rules = rulesFor(settings);
  const matched = matchSiteRule(
    rules.filter((rule) => rule && typeof rule.pattern === 'string'),
    url.href
  );
  const pattern = matched?.pattern.trim();
  const domainRule =
    pattern && !pattern.startsWith('/') && pattern.includes('.') && !pattern.includes('/');
  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80');
  const ownOverride =
    pattern === hostPattern(url.hostname) || pattern === hostPattern(url.hostname, effectivePort);
  const overridePattern = ownOverride
    ? pattern
    : hostPattern(url.hostname, domainRule ? pattern.match(/:([0-9]+)$/)?.[1] : null);
  return {
    tabId: tab.id,
    hostname: url.hostname,
    rules,
    matched,
    overridePattern,
    quickSupported: !matched || Boolean(domainRule) || ownOverride,
    checked: matched?.hideSiteControls === true,
    disabled:
      settings.enabled === false ||
      matched?.enabled === false ||
      ((settings.siteRules === null || settings.siteRules === undefined) &&
        isBlacklisted(settings.blacklist, url.href)),
  };
}

function chromeCall(owner, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      owner[method](...args, (result) => {
        try {
          if (chrome.runtime.lastError) {
            reject(new Error('Extension request failed'));
          } else {
            resolve(result);
          }
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function initializeSiteControls(doc = document) {
  const input = doc.querySelector('#hide-site-controls');
  const status = doc.querySelector('#site-controls-status');
  const settingsButton = doc.querySelector('#site-controls-settings');
  if (!input || !status) {
    return () => {};
  }
  let closed = false;
  let busy = false;
  let generation = 0;
  let displayed = null;
  let pendingRefresh = false;
  const read = async () => {
    const [settings, tabs] = await Promise.all([
      chromeCall(chrome.storage.sync, 'get', KEYS),
      chromeCall(chrome.tabs, 'query', { active: true, currentWindow: true }),
    ]);
    if (closed) {
      throw new Error('Popup closed');
    }
    const tab = tabs?.length === 1 ? tabs[0] : null;
    if (!Number.isInteger(tab?.id) || tab.id < 0) {
      throw new Error('No active tab');
    }
    // The extension intentionally has no tabs/activeTab permission. Obtain the
    // current URL from our top-frame ISOLATED bridge, never a child-frame reply.
    const reply = await chromeCall(
      chrome.tabs,
      'sendMessage',
      tab.id,
      { type: 'VSC_GET_SITE_INFO' },
      { frameId: 0 }
    );
    if (reply?.ok !== true || typeof reply.href !== 'string') {
      throw new Error('Site information unavailable');
    }
    return siteState(settings || {}, { id: tab.id, url: reply.href });
  };
  const render = (site, message) => {
    displayed = site;
    input.checked = site.checked;
    input.disabled = busy || site.disabled || !site.quickSupported;
    if (settingsButton) {
      settingsButton.hidden = site.quickSupported;
    }
    status.textContent =
      message ||
      (site.disabled
        ? 'Extension disabled on this site.'
        : !site.quickSupported
          ? 'Edit this rule in Settings.'
          : site.hostname);
  };
  const refresh = async () => {
    if (closed || busy) {
      return;
    }
    const current = ++generation;
    input.disabled = true;
    try {
      const site = await read();
      if (!closed && current === generation) {
        render(site);
      }
    } catch {
      if (!closed && current === generation) {
        displayed = null;
        input.checked = false;
        status.textContent = 'Site setting unavailable. Open a website and try again.';
      }
    }
  };
  const save = async () => {
    if (closed || busy || !displayed || displayed.disabled || !displayed.quickSupported) {
      return;
    }
    const wanted = input.checked === true;
    const previous = displayed;
    const current = ++generation;
    busy = true;
    input.disabled = true;
    try {
      // Re-read immediately before saving: options may have changed another
      // field/rule since this popup opened. Never write the initial snapshot.
      const fresh = await read();
      if (closed || current !== generation) {
        return;
      }
      if (fresh.tabId !== previous.tabId || fresh.hostname !== previous.hostname) {
        render(fresh, 'The active site changed. Choose the setting again.');
        return;
      }
      if (fresh.disabled || !fresh.quickSupported) {
        render(fresh);
        return;
      }
      const pattern = fresh.overridePattern;
      const override = {
        enabled: true,
        speed: null,
        ...fresh.matched,
        pattern,
        hideSiteControls: wanted,
      };
      const rules = [...fresh.rules];
      if (fresh.matched?.pattern === pattern) {
        rules[rules.indexOf(fresh.matched)] = override;
      } else {
        const index = fresh.matched ? rules.indexOf(fresh.matched) : rules.length;
        rules.splice(index, 0, override);
      }
      await chromeCall(chrome.storage.sync, 'set', { siteRules: rules });
      if (!closed && current === generation) {
        render(
          { ...fresh, rules, matched: override, checked: wanted },
          `Saved for ${fresh.hostname}.`
        );
      }
    } catch {
      if (!closed && current === generation) {
        render(previous, 'Unable to save this site setting. Try again.');
      }
    } finally {
      busy = false;
      if (!closed && current === generation) {
        input.disabled = !displayed || displayed.disabled || !displayed.quickSupported;
      }
      if (pendingRefresh) {
        pendingRefresh = false;
        refresh();
      }
    }
  };
  const onStorage = (changes, area) => {
    if (
      area === 'sync' &&
      changes &&
      typeof changes === 'object' &&
      KEYS.some((key) => Object.hasOwn(changes, key))
    ) {
      if (busy) {
        pendingRefresh = true;
      } else {
        refresh();
      }
    }
  };
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    generation++;
    input.removeEventListener('change', save);
    settingsButton?.removeEventListener('click', openSettings);
    doc.defaultView.removeEventListener('pagehide', cleanup);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {
      // The popup's extension context may already have been invalidated.
    }
  };
  const openSettings = () => {
    try {
      chromeCall(chrome.runtime, 'openOptionsPage').catch(() => {
        if (!closed) {
          status.textContent = 'Unable to open Settings. Try again.';
        }
      });
    } catch {
      if (!closed) {
        status.textContent = 'Unable to open Settings. Try again.';
      }
    }
  };
  input.addEventListener('change', save);
  settingsButton?.addEventListener('click', openSettings);
  doc.defaultView.addEventListener('pagehide', cleanup, { once: true });
  try {
    chrome.storage.onChanged.addListener(onStorage);
  } catch {
    // Initial reads/save still work if lifecycle notifications are unavailable.
  }
  refresh();
  return cleanup;
}
