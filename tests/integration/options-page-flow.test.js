import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getMockStorage, installChromeMock } from '../helpers/chrome-mock.js';

const html = readFileSync(resolve('src/ui/options/options.html'), 'utf8');
let listeners;

async function initializeOptions() {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  let initialize;
  listeners = [];
  for (const target of [document, document.body]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'DOMContentLoaded') {
        initialize = listener;
      } else {
        listeners.push([target, type, listener, options]);
        add(type, listener, options);
      }
    });
  }
  vi.resetModules();
  await import('../../src/ui/options/options.js');
  window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
  await initialize();
}

async function clickAndWait(id, text) {
  document.getElementById(id).click();
  await vi.waitFor(() => expect(document.getElementById('status').textContent).toContain(text));
}

async function importSettings(settings, statusText) {
  const input = document.getElementById('importFile');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ text: async () => JSON.stringify(settings) }],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('status').textContent).toContain(statusText)
  );
}

describe('Actual options page flows', () => {
  beforeEach(async () => {
    installChromeMock();
    await initializeOptions();
  });

  afterEach(() => {
    for (const [target, type, listener, options] of listeners) {
      target.removeEventListener(type, listener, options);
    }
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('records a shortcut, marks it dirty, and persists its modifier chord', async () => {
    const input = document.querySelector('#faster .customKey');
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        keyCode: 80,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(document.getElementById('save').classList.contains('has-changes')).toBe(true);
    await clickAndWait('save', 'Options saved');
    expect(
      getMockStorage().keyBindings.find((binding) => binding.action === 'faster')
    ).toMatchObject({
      code: 'KeyP',
      keyCode: 80,
      modifiers: { ctrl: true, alt: false, shift: false, meta: false },
    });
  });

  it('allows Tab and Shift+Tab to leave a shortcut recorder without changing the binding', () => {
    const input = document.querySelector('#faster .customKey');
    const code = input.code;
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        code: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(input.code).toBe(code);
    }
  });

  it('clears the shortcut label on focus and restores it on blur', () => {
    const input = document.querySelector('#faster .customKey');
    const label = input.value;
    input.focus();
    expect(input.value).toBe('');
    input.blur();
    expect(input.value).toBe(label);
  });

  it('saves preferences and site rules through the actual form', async () => {
    document.getElementById('rememberSpeed').checked = true;
    document.getElementById('add-site-rule').click();
    const row = document.querySelector('.site-rule:last-child');
    row.querySelector('.rulePattern').value = 'example.com';
    row.querySelector('.ruleSpeed').value = '1.5';
    await clickAndWait('save', 'Options saved');
    expect(getMockStorage().rememberSpeed).toBe(true);
    expect(getMockStorage().siteRules.at(-1)).toEqual({
      pattern: 'example.com',
      enabled: true,
      speed: 1.5,
    });
  });

  it('rejects malformed site speeds rather than silently accepting a numeric prefix', async () => {
    const previous = getMockStorage().siteRules;
    document.getElementById('add-site-rule').click();
    const row = document.querySelector('.site-rule:last-child');
    row.querySelector('.rulePattern').value = 'example.com';
    row.querySelector('.ruleSpeed').value = '1.5oops';
    await clickAndWait('save', 'Error:');
    expect(getMockStorage().siteRules).toEqual(previous);
  });

  it.each([
    ['faster', 'oops'],
    ['faster', ''],
    ['reset', '0'],
    ['advanceFrame', '-30'],
  ])(
    'rejects an invalid shortcut value (%s = %s) without changing stored bindings',
    async (action, value) => {
      const previous = JSON.stringify(getMockStorage().keyBindings);
      const input = document.querySelector(`#${action} .customValue`);
      input.value = value;
      await clickAndWait('save', 'Error:');
      expect(JSON.stringify(getMockStorage().keyBindings)).toBe(previous);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input);
    }
  );

  it('reports a failed reset without rejecting the UI event handler or marking it saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const previous = JSON.stringify(getMockStorage());
    vi.spyOn(window.VSC.StorageManager, 'set').mockRejectedValue(new Error('Storage unavailable'));
    document.getElementById('save').classList.add('has-changes');
    await clickAndWait('restore', 'Error restoring defaults: Storage unavailable');
    expect(document.getElementById('save').classList.contains('has-changes')).toBe(true);
    expect(document.getElementById('save').classList.contains('saved')).toBe(false);
    expect(JSON.stringify(getMockStorage())).toBe(previous);
  });

  it('imports valid settings and renders their shortcuts and preferences', async () => {
    await importSettings(
      {
        rememberSpeed: true,
        keyBindings: [
          {
            action: 'faster',
            code: 'KeyP',
            keyCode: 80,
            displayKey: 'P',
            value: 0.2,
            predefined: true,
          },
        ],
        siteRules: [{ pattern: 'example.com', enabled: true, speed: 1.5 }],
      },
      'Settings imported successfully'
    );
    expect(document.getElementById('rememberSpeed').checked).toBe(true);
    expect(document.querySelector('#faster .customKey').code).toBe('KeyP');
    expect(document.querySelector('.rulePattern').value).toBe('example.com');
  });

  it('round-trips the actual exported JSON through the import handler', async () => {
    let exported;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => {
      exported = blob;
      return 'blob:settings-export';
    };
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await clickAndWait('export', 'Settings exported');
      const text = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(exported);
      });
      const settings = JSON.parse(text);
      expect(settings.keyBindings.length).toBeGreaterThan(0);
      await importSettings(settings, 'Settings imported successfully');
      expect(getMockStorage().keyBindings).toEqual(settings.keyBindings);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:settings-export');
    } finally {
      if (create) {
        URL.createObjectURL = create;
      } else {
        delete URL.createObjectURL;
      }
      if (revoke) {
        URL.revokeObjectURL = revoke;
      } else {
        delete URL.revokeObjectURL;
      }
    }
  });

  it('successfully resets preferences, re-renders shortcuts, and removes obsolete keys', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    getMockStorage().rememberSpeed = true;
    getMockStorage().obsoleteSetting = 'old';
    await clickAndWait('restore', 'Default options restored');
    expect(getMockStorage().rememberSpeed).toBe(false);
    expect(getMockStorage().obsoleteSetting).toBeUndefined();
    expect(document.getElementById('rememberSpeed').checked).toBe(false);
    expect(document.querySelectorAll('#faster').length).toBe(1);
    expect(document.getElementById('save').classList.contains('has-changes')).toBe(false);
  });

  it.each([
    ['reset', 1],
    ['reset', undefined],
    ['import', 1],
    ['import', undefined],
    ['import', null],
  ])(
    'cancels a pending media speed save on %s with stored speed %s',
    async (action, storedSpeed) => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let onChanged;
      vi.spyOn(window.VSC.StorageManager, 'onChanged').mockImplementation((listener) => {
        onChanged = listener;
      });
      const mediaConfig = new window.VSC.VideoSpeedConfig();
      await mediaConfig.load();
      if (storedSpeed === undefined) {
        delete getMockStorage().lastSpeed;
      } else {
        getMockStorage().lastSpeed = storedSpeed;
      }
      await mediaConfig.save({ lastSpeed: 2 });

      // Chrome emits changes only for changed values. The general test mock
      // emits equal-value writes too, which would hide this cross-context race.
      vi.spyOn(window.VSC.StorageManager, 'set').mockImplementation(async (settings) => {
        const changes = {};
        for (const [key, newValue] of Object.entries(settings)) {
          const oldValue = getMockStorage()[key];
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            changes[key] = { oldValue, newValue };
          }
        }
        Object.assign(getMockStorage(), settings);
        onChanged(changes);
      });
      vi.spyOn(window.VSC.StorageManager, 'remove').mockImplementation(async (keys) => {
        const changes = {};
        for (const key of [keys].flat()) {
          if (Object.hasOwn(getMockStorage(), key)) {
            changes[key] = { oldValue: getMockStorage()[key], newValue: undefined };
            delete getMockStorage()[key];
          }
        }
        onChanged(changes);
      });

      if (action === 'reset') {
        await clickAndWait('restore', 'Default options restored');
      } else {
        await importSettings(
          {
            keyBindings: [],
            ...(storedSpeed !== undefined ? { lastSpeed: storedSpeed } : {}),
          },
          'Settings imported successfully'
        );
      }
      expect(mediaConfig.pendingSave).toBeNull();
      expect(mediaConfig.saveTimer).toBeNull();
      expect(getMockStorage().lastSpeed).toBe(action === 'reset' ? 1 : storedSpeed);
    }
  );

  it('preserves existing settings when the storage read before an import fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const previous = JSON.stringify(getMockStorage());
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation((_keys, callback) => {
      chrome.runtime.lastError = { message: 'Storage unavailable' };
      callback();
      chrome.runtime.lastError = null;
    });
    await importSettings(
      { keyBindings: [] },
      'Import failed: Storage read failed: Storage unavailable'
    );
    expect(JSON.stringify(getMockStorage())).toBe(previous);
  });

  it.each([
    { keyBindings: [null] },
    { keyBindings: [{ action: 'faster', code: 'KeyD', value: 'oops' }] },
    { keyBindings: [], siteRules: 'example.com' },
    { keyBindings: [], siteRules: [null] },
    { keyBindings: [], siteRules: [{ pattern: '/example/z', enabled: true, speed: 1 }] },
    { keyBindings: [], controllerOpacity: 5 },
  ])('rejects a malformed import before writing any settings (%j)', async (settings) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const previous = JSON.stringify(getMockStorage());
    await importSettings(settings, 'Import failed:');
    expect(JSON.stringify(getMockStorage())).toBe(previous);
  });
});
