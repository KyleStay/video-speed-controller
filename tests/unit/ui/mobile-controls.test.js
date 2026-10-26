import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Mobile controller interactions and lifecycle', () => {
  let wrapper;
  let shadow;
  let video;
  let manager;
  let actionHandler;
  let mediaQuery;

  beforeEach(() => {
    mediaQuery = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery)
    );
    wrapper = document.createElement('vsc-controller');
    document.body.append(wrapper);
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper);
    video = document.createElement('video');
    document.body.append(video);
    actionHandler = { runAction: vi.fn(), adjustSpeed: vi.fn() };
    manager = new window.VSC.ControlsManager(actionHandler, { getKeyBinding: () => 0.1 });
    manager.setupControlEvents(shadow, video);
  });

  afterEach(() => {
    manager.cleanup();
    video.remove();
    wrapper.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens by tapping and closes explicitly without hiding the controller', () => {
    const indicator = shadow.querySelector('.draggable');
    expect(wrapper.hasAttribute('data-vsc-touch')).toBe(true);
    expect(indicator.getAttribute('aria-expanded')).toBe('false');
    indicator.click();
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(true);
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    shadow.querySelector('[data-action="close"]').click();
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    expect(wrapper.classList.contains('vsc-hidden')).toBe(false);
    expect(shadow.activeElement).toBe(indicator);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('constructs controller icons without HTML parsing sinks', () => {
    const guardedHost = document.createElement('vsc-controller');
    const sink = vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(() => {
      throw new TypeError('TrustedHTML required');
    });
    try {
      const root = window.VSC.ShadowDOMManager.createShadowDOM(guardedHost);
      const icon = root.querySelector('.inline-fullscreen svg');
      expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.querySelector('path').namespaceURI).toBe(icon.namespaceURI);
      expect(sink).not.toHaveBeenCalled();
    } finally {
      sink.mockRestore();
    }
  });

  it('routes an absolute preset from the button even when a child is tapped', () => {
    const button = shadow.querySelector('[data-action="setSpeed"][data-value="1.5"]');
    const child = document.createElement('span');
    button.append(child);
    child.click();
    expect(actionHandler.runAction).toHaveBeenCalledTimes(1);
    expect(actionHandler.runAction).toHaveBeenCalledWith('SET_SPEED', 1.5, expect.any(Event));
  });

  it('keeps touch pointer scrolling available and never begins a drag', () => {
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    shadow.querySelector('.draggable').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('toggles with Enter or Space and closes with Escape', () => {
    const indicator = shadow.querySelector('.draggable');
    const key = (value) =>
      indicator.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
      );
    key('Enter');
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(true);
    key(' ');
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    key('Enter');
    key('Escape');
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('closes on outside pointer and pagehide, without an action', () => {
    const indicator = shadow.querySelector('.draggable');
    indicator.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    indicator.click();
    window.dispatchEvent(new Event('pagehide'));
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('removes media presentation, matchMedia, and expanded-panel listeners during cleanup', () => {
    const videoRemove = vi.spyOn(video, 'removeEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    shadow.querySelector('.draggable').click();
    manager.cleanup();
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    expect(manager.closeTouchControls).toBe(null);
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(windowRemove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(windowRemove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    for (const type of [
      'webkitpresentationmodechanged',
      'webkitbeginfullscreen',
      'webkitendfullscreen',
      'enterpictureinpicture',
      'leavepictureinpicture',
    ]) {
      expect(videoRemove).toHaveBeenCalledWith(type, expect.any(Function));
    }
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
    expect(wrapper.classList.contains('vsc-native-presentation')).toBe(false);
    expect(() => manager.cleanup()).not.toThrow();
  });

  it('closes the panel during native presentation and restores the inline pill', () => {
    shadow.querySelector('.draggable').click();
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
    expect(wrapper.classList.contains('vsc-native-presentation')).toBe(true);
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
    video.dispatchEvent(new Event('webkitendfullscreen'));
    expect(wrapper.classList.contains('vsc-native-presentation')).toBe(false);
    expect(wrapper.classList.contains('vsc-touch-open')).toBe(false);
  });

  it('retains desktop Enter reset and pointer drag when a fine pointer is active', () => {
    manager.setTouchMode(shadow, false);
    const indicator = shadow.querySelector('.draggable');
    expect(indicator.hasAttribute('aria-expanded')).toBe(false);
    indicator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(actionHandler.runAction).toHaveBeenCalledWith('reset', 0.1, expect.any(Event));
    indicator.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(actionHandler.runAction).toHaveBeenCalledWith('drag', false, expect.any(Event));
  });
});
