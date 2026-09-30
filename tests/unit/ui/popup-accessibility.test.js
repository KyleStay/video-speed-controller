import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  cleanupChromeMock,
  installChromeMock,
  resetMockStorage,
  getMockStorage,
} from '../../helpers/chrome-mock.js';

const popupHtml = readFileSync(resolve(process.cwd(), 'src/ui/popup/popup.html'), 'utf8');
const popupCss = readFileSync(resolve(process.cwd(), 'src/ui/popup/popup.css'), 'utf8');

function renderPopup() {
  document.body.innerHTML = `
    <button id="config"></button>
    <button id="disable"></button>
    <button id="speed-decrease" data-delta="-0.1"><span>-0.1</span></button>
    <button id="speed-reset">1x</button>
    <button id="speed-increase" data-delta="0.1"><span>+0.1</span></button>
    <div class="preset-grid" role="group" aria-label="Speed presets">
      <button class="preset-btn" data-speed="0.5" aria-pressed="false">0.5</button>
      <button class="preset-btn" data-speed="1.0" aria-pressed="false">1</button>
      <button class="preset-btn" data-speed="1.5" aria-pressed="false">1.5</button>
    </div>
    <form id="custom-speed-form">
      <input id="custom-speed-input" aria-describedby="status" aria-invalid="false" />
      <button id="custom-speed-apply" type="submit">Set</button>
    </form>
    <div id="status" class="status hide" role="status" aria-live="polite"></div>
  `;
}

async function initializePopup() {
  vi.resetModules();
  let initialize;
  const add = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (type === 'DOMContentLoaded') {
        initialize = listener;
      } else {
        add(type, listener, options);
      }
    });
  await import('../../../src/ui/popup/popup.js');
  spy.mockRestore();
  initialize();
  await vi.waitFor(() =>
    expect(document.getElementById('status').classList.contains('hide')).toBe(false)
  );
}

