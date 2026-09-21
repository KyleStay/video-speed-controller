import { BridgeEventTarget } from '../../../src/utils/bridge-events.js';

describe('bridge events across document replacement', () => {
  let doc;
  let main;
  let isolated;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('bridge fixture');
    main = new BridgeEventTarget(doc);
    isolated = new BridgeEventTarget(doc);
  });

  afterEach(() => {
    main.disconnect();
    isolated.disconnect();
  });

  it('preserves settings, storage and lifecycle messages across repeated root replacements', async () => {
    const settings = vi.fn();
    const changes = vi.fn();
    const messages = vi.fn();
    isolated.addEventListener('VSC_REQUEST_SETTINGS', () => {
      isolated.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: { lastSpeed: 2 } }));
    });
    main.addEventListener('VSC_SETTINGS_READY', settings);
    main.addEventListener('VSC_STORAGE_CHANGED', changes);
    main.addEventListener('VSC_MESSAGE', messages);

    for (let count = 1; count <= 3; count++) {
      const oldRoot = doc.documentElement;
      doc.replaceChild(oldRoot.cloneNode(true), oldRoot);
      await Promise.resolve();
      main.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      isolated.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED'));
      isolated.dispatchEvent(new CustomEvent('VSC_MESSAGE'));
      expect(settings).toHaveBeenCalledTimes(count);
      expect(settings.mock.lastCall[0].detail.lastSpeed).toBe(2);
      expect(changes).toHaveBeenCalledTimes(count);
      expect(messages).toHaveBeenCalledTimes(count);
      oldRoot.dispatchEvent(new CustomEvent('VSC_MESSAGE'));
      expect(messages).toHaveBeenCalledTimes(count);
    }
  });

  it('keeps subscriptions through a temporarily absent root and removes them after rebinding', async () => {
    const handler = vi.fn();
    main.addEventListener('VSC_MESSAGE_RESULT', handler);
    const root = doc.documentElement;
    doc.removeChild(root);
    await Promise.resolve();
    doc.appendChild(root.cloneNode(true));
    await Promise.resolve();
    doc.documentElement.dispatchEvent(new CustomEvent('VSC_MESSAGE_RESULT'));
    expect(handler).toHaveBeenCalledOnce();
    main.removeEventListener('VSC_MESSAGE_RESULT', handler);
    expect(main.observer).toBeNull();
    doc.documentElement.dispatchEvent(new CustomEvent('VSC_MESSAGE_RESULT'));
    expect(handler).toHaveBeenCalledOnce();
  });
});
