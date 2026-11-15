import { afterEach, describe, expect, it, vi } from 'vitest';

const controllers = [];

function controllerFor(rules) {
  const container = document.createElement('div');
  container.className = 'video-js';
  const video = document.createElement('video');
  const button = document.createElement('button');
  button.textContent = 'Site play';
  container.append(video, button);
  document.body.append(container);
  const config = { settings: { enabled: true, siteRules: rules } };
  const controller = Object.create(window.VSC.VideoController.prototype);
  Object.assign(controller, {
    video,
    config,
    siteControls: new window.VSC.SiteControls(video),
  });
  controllers.push({ controller, container });
  return controller;
}

afterEach(() => {
  for (const { controller, container } of controllers.splice(0)) {
    controller.siteControls.release();
    container.remove();
  }
  vi.restoreAllMocks();
});

describe('per-site video button ownership', () => {
  it('uses a strict opt-in and releases desktop controls live without touching playback', () => {
    const rule = { pattern: '/.*/', enabled: true, speed: null };
    const controller = controllerFor([rule]);
    const { video, siteControls, config } = controller;
    const play = vi.spyOn(video, 'play');
    const pause = vi.spyOn(video, 'pause');
    const load = vi.spyOn(video, 'load');
    const source = video.getAttribute('src');
    for (const value of [undefined, false, 'true', 1]) {
      rule.hideSiteControls = value;
      controller.refreshSiteControls();
      expect(siteControls.container).toBeNull();
    }
    rule.hideSiteControls = true;
    controller.refreshSiteControls();
    expect(siteControls.container).toBe(video.parentElement);
    config.settings.siteRules = [];
    controller.refreshSiteControls();
    expect(siteControls.container).toBeNull();
    expect(video.parentElement.hasAttribute('data-vsc-site-controls')).toBe(false);
    expect(video.getAttribute('src')).toBe(source);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('respects first-match, global disable and the current document URL', () => {
    const controller = controllerFor([
      { pattern: '/.*/', enabled: true },
      { pattern: '/.*/', enabled: true, hideSiteControls: true },
    ]);
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBeNull();
    controller.config.settings.siteRules.shift();
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBe(controller.video.parentElement);
    controller.config.settings.enabled = false;
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBeNull();
    controller.config.settings.enabled = true;
    controller.config.settings.siteRules[0].enabled = false;
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBeNull();
    controller.config.settings.siteRules[0] = {
      pattern: 'unrelated.example',
      hideSiteControls: true,
    };
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBeNull();
  });
  it('hides only local site buttons, including late controls, and restores them on live opt-out', async () => {
    const rule = { pattern: '/.*/', enabled: true, hideSiteControls: true };
    const controller = controllerFor([rule]);
    const container = controller.video.parentElement;
    const caption = document.createElement('div');
    caption.className = 'caption';
    const captionAction = document.createElement('button');
    caption.append(captionAction);
    const own = document.createElement('vsc-controller');
    const ownAction = document.createElement('button');
    own.append(ownAction);
    const unrelated = document.createElement('button');
    document.body.append(unrelated);
    container.append(caption, own);
    controller.video.controls = true;
    const source = controller.video.getAttribute('src');
    controller.refreshSiteControls();
    const siteButton = container.querySelector('button');
    expect(getComputedStyle(siteButton).display).toBe('none');
    expect(getComputedStyle(captionAction).display).not.toBe('none');
    expect(getComputedStyle(ownAction).display).not.toBe('none');
    expect(getComputedStyle(unrelated).display).not.toBe('none');
    const late = document.createElement('button');
    container.append(late);
    await vi.waitFor(() => expect(getComputedStyle(late).display).toBe('none'));
    rule.hideSiteControls = false;
    controller.refreshSiteControls();
    expect(getComputedStyle(siteButton).display).not.toBe('none');
    expect(getComputedStyle(late).display).not.toBe('none');
    expect(controller.video.controls).toBe(true);
    expect(controller.video.getAttribute('src')).toBe(source);
    unrelated.remove();
  });

  it('releases a scope that becomes ambiguous without suppressing another media player', async () => {
    const controller = controllerFor([{ pattern: '/.*/', hideSiteControls: true }]);
    controller.refreshSiteControls();
    const container = controller.video.parentElement;
    const button = container.querySelector('button');
    expect(getComputedStyle(button).display).toBe('none');
    container.append(document.createElement('video'));
    await vi.waitFor(() => expect(controller.siteControls.container).toBeNull());
    expect(getComputedStyle(button).display).not.toBe('none');
    expect(container.hasAttribute('data-vsc-site-controls')).toBe(false);
  });

  it('restores prior page markers and style ownership exactly on cleanup', () => {
    const controller = controllerFor([{ pattern: '/.*/', hideSiteControls: true }]);
    const container = controller.video.parentElement;
    const button = container.querySelector('button');
    container.setAttribute('data-vsc-site-controls', 'publisher-scope');
    button.setAttribute('data-vsc-site-hidden-control', 'publisher-button');
    controller.refreshSiteControls();
    const style = controller.siteControls.style;
    expect(style.isConnected).toBe(true);
    controller.siteControls.cleanup();
    expect(container.getAttribute('data-vsc-site-controls')).toBe('publisher-scope');
    expect(button.getAttribute('data-vsc-site-hidden-control')).toBe('publisher-button');
    expect(style.isConnected).toBe(false);
    expect(getComputedStyle(button).display).not.toBe('none');
  });
});
