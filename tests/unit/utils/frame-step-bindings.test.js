/**
 * Tests for the frame-step predefined bindings (rewindFrame "," / advanceFrame ".").
 *
 * Covers the binding shape in key-maps / constants: presence in
 * PREDEFINED_ACTIONS, and the all-false modifiers object that keeps them
 * shift-exclusive (so YouTube's "<" / ">" speed keys survive).
 */

describe('Frame-step predefined bindings', () => {
  const bindings = () => window.VSC.Constants.DEFAULT_SETTINGS.keyBindings;
  const byAction = (action) => bindings().find((b) => b.action === action);

  it('PREDEFINED_ACTIONS includes the two frame-step actions (total 11)', () => {
    const actions = window.VSC.Constants.PREDEFINED_ACTIONS;
    expect(actions).toContain('rewindFrame');
    expect(actions).toContain('advanceFrame');
    expect(actions.length).toBe(11);
  });

  it('DEFAULT_SETTINGS.keyBindings includes rewindFrame (Comma/188, all-false modifiers)', () => {
    const b = byAction('rewindFrame');
    expect(b).toBeDefined();
    expect(b.code).toBe('Comma');
    expect(b.key).toBe(188);
    expect(b.keyCode).toBe(188);
    expect(b.displayKey).toBe(',');
    expect(b.value).toBe(30);
    expect(b.predefined).toBe(true);
    expect(b.modifiers).toEqual({ ctrl: false, alt: false, shift: false, meta: false });
  });

  it('DEFAULT_SETTINGS.keyBindings includes advanceFrame (Period/190, all-false modifiers)', () => {
    const b = byAction('advanceFrame');
    expect(b).toBeDefined();
    expect(b.code).toBe('Period');
    expect(b.key).toBe(190);
    expect(b.keyCode).toBe(190);
    expect(b.displayKey).toBe('.');
    expect(b.value).toBe(30);
    expect(b.predefined).toBe(true);
    expect(b.modifiers).toEqual({ ctrl: false, alt: false, shift: false, meta: false });
  });

  it('frame-step actions are NOT in CUSTOM_ACTIONS_NO_VALUES (they use the fps value field)', () => {
    const noValues = window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES;
    expect(noValues).not.toContain('rewindFrame');
    expect(noValues).not.toContain('advanceFrame');
  });
});