describe('Popup accessibility', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    chrome.runtime.onMessage.removeListener = vi.fn();
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tabId, _message, callback) => {
      callback?.({ ok: true, mediaCount: 1, currentSpeed: 1 });
    });
    renderPopup();
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    delete chrome.runtime.onMessage.removeListener;
    cleanupChromeMock();
  });

  it('names preset groups and initializes pressed states', async () => {
    await initializePopup();

    const presetGrid = document.querySelector('.preset-grid');
    expect(presetGrid.getAttribute('role')).toBe('group');
    expect(presetGrid.getAttribute('aria-label')).toBe('Speed presets');
    expect(
      [...document.querySelectorAll('.preset-btn')].every((button) =>
        button.hasAttribute('aria-pressed')
      )
    ).toBe(true);

    const customSpeedInput = document.getElementById('custom-speed-input');
    expect(customSpeedInput.getAttribute('aria-describedby')).toBe('status');
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('false');
  });

  it('marks invalid custom speed input and avoids sending invalid commands', async () => {
    await initializePopup();
    chrome.tabs.sendMessage.mockClear();

    const customSpeedInput = document.getElementById('custom-speed-input');
    customSpeedInput.value = '20';
    document
      .getElementById('custom-speed-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('status').textContent).toBe(
      'Speed must be between 0.07x and 16x.'
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();

    customSpeedInput.value = '1.25';
    document
      .getElementById('custom-speed-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('false');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'VSC_SET_SPEED', payload: { speed: 1.25 } }),
      expect.any(Function)
    );
  });

  it('keeps invalid custom speed state until the typed value is valid', async () => {
    await initializePopup();

    const customSpeedInput = document.getElementById('custom-speed-input');
    customSpeedInput.value = '20';
    document
      .getElementById('custom-speed-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('true');

    customSpeedInput.value = '19';
    customSpeedInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('true');

    customSpeedInput.value = '1.5';
    customSpeedInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('false');
  });

  it('disables speed controls when the active tab cannot be controlled', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_query, callback) => {
      callback([{ id: 1, url: 'chrome://extensions' }]);
    });
    chrome.tabs.sendMessage.mockImplementation((_tabId, _message, callback) => {
      chrome.runtime.lastError = { message: 'Cannot access this page' };
      callback?.();
      chrome.runtime.lastError = null;
    });

    await initializePopup();

    expect(document.getElementById('status').textContent).toBe(
      'Controls are not available on browser pages.'
    );
    expect(document.getElementById('speed-decrease').disabled).toBe(true);
    expect(document.querySelector('.preset-btn').disabled).toBe(true);
    expect(document.getElementById('custom-speed-input').disabled).toBe(true);
    expect(document.getElementById('config').disabled).toBe(false);
    expect(document.getElementById('disable').disabled).toBe(false);
  });

  it('disables controls on power off and refreshes them on power on in the same popup', async () => {
    await initializePopup();
    document.getElementById('disable').click();
    await vi.waitFor(() =>
      expect(document.getElementById('status').textContent).toBe('Extension disabled.')
    );
    expect(document.getElementById('speed-increase').disabled).toBe(true);
    expect(document.getElementById('custom-speed-input').value).toBe('');
    document.getElementById('disable').click();
    await vi.waitFor(() => expect(document.getElementById('speed-increase').disabled).toBe(false));
    expect(document.getElementById('status').textContent).toBe('Current 1x');
  });

  it('enables presets when only an iframe contains media', async () => {
    let receive;
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((listener) => {
      receive = listener;
    });
    chrome.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
      callback({ ok: true, mediaCount: 0, currentSpeed: null, speeds: [] });
      receive(
        {
          type: 'VSC_FRAME_RESULT',
          commandId: message.commandId,
          response: {
            ok: true,
            mediaCount: 1,
            currentSpeed: 1.5,
            speeds: [1.5],
          },
        },
        { id: chrome.runtime.id, tab: { id: 1 }, frameId: 3 }
      );
    });
    await initializePopup();
    expect(document.getElementById('speed-increase').disabled).toBe(false);
    expect(
      document.querySelector('.preset-btn[data-speed="1.5"]').getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('does not allow an in-flight status response to re-enable controls after power off', async () => {
    await initializePopup();
    document.getElementById('speed-increase').click();
    document.getElementById('disable').click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(document.getElementById('speed-increase').disabled).toBe(true);
    expect(document.getElementById('status').textContent).toBe('Extension disabled.');
  });

  it('starts disabled and can re-enable controls without reopening the popup', async () => {
    getMockStorage().enabled = false;
    await initializePopup();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('speed-increase').disabled).toBe(true);
    document.getElementById('disable').click();
    await vi.waitFor(() => expect(document.getElementById('speed-increase').disabled).toBe(false));
  });

  it('waits for asynchronously reattached media after turning the extension back on', async () => {
    getMockStorage().enabled = false;
    let reads = 0;
    chrome.tabs.sendMessage.mockImplementation((_tab, _message, callback) => {
      reads++;
      callback({ ok: true, mediaCount: reads < 3 ? 0 : 1, currentSpeed: reads < 3 ? null : 1 });
    });
    await initializePopup();
    document.getElementById('disable').click();
    await vi.waitFor(() => expect(document.getElementById('speed-increase').disabled).toBe(false), {
      timeout: 2000,
    });
    expect(reads).toBe(3);
  });

  it('reports failed power writes and preserves the current enabled state', async () => {
    await initializePopup();
    vi.spyOn(chrome.storage.sync, 'set').mockImplementation((_items, callback) => {
      chrome.runtime.lastError = { message: 'Quota exceeded' };
      callback();
      chrome.runtime.lastError = null;
    });
    document.getElementById('disable').click();
    expect(document.getElementById('status').textContent).toBe(
      'Unable to save the enabled setting.'
    );
    expect(document.getElementById('disable').getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('disable').disabled).toBe(false);
  });

  it('uses custom validation and visible disabled states for popup controls', () => {
    expect(popupHtml).toContain('<html lang="en">');
    expect(popupHtml).toContain('<title>StayFast Video</title>');
    expect(popupHtml).toContain('Every video. Your speed.');
    expect(popupHtml).toContain('by StayTech');
    expect(popupHtml).toContain('id="custom-speed-form"');
    expect(popupHtml).toContain('novalidate');
    expect(popupCss).toContain('.control-btn:disabled');
    expect(popupCss).toContain('.control-btn:disabled:hover');
    expect(popupCss).toMatch(
      /\.reset-btn\s*\{[^}]*background:\s*var\(--md-primary\);[^}]*color:\s*var\(--md-on-primary\);/s
    );
  });
});
