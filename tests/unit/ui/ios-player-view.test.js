import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('owned iOS player view', () => {
  let view;
  let parsedStyle;

  beforeEach(() => {
    view = new window.VSC.IOSPlayerView(document);
    document.body.append(view.host);
    // jsdom does not lay out shadow DOM. Parse the actual stylesheet to check
    // the touch/lock invariants without claiming browser geometry coverage.
    parsedStyle = document.createElement('style');
    parsedStyle.textContent = view.shadow.querySelector('style').textContent;
    document.head.append(parsedStyle);
  });

  afterEach(() => {
    view.destroy();
    parsedStyle.remove();
  });

  function styleFor(selector, property) {
    const rule = Array.from(parsedStyle.sheet.cssRules)
      .reverse()
      .find(
        (entry) =>
          entry.selectorText?.split(',').some((candidate) => candidate.trim() === selector) &&
          (!property || entry.style.getPropertyValue(property))
      );
    expect(rule, `Missing view style: ${selector}`).toBeTruthy();
    return rule.style;
  }

  it('keeps owned fullscreen and lock in the header with explicit accessible names', () => {
    expect(view.refs.fullscreen.closest('header')).toBeTruthy();
    expect(view.refs.fullscreen.getAttribute('aria-label')).toBe('Enter full screen');
    expect(view.refs.lock.closest('header')).toBeTruthy();
    expect(view.refs.lock.getAttribute('aria-label')).toBe('Lock playback controls');
    expect(view.refs.lock.getAttribute('aria-pressed')).toBe('false');
    expect(view.refs.lock.type).toBe('button');
    expect(view.refs.lock.hidden).toBe(false);
    const buttonStyle = styleFor('button');
    expect(buttonStyle.getPropertyValue('min-width')).toBe('44px');
    expect(buttonStyle.getPropertyValue('min-height')).toBe('44px');
  });

  it('keeps unlock independent of the HUD with a safe-area 44px target', () => {
    const unlock = view.refs.unlock;
    expect(unlock.getAttribute('aria-label')).toBe('Unlock playback controls');
    expect(unlock.type).toBe('button');
    expect(unlock.hidden).toBe(true);
    expect(unlock.parentElement).toBe(view.screen);
    expect(unlock.closest('.hud')).toBeNull();
    const style = styleFor('.unlock', 'position');
    expect(style.getPropertyValue('position')).toBe('absolute');
    expect(style.getPropertyValue('min-width')).toBe('44px');
    expect(style.getPropertyValue('min-height')).toBe('44px');
    expect(style.getPropertyValue('top')).toContain('env(safe-area-inset-top)');
    expect(style.getPropertyValue('right')).toContain('env(safe-area-inset-right)');
  });

  it('uses decorative icons with accessible names and numeric speed controls', () => {
    for (const ref of [
      'done',
      'lock',
      'unlock',
      'fullscreen',
      'back',
      'play',
      'forward',
      'preferred',
      'fit',
      'mute',
      'more',
    ]) {
      const button = view.refs[ref];
      expect(button.getAttribute('aria-label')).toBeTruthy();
      const icon = button.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('focusable')).toBe('false');
      expect(button.childNodes).toHaveLength(1);
    }
    expect(view.refs.normal.textContent).toBe('1×');
    expect(view.refs.native.textContent).toBe('Apple player');
    expect(styleFor('.transport button', 'background').getPropertyValue('background')).toBe(
      'transparent'
    );
    const icon = view.refs.play.firstChild;
    window.VSC.ShadowDOMManager.setControlIcon(view.refs.play, 'play');
    expect(view.refs.play.firstChild).toBe(icon);
  });

  it('makes lock override focus-based HUD reveal while preserving the standalone unlock', () => {
    const lockedHUD = styleFor(':host([data-controls-locked]) .hud');
    expect(lockedHUD.getPropertyValue('display')).toBe('none');
    expect(lockedHUD.getPropertyPriority('display')).toBe('important');
    // The existing focus-within exception only changes visibility; it cannot
    // bring a display:none HUD back while the controls are locked.
    expect(
      styleFor(':host([data-controls-hidden]) .hud:focus-within').getPropertyValue('display')
    ).toBe('');
    expect(view.refs.unlock.closest('.hud')).toBeNull();
    expect(styleFor('[hidden]').getPropertyPriority('display')).toBe('important');
  });

  it('provides polite seek feedback outside the HUD with independent left/right placement', () => {
    const feedback = view.refs.seekFeedback;
    expect(feedback.parentElement).toBe(view.screen);
    expect(feedback.closest('.hud')).toBeNull();
    expect(feedback.hidden).toBe(true);
    expect(feedback.textContent).toBe('');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.getAttribute('aria-atomic')).toBe('true');
    const style = styleFor('.seek-feedback');
    expect(style.getPropertyValue('pointer-events')).toBe('none');
    expect(style.getPropertyValue('top')).toBe('50%');
    expect(style.getPropertyValue('transform')).toBe('translate(-50%, -50%)');
    expect(style.getPropertyValue('font-size')).toBe('clamp(24px, 6vw, 40px)');
    expect(styleFor(".seek-feedback[data-side='left']").getPropertyValue('left')).toBe('25%');
    expect(styleFor(".seek-feedback[data-side='right']").getPropertyValue('left')).toBe('75%');
    const lockedFeedback = styleFor(':host([data-controls-locked]) .seek-feedback');
    expect(lockedFeedback.getPropertyValue('display')).toBe('none');
    expect(lockedFeedback.getPropertyPriority('display')).toBe('important');
  });

  it('exposes the Apple player only as a separate initially hidden More option', () => {
    expect(view.refs.extra.contains(view.refs.native)).toBe(true);
    expect(view.refs.native.getAttribute('aria-label')).toBe('Open Apple fullscreen player');
    expect(view.refs.native.textContent).toBe('Apple player');
    expect(view.refs.native.type).toBe('button');
    expect(view.refs.native.hidden).toBe(true);
    expect(view.refs.native).not.toBe(view.refs.fullscreen);
    const nodes = Array.from(view.shadow.querySelectorAll('[data-ref]'));
    expect(Object.keys(view.refs)).toHaveLength(nodes.length);
    expect(new Set(Object.values(view.refs)).size).toBe(nodes.length);
  });
});
