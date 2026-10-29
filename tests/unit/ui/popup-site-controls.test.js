import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeSiteControls } from '../../../src/ui/popup/site-controls.js';
import { matchSiteRule } from '../../../src/utils/site-pattern.js';
import { cleanupChromeMock, installChromeMock } from '../../helpers/chrome-mock.js';

const html = readFileSync(resolve('src/ui/popup/popup.html'), 'utf8');

describe('Popup per-site video buttons', () => {
  let storage, tab, listeners, cleanup;
  const input = () => document.querySelector('#hide-site-controls');
  const status = () => document.querySelector('#site-controls-status');
  const start = async () => {
    cleanup = initializeSiteControls();
    await vi.waitFor(() => expect(status().textContent).not.toBe('Loading site…'));
  };
  const change = (checked) => {
    input().checked = checked;
    input().dispatchEvent(new Event('change'));
  };
  const saved = async () => {
    await vi.waitFor(() => expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(input().disabled).toBe(false));
  };
  const notify = (changes, area = 'sync') => {
    for (const listener of listeners) {
      listener(changes, area);
    }
  };

  beforeEach(() => {
    installChromeMock();
    storage = { enabled: true, siteRules: [] };
    tab = { id: 7, url: 'https://example.com/watch' };
    listeners = new Set();
    document.body.innerHTML = html;
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation((keys, callback) => {
      callback(
        Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]]))
      );
    });
    vi.spyOn(chrome.storage.sync, 'set').mockImplementation((value, callback) => {
      Object.assign(storage, value);
      callback();
    });
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_query, callback) => callback([tab]));
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation(
      (_tabId, _message, options, callback) => {
        callback(options?.frameId === 0 ? { ok: true, href: tab.url } : { ok: false });
      }
    );
    vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation((fn) => listeners.add(fn));
    vi.spyOn(chrome.storage.onChanged, 'removeListener').mockImplementation((fn) =>
      listeners.delete(fn)
    );
    chrome.runtime.lastError = null;
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
    cleanupChromeMock();
    document.body.innerHTML = '';
  });

  it('labels the checkbox and defaults off without creating a rule', async () => {
    await start();
    expect(input().closest('label').textContent).toContain('Hide site video buttons');
    expect(input().getAttribute('aria-describedby')).toBe(status().id);
    expect(input().checked).toBe(false);
    expect(input().disabled).toBe(false);
    expect(status().textContent).toBe('example.com');
    expect(chrome.storage.sync.get).toHaveBeenCalledWith(
      ['enabled', 'siteRules', 'blacklist'],
      expect.any(Function)
    );
    // The shared module loader may finish its unrelated key-binding migration.
    expect(chrome.storage.sync.set.mock.calls.some(([value]) => 'siteRules' in value)).toBe(false);
  });

  it.each([true, false, 'true', 1, undefined])(
    'accepts only literal true, received %s',
    async (value) => {
      storage.siteRules = [{ pattern: 'example.com', enabled: true, hideSiteControls: value }];
      await start();
      expect(input().checked).toBe(value === true);
    }
  );

  it('obtains the URL from only the top-frame bridge when tabs.query has no URL permission', async () => {
    delete tab.url;
    chrome.tabs.sendMessage.mockImplementation((_tabId, message, options, callback) => {
      // An unscoped command could receive this unrelated child's reply first.
      callback(
        options?.frameId === 0 && message.type === 'VSC_GET_SITE_INFO'
          ? { ok: true, href: 'https://example.com/watch' }
          : { ok: true, href: 'https://child.invalid/' }
      );
    });
    await start();
    expect(input().disabled).toBe(false);
    expect(status().textContent).toBe('example.com');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'VSC_GET_SITE_INFO' },
      { frameId: 0 },
      expect.any(Function)
    );
    change(true);
    await saved();
    expect(matchSiteRule(storage.siteRules, 'https://example.com/').hideSiteControls).toBe(true);
    expect(matchSiteRule(storage.siteRules, 'https://child.invalid/')).toBeNull();
    expect(
      chrome.tabs.sendMessage.mock.calls.every(([, , options]) => options?.frameId === 0)
    ).toBe(true);
  });

  it.each([
    undefined,
    { ok: false, href: 'https://example.com/' },
    { ok: true },
    { ok: true, href: 7 },
  ])('disables the setting for an invalid site-info bridge reply: %j', async (reply) => {
    chrome.tabs.sendMessage.mockImplementation((_tabId, _message, _options, callback) =>
      callback(reply)
    );
    await start();
    expect(input().disabled).toBe(true);
    expect(status().textContent).toContain('unavailable');
    expect(chrome.storage.sync.set.mock.calls.some(([value]) => 'siteRules' in value)).toBe(false);
  });

  it('handles a top-frame send error without falling back to the permission-dependent tab URL', async () => {
    chrome.tabs.sendMessage.mockImplementation((_tabId, _message, _options, callback) => {
      chrome.runtime.lastError = { message: 'No receiving end' };
      callback();
      chrome.runtime.lastError = null;
    });
    await start();
    expect(input().disabled).toBe(true);
    expect(status().textContent).toContain('unavailable');
    expect(chrome.storage.sync.set.mock.calls.some(([value]) => 'siteRules' in value)).toBe(false);
  });

  it('uses the first matched rule for display and preserves that effective policy when saving', async () => {
    const broad = { pattern: 'example.com', enabled: true, speed: 2.5, future: { retain: true } };
    const later = { pattern: 'example.com', enabled: true, speed: 4, hideSiteControls: true };
    storage.siteRules = [broad, later];
    await start();
    expect(input().checked).toBe(false);
    change(true);
    await saved();
    expect(storage.siteRules).toHaveLength(3);
    expect(storage.siteRules[0]).toMatchObject({
      enabled: true,
      speed: 2.5,
      future: broad.future,
      hideSiteControls: true,
    });
    expect(storage.siteRules.slice(1)).toEqual([broad, later]);
    expect(matchSiteRule(storage.siteRules, tab.url)).toBe(storage.siteRules[0]);
    expect(matchSiteRule(storage.siteRules, 'https://sub.example.com/watch')).toBe(broad);
    expect(matchSiteRule(storage.siteRules, 'https://otherexample.com/')).toBeNull();
  });

  it('does not mutate a literal hostname rule that also controls its subdomains', async () => {
    const broad = { pattern: 'example.com', enabled: true, speed: 3, hideSiteControls: true };
    storage.siteRules = [broad];
    await start();
    change(false);
    await saved();
    expect(broad.hideSiteControls).toBe(true);
    expect(matchSiteRule(storage.siteRules, 'https://example.com/').hideSiteControls).toBe(false);
    expect(matchSiteRule(storage.siteRules, 'https://sub.example.com/').hideSiteControls).toBe(
      true
    );
  });

  it('preserves earlier path-specific rules when inserting a host override', async () => {
    const pathRule = { pattern: '/example\\.com\\/special/', enabled: false, speed: 4 };
    const broad = { pattern: 'example.com', enabled: true, speed: 2 };
    storage.siteRules = [pathRule, broad];
    await start();
    change(true);
    await saved();
    expect(storage.siteRules[0]).toBe(pathRule);
    expect(matchSiteRule(storage.siteRules, 'https://example.com/special')).toBe(pathRule);
    expect(matchSiteRule(storage.siteRules, tab.url)).toMatchObject({
      speed: 2,
      hideSiteControls: true,
    });
  });

  it('appends an unmatched-site override without shadowing existing path rules', async () => {
    const pathRule = { pattern: '/example\\.com\\/special/', enabled: false, speed: 4 };
    storage.siteRules = [pathRule];
    await start();
    change(true);
    await saved();
    expect(storage.siteRules[0]).toBe(pathRule);
    expect(matchSiteRule(storage.siteRules, 'https://example.com/special')).toBe(pathRule);
    expect(matchSiteRule(storage.siteRules, tab.url)).toMatchObject({
      speed: null,
      hideSiteControls: true,
    });
  });

  it.each(['/example\\.com\\/watch/', 'watch'])(
    'refuses quick editing of a matched path/substring rule: %s',
    async (pattern) => {
      const rule = { pattern, enabled: true, speed: 4, hideSiteControls: true };
      storage.siteRules = [rule];
      await start();
      expect(input().disabled).toBe(true);
      expect(status().textContent).toBe('Edit this rule in Settings.');
      expect(document.querySelector('#site-controls-settings').hidden).toBe(false);
      change(false);
      await Promise.resolve();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
      expect(storage.siteRules).toEqual([rule]);
    }
  );

  it('guards a fresh change to an unsupported path rule before saving', async () => {
    await start();
    const pathRule = { pattern: '/example\\.com\\/watch/', enabled: true, speed: 4 };
    storage.siteRules = [pathRule];
    change(true);
    await vi.waitFor(() => expect(status().textContent).toBe('Edit this rule in Settings.'));
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(storage.siteRules).toEqual([pathRule]);
  });

  it.each([
    [
      'https://example.com:8443/watch',
      'example.com:8443',
      'http://example.com:8443/',
      'https://example.com/',
    ],
    [
      'https://example.com/watch',
      'example.com:443',
      'http://example.com:443/',
      'http://example.com/',
    ],
    [
      'http://example.com/watch',
      'example.com:80',
      'https://example.com:80/',
      'https://example.com/',
    ],
  ])(
    'keeps port-qualified policy scoped to its original port: %s',
    async (url, pattern, otherScheme, otherPort) => {
      const broad = { pattern, enabled: true, speed: 3 };
      storage.siteRules = [broad];
      tab.url = url;
      await start();
      change(true);
      await saved();
      expect(matchSiteRule(storage.siteRules, url)).toMatchObject({
        hideSiteControls: true,
        speed: 3,
      });
      expect(matchSiteRule(storage.siteRules, otherScheme)).toMatchObject({
        hideSiteControls: true,
        speed: 3,
      });
      expect(matchSiteRule(storage.siteRules, otherPort)).toBeNull();
      expect(matchSiteRule(storage.siteRules, 'https://sub.example.com:8443/')).not.toBe(
        storage.siteRules[0]
      );
      chrome.storage.sync.set.mockClear();
      change(false);
      await saved();
      expect(storage.siteRules).toHaveLength(2);
    }
  );

  it('opens Settings for unsupported rules and reports API failures', async () => {
    storage.siteRules = [{ pattern: 'watch', enabled: true }];
    chrome.runtime.openOptionsPage = vi.fn((callback) => callback());
    await start();
    const button = document.querySelector('#site-controls-settings');
    button.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    chrome.runtime.openOptionsPage.mockImplementation(() => {
      throw new Error('gone');
    });
    button.click();
    await vi.waitFor(() => expect(status().textContent).toContain('Unable to open Settings'));
    delete chrome.runtime.openOptionsPage;
  });

  it('creates a valid enabled rule and reuses the effective exact-host override on later toggles', async () => {
    await start();
    change(true);
    await saved();
    expect(storage.siteRules[0]).toMatchObject({
      enabled: true,
      speed: null,
      hideSiteControls: true,
    });
    const pattern = storage.siteRules[0].pattern;
    chrome.storage.sync.set.mockClear();
    change(false);
    await saved();
    expect(storage.siteRules).toEqual([
      { pattern, enabled: true, speed: null, hideSiteControls: false },
    ]);
  });

  it('escapes hostname metacharacters and permits either HTTP scheme and explicit ports', async () => {
    tab.url = 'https://a-b.example.com:8443/watch';
    await start();
    change(true);
    await saved();
    for (const url of ['http://a-b.example.com/', 'https://a-b.example.com:9000/?v=1']) {
      expect(matchSiteRule(storage.siteRules, url)?.hideSiteControls).toBe(true);
    }
    for (const url of [
      'https://a-bXexample.com/',
      'https://sub.a-b.example.com/',
      'https://a-b.example.com.attacker.test/',
    ]) {
      expect(matchSiteRule(storage.siteRules, url)).toBeNull();
    }
  });

  it('reads fresh rules before saving and preserves edits made since the popup opened', async () => {
    storage.siteRules = [{ pattern: 'example.com', enabled: true, speed: 1.5 }];
    await start();
    const updated = { pattern: 'example.com', enabled: true, speed: 4, added: 'keep' };
    const other = { pattern: 'other.test', enabled: false, speed: null };
    storage.siteRules = [updated, other];
    change(true);
    await saved();
    expect(storage.siteRules[0]).toMatchObject({ speed: 4, added: 'keep' });
    expect(storage.siteRules.slice(1)).toEqual([updated, other]);
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(2);
  });

  it('retains every legacy blacklist entry when creating structured site rules', async () => {
    storage = { blacklist: 'blocked.test\n/another\\.test/i' };
    await start();
    change(true);
    await saved();
    expect(matchSiteRule(storage.siteRules, 'https://blocked.test/').enabled).toBe(false);
    expect(matchSiteRule(storage.siteRules, 'https://another.test/').enabled).toBe(false);
    expect(storage.blacklist).toBe('blocked.test\n/another\\.test/i');
  });

  it.each(['global', 'site', 'legacy'])(
    'disables the checkbox for %s-disabled pages',
    async (kind) => {
      if (kind === 'global') {
        storage.enabled = false;
      }
      if (kind === 'site') {
        storage.siteRules = [{ pattern: 'example.com', enabled: false }];
      }
      if (kind === 'legacy') {
        storage = { blacklist: 'example.com' };
      }
      await start();
      expect(input().disabled).toBe(true);
      change(true);
      await Promise.resolve();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    }
  );

  it('refuses a save when a fresh read says the site was disabled', async () => {
    await start();
    storage.enabled = false;
    change(true);
    await vi.waitFor(() => expect(status().textContent).toContain('disabled'));
    expect(input().disabled).toBe(true);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('does not apply the previous site choice after active-tab navigation', async () => {
    await start();
    tab = { id: 8, url: 'https://other.test/' };
    change(true);
    await vi.waitFor(() => expect(status().textContent).toContain('active site changed'));
    expect(input().checked).toBe(false);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it.each(['chrome://extensions/', undefined])(
    'keeps unavailable active URLs disabled: %s',
    async (url) => {
      tab.url = url;
      await start();
      expect(input().disabled).toBe(true);
      expect(status().textContent).toContain('unavailable');
    }
  );

  it('handles storage rejection and API throws without optimistic saved state', async () => {
    await start();
    chrome.storage.sync.set.mockImplementation((_value, callback) => {
      chrome.runtime.lastError = { message: 'quota failure' };
      callback();
      chrome.runtime.lastError = null;
    });
    change(true);
    await vi.waitFor(() => expect(status().textContent).toContain('Unable to save'));
    expect(input().checked).toBe(false);
    expect(input().disabled).toBe(false);
    chrome.tabs.query.mockImplementation(() => {
      throw new Error('closed context');
    });
    notify({ enabled: {} });
    await vi.waitFor(() => expect(status().textContent).toContain('unavailable'));
    expect(input().disabled).toBe(true);
  });

  it('refreshes external power/rule changes and removes all owned subscriptions on close', async () => {
    await start();
    storage.enabled = false;
    notify({ enabled: { newValue: false } });
    await vi.waitFor(() => expect(input().disabled).toBe(true));
    storage.enabled = true;
    storage.siteRules = [{ pattern: 'example.com', enabled: true, hideSiteControls: true }];
    notify({ siteRules: {} });
    await vi.waitFor(() => expect(input().checked && !input().disabled).toBe(true));
    expect(listeners.size).toBe(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(listeners.size).toBe(0);
    change(false);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('cancels an outstanding fresh read before writing when the popup closes', async () => {
    await start();
    let respond;
    chrome.storage.sync.get.mockImplementation((_keys, callback) => {
      respond = callback;
    });
    change(true);
    window.dispatchEvent(new Event('pagehide'));
    respond(storage);
    await Promise.resolve();
    await Promise.resolve();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores a late top-frame reply after popup closure', async () => {
    await start();
    let respond;
    chrome.tabs.sendMessage.mockImplementation((_tabId, _message, _options, callback) => {
      respond = callback;
    });
    change(true);
    await vi.waitFor(() => expect(respond).toBeTypeOf('function'));
    window.dispatchEvent(new Event('pagehide'));
    respond({ ok: true, href: 'https://example.com/watch' });
    await Promise.resolve();
    await Promise.resolve();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('reconciles an external disabled change received while the save is pending', async () => {
    await start();
    let finish;
    chrome.storage.sync.set.mockImplementation((value, callback) => {
      Object.assign(storage, value);
      finish = callback;
    });
    change(true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    storage.enabled = false;
    notify({ enabled: { newValue: false } });
    finish();
    await vi.waitFor(() => expect(status().textContent).toContain('disabled'));
    expect(input().disabled).toBe(true);
    expect(input().checked).toBe(true);
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  });
});
