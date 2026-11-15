import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Overlay speed buttons', () => {
  let wrapper;
  let shadow;
  let config;
  let actionHandler;

  beforeEach(() => {
    wrapper = document.createElement('vsc-controller');
    document.body.append(wrapper);
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper);
    config = { getKeyBinding: vi.fn(() => 1.8) };
    actionHandler = { runAction: vi.fn() };
    new window.VSC.ControlsManager(actionHandler, config).setupButtonHandlers(shadow);
  });

  afterEach(() => wrapper.remove());

  it('exposes normal and preferred speed controls on desktop with accessible names', () => {
    const normal = shadow.querySelector('[data-action="setSpeed"][data-value="1"]');
    const preferred = shadow.querySelector('[data-action="preferredSpeed"]');
    for (const button of [normal, preferred]) {
      expect(button.classList.contains('touch-only')).toBe(false);
      expect(button.type).toBe('button');
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.title).toBeTruthy();
    }
    expect(normal.textContent).toBe('1×');
    expect(preferred.textContent).toBe('Pref');
  });

  it('always sets 1×, independent of reset bindings and repeated clicks', () => {
    const normal = shadow.querySelector('[data-action="setSpeed"][data-value="1"]');
    normal.click();
    normal.click();
    expect(actionHandler.runAction).toHaveBeenCalledTimes(2);
    for (const call of actionHandler.runAction.mock.calls) {
      expect(call).toEqual(['SET_SPEED', 1, expect.any(Event)]);
    }
    expect(config.getKeyBinding).not.toHaveBeenCalled();
    window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, 1);
    expect(normal.getAttribute('aria-pressed')).toBe('true');
    window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, 1.8);
    expect(normal.getAttribute('aria-pressed')).toBe('false');
  });

  it('reads the current preferred setting on every click, including child targets', () => {
    const preferred = shadow.querySelector('[data-action="preferredSpeed"]');
    preferred.click();
    expect(actionHandler.runAction).toHaveBeenLastCalledWith('SET_SPEED', 1.8, expect.any(Event));
    config.getKeyBinding.mockReturnValue(2.5);
    const child = document.createElement('span');
    preferred.append(child);
    child.click();
    expect(config.getKeyBinding).toHaveBeenLastCalledWith('fast');
    expect(actionHandler.runAction).toHaveBeenLastCalledWith('SET_SPEED', 2.5, expect.any(Event));
  });

  it('falls back to 1× when the preferred binding has been removed', () => {
    config.getKeyBinding.mockReturnValue(false);
    shadow.querySelector('[data-action="preferredSpeed"]').click();
    expect(actionHandler.runAction).toHaveBeenCalledWith('SET_SPEED', 1, expect.any(Event));
  });

  it('changes only the media belonging to the clicked overlay', () => {
    const video = document.createElement('video');
    const other = document.createElement('video');
    video.vsc = { div: wrapper };
    other.vsc = { div: document.createElement('vsc-controller') };
    const registry = vi
      .spyOn(window.VSC.stateManager, 'getControlledElements')
      .mockReturnValue([video, other]);
    const handler = new window.VSC.ActionHandler(config, null);
    const execute = vi.spyOn(handler, 'executeAction').mockImplementation(() => {});
    actionHandler.runAction.mockImplementation((...args) => handler.runAction(...args));
    try {
      shadow.querySelector('[data-action="preferredSpeed"]').click();
      expect(execute).toHaveBeenCalledExactlyOnceWith('SET_SPEED', 1.8, video, expect.any(Event));
    } finally {
      registry.mockRestore();
    }
  });
});
