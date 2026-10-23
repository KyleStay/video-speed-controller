import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getMockStorage, installChromeMock } from '../helpers/chrome-mock.js';

const html = readFileSync(resolve('src/ui/options/options.html'), 'utf8');
let listeners;

async function initializeOptions() {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  let initialize;
  listeners = [];
  for (const target of [document, document.body, window]) {
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

async function changeAndWait(input, text = 'Changes saved automatically') {
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(document.getElementById('status').textContent).toContain(text));
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
    clearTimeout(window.validationTimeout);
    for (const [target, type, listener, options] of listeners) {
      target.removeEventListener(type, listener, options);
    }
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('automatically saves a recorded shortcut and its modifier chord', async () => {
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
    await vi.waitFor(() =>
      expect(document.getElementById('status').textContent).toContain('Changes saved automatically')
    );
    expect(
      getMockStorage().keyBindings.find((binding) => binding.action === 'faster')
    ).toMatchObject({
      code: 'KeyP',
      keyCode: 80,
      modifiers: { ctrl: true, alt: false, shift: false, meta: false },
    });
  });

  it('reverts the latest saved edit without undoing earlier edits or unrelated storage', async () => {
    const remember = document.getElementById('rememberSpeed');
    remember.checked = true;
    await changeAndWait(remember);
    const hidden = document.getElementById('startHidden');
    hidden.checked = true;
    await changeAndWait(hidden);
    getMockStorage().lastSpeed = 2;
    await clickAndWait('revert', 'Changes reverted');
    expect(getMockStorage().rememberSpeed).toBe(true);
    expect(getMockStorage().startHidden).toBe(false);
    expect(getMockStorage().lastSpeed).toBe(2);
    expect(hidden.checked).toBe(false);
    expect(document.getElementById('revert').disabled).toBe(true);
  });

  it('groups typing into one save and reverts that edit', async () => {
    const input = document.querySelector('#faster .customValue');
    const previous = getMockStorage().keyBindings.find(
      (binding) => binding.action === 'faster'
    ).value;
    const set = vi.spyOn(window.VSC.StorageManager, 'set');
    for (const value of ['0.2', '0.25', '0.3']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(getMockStorage().keyBindings.find((binding) => binding.action === 'faster').value).toBe(
      0.3
    );
    await clickAndWait('revert', 'Changes reverted');
    expect(getMockStorage().keyBindings.find((binding) => binding.action === 'faster').value).toBe(
      previous
    );
  });

  it('discards pending typing when reverted before the save delay', async () => {
    const input = document.querySelector('#faster .customValue');
    const previous = input.value;
    input.value = '0.7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await clickAndWait('revert', 'Changes reverted');
    expect(document.querySelector('#faster .customValue').value).toBe(previous);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(document.querySelector('#faster .customValue').value).toBe(previous);
  });

  it('saves dynamic shortcut and site rule removal automatically', async () => {
    document.getElementById('add').click();
    await changeAndWait(document.querySelector('.customs:last-child .customValue'));
    expect(getMockStorage().keyBindings.at(-1).predefined).toBe(false);
    const count = getMockStorage().keyBindings.length;
    document.querySelector('.customs:last-child .removeParent').click();
    await vi.waitFor(() => expect(getMockStorage().keyBindings).toHaveLength(count - 1));
    const ruleCount = document.querySelectorAll('.site-rule').length;
    document.querySelector('.site-rule .removeParent').click();
    await vi.waitFor(() => expect(getMockStorage().siteRules).toHaveLength(ruleCount - 1));
  });

  it('keeps saved values when autosave fails and lets the user discard the edit', async () => {
    const input = document.getElementById('rememberSpeed');
    const previous = getMockStorage().rememberSpeed;
    const set = vi
      .spyOn(window.VSC.StorageManager, 'set')
      .mockRejectedValue(new Error('Storage unavailable'));
    input.checked = !previous;
    await changeAndWait(input, 'Changes could not be saved');
    expect(getMockStorage().rememberSpeed).toBe(previous);
    set.mockRestore();
    await clickAndWait('revert', 'Changes reverted');
    expect(input.checked).toBe(previous);
  });

  it('keeps a failed draft recoverable when Revert cannot read storage, then retries normally', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const input = document.getElementById('rememberSpeed');
    const previous = getMockStorage().rememberSpeed;
    const set = vi
      .spyOn(window.VSC.StorageManager, 'set')
      .mockRejectedValue(new Error('Storage write unavailable'));
    input.checked = !previous;
    await changeAndWait(input, 'Changes could not be saved');
    const get = vi
      .spyOn(window.VSC.StorageManager, 'get')
      .mockRejectedValue(new Error('Storage read unavailable'));

    await clickAndWait('revert', 'Could not revert changes');
    expect(document.getElementById('status').classList.contains('error')).toBe(true);
    expect(document.getElementById('revert').disabled).toBe(false);
    expect(input.checked).toBe(!previous);
    expect(getMockStorage().rememberSpeed).toBe(previous);
    await clickAndWait('revert', 'Could not revert changes');
    expect(document.getElementById('revert').disabled).toBe(false);

    // Discarding the failed draft only needs a read once storage recovers.
    get.mockRestore();
    await clickAndWait('revert', 'Changes reverted');
    expect(input.checked).toBe(previous);
    expect(document.getElementById('revert').disabled).toBe(true);
    expect(getMockStorage().rememberSpeed).toBe(previous);

    set.mockRestore();
    input.checked = !previous;
    await changeAndWait(input);
    expect(getMockStorage().rememberSpeed).toBe(!previous);
    await clickAndWait('revert', 'Changes reverted');
    expect(input.checked).toBe(previous);
    expect(getMockStorage().rememberSpeed).toBe(previous);
  });

  it('discards invalid edits without undoing the previous saved change', async () => {
    document.getElementById('rememberSpeed').checked = true;
    await changeAndWait(document.getElementById('rememberSpeed'));
    const input = document.getElementById('controllerButtonSize');
    input.value = '64';
    await changeAndWait(input, 'Error:');
    await clickAndWait('revert', 'Changes reverted');
    expect(getMockStorage().rememberSpeed).toBe(true);
    expect(input.value).toBe('14');
  });

  it('serializes rapid changes and allows reverting after an in-flight write', async () => {
    const original = window.VSC.StorageManager.set;
    let release;
    vi.spyOn(window.VSC.StorageManager, 'set').mockImplementationOnce(async (settings) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      await original(settings);
    });
    const remember = document.getElementById('rememberSpeed');
    remember.checked = true;
    remember.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    document.getElementById('revert').click();
    release();
    await vi.waitFor(() =>
      expect(document.getElementById('status').textContent).toBe('Changes reverted')
    );
    expect(getMockStorage().rememberSpeed).toBe(false);
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
    await changeAndWait(row.querySelector('.ruleSpeed'));
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
    await changeAndWait(row.querySelector('.ruleSpeed'), 'Error:');
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
      await changeAndWait(input, 'Error:');
      expect(JSON.stringify(getMockStorage().keyBindings)).toBe(previous);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).not.toBe(input);
    }
  );

  it.each(['restore', 'import'])(
    'reports a failed initial %s write and preserves storage',
    async (action) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const previous = structuredClone(getMockStorage());
      vi.spyOn(window.VSC.StorageManager, 'set').mockRejectedValue(
        new Error('Storage unavailable')
      );
      if (action === 'restore') {
        await clickAndWait('restore', 'Error restoring defaults: Storage unavailable');
      } else {
        await importSettings(
          { keyBindings: previous.keyBindings },
          'Import failed: Storage unavailable'
        );
      }
      expect(document.getElementById('revert').disabled).toBe(true);
      expect(document.getElementById('panel-settings').inert).toBe(false);
      expect(getMockStorage()).toEqual(previous);
    }
  );

  it.each([
    ['restore', 'speed-remove'],
    ['restore', 'speed-set'],
    ['restore', 'stale-remove'],
    ['import', 'speed-remove'],
    ['import', 'speed-set'],
    ['import', 'stale-remove'],
    ['import', 'speed-prime'],
  ])(
    'recovers a partially committed %s after %s fails, including a failed undo retry',
    async (action, phase) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const remember = document.getElementById('rememberSpeed');
      remember.checked = true;
      await changeAndWait(remember);
      getMockStorage().obsoleteSetting = 'preserve me';
      getMockStorage().lastSpeed = 2;
      const previous = structuredClone(getMockStorage());
      const realSet = window.VSC.StorageManager.set.bind(window.VSC.StorageManager);
      const realRemove = window.VSC.StorageManager.remove.bind(window.VSC.StorageManager);
      let failedPhase = phase;
      const set = vi
        .spyOn(window.VSC.StorageManager, 'set')
        .mockImplementation(async (settings) => {
          if (
            ['speed-set', 'speed-prime'].includes(failedPhase) &&
            Object.keys(settings).length === 1 &&
            'lastSpeed' in settings
          ) {
            throw new Error('Storage unavailable');
          }
          return realSet(settings);
        });
      vi.spyOn(window.VSC.StorageManager, 'remove').mockImplementation(async (keys) => {
        if (
          (failedPhase === 'speed-remove' && keys === 'lastSpeed') ||
          (failedPhase === 'stale-remove' && Array.isArray(keys))
        ) {
          throw new Error('Storage unavailable');
        }
        return realRemove(keys);
      });
      const message =
        action === 'restore'
          ? 'Defaults saved, but settings update could not finish'
          : 'Settings imported, but settings update could not finish';
      if (action === 'restore') {
        await clickAndWait('restore', message);
      } else {
        await importSettings(
          {
            rememberSpeed: false,
            keyBindings: previous.keyBindings,
            ...(phase === 'speed-prime' ? {} : { lastSpeed: 1 }),
          },
          message
        );
      }
      expect(getMockStorage().rememberSpeed).toBe(false);
      expect(remember.checked).toBe(true);
      expect(document.getElementById('panel-settings').inert).toBe(true);
      expect(document.getElementById('revert').disabled).toBe(false);
      set.mockClear();
      remember.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(set).not.toHaveBeenCalled();

      // Force the corresponding post-commit phase to fail during undo too.
      getMockStorage().replacementOnlySetting = 'remove during undo';
      if (phase === 'speed-prime') {
        failedPhase = 'speed-set';
      }
      await clickAndWait('revert', 'Could not revert changes: Storage unavailable');
      expect(document.getElementById('panel-settings').inert).toBe(true);
      expect(document.getElementById('revert').disabled).toBe(false);
      failedPhase = null;
      await clickAndWait('revert', 'Changes reverted');
      expect(getMockStorage()).toEqual(previous);
      expect(remember.checked).toBe(true);
      expect(document.getElementById('panel-settings').inert).toBe(false);
      expect(document.getElementById('revert').disabled).toBe(true);
    }
  );

  it.each(['restore', 'import'])(
    'keeps a saved %s replacement recoverable when its reload fails',
    async (action) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const remember = document.getElementById('rememberSpeed');
      remember.checked = true;
      await changeAndWait(remember);
      getMockStorage().obsoleteSetting = 'preserve me';
      getMockStorage().lastSpeed = 2;
      const previous = structuredClone(getMockStorage());
      const realGet = window.VSC.StorageManager.get.bind(window.VSC.StorageManager);
      const get = vi
        .spyOn(window.VSC.StorageManager, 'get')
        .mockImplementationOnce(realGet)
        .mockRejectedValue(new Error('Storage read unavailable'));
      const set = vi.spyOn(window.VSC.StorageManager, 'set');
      const message = action === 'restore' ? 'Defaults saved, but' : 'Settings imported, but';
      if (action === 'restore') {
        await clickAndWait('restore', message);
      } else {
        await importSettings({ rememberSpeed: false, keyBindings: previous.keyBindings }, message);
      }
      expect(getMockStorage().rememberSpeed).toBe(false);
      expect(getMockStorage().obsoleteSetting).toBeUndefined();
      expect(remember.checked).toBe(true);
      expect(document.getElementById('panel-settings').inert).toBe(true);
      expect(document.getElementById('panel-advanced').inert).toBe(true);
      expect(document.getElementById('revert').disabled).toBe(false);

      // Even a dispatched edit cannot write from the stale form baseline.
      set.mockClear();
      remember.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(set).not.toHaveBeenCalled();
      expect(document.getElementById('status').textContent).toContain(message);

      await clickAndWait('restore', 'Use Revert to recover before replacing them');
      expect(set).not.toHaveBeenCalled();

      await clickAndWait('revert', 'Could not revert changes: Storage read unavailable');
      expect(document.getElementById('revert').disabled).toBe(false);

      // An undo write can also succeed before its reload fails. Keep the full
      // snapshot until a subsequent retry can render the restored settings.
      get.mockImplementationOnce(realGet);
      document.getElementById('revert').click();
      await vi.waitFor(() =>
        expect(document.getElementById('status').textContent).toContain('Could not reload settings')
      );
      expect(getMockStorage()).toEqual(previous);
      expect(document.getElementById('panel-settings').inert).toBe(true);
      expect(document.getElementById('revert').disabled).toBe(false);

      get.mockRestore();
      await clickAndWait('revert', 'Changes reverted');
      expect(getMockStorage()).toEqual(previous);
      expect(remember.checked).toBe(true);
      expect(document.getElementById('panel-settings').inert).toBe(false);
      expect(document.getElementById('panel-advanced').inert).toBe(false);
      expect(document.getElementById('revert').disabled).toBe(true);
      remember.checked = false;
      await changeAndWait(remember);
      expect(getMockStorage().rememberSpeed).toBe(false);
    }
  );

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
    expect(document.getElementById('revert').disabled).toBe(false);
  });

  it.each(['restore', 'import'])(
    'can revert a full %s replacement, including omitted and obsolete keys',
    async (action) => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      getMockStorage().obsoleteSetting = 'preserve me';
      getMockStorage().lastSpeed = 2;
      const previous = JSON.stringify(getMockStorage());
      if (action === 'restore') {
        await clickAndWait('restore', 'Default options restored');
      } else {
        await importSettings({ keyBindings: [] }, 'Settings imported successfully');
      }
      await clickAndWait('revert', 'Changes reverted');
      expect(getMockStorage()).toEqual(JSON.parse(previous));
    }
  );

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

  it.each(['restore', 'import'])(
    'preserves existing settings when the snapshot read before %s fails',
    async (action) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const previous = JSON.stringify(getMockStorage());
      vi.spyOn(chrome.storage.sync, 'get').mockImplementation((_keys, callback) => {
        chrome.runtime.lastError = { message: 'Storage unavailable' };
        callback();
        chrome.runtime.lastError = null;
      });
      if (action === 'restore') {
        await clickAndWait(
          'restore',
          'Error restoring defaults: Storage read failed: Storage unavailable'
        );
      } else {
        await importSettings(
          { keyBindings: [] },
          'Import failed: Storage read failed: Storage unavailable'
        );
      }
      expect(JSON.stringify(getMockStorage())).toBe(previous);
      expect(document.getElementById('panel-settings').inert).toBe(false);
      expect(document.getElementById('revert').disabled).toBe(true);
    }
  );

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
