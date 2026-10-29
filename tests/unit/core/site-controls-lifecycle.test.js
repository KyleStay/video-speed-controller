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
    siteControls: new window.VSC.IOSSiteControls(video),
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
    expect(video.parentElement.hasAttribute('data-vsc-ios-site-controls')).toBe(false);
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

  it('shares one suppression owner with iOS and defers acquisition to presentation policy', () => {
    const controller = controllerFor([{ pattern: '/.*/', hideSiteControls: true }]);
    const player = new window.VSC.IOSPlayer(controller);
    controller.iosPlayer = player;
    expect(player.siteControls).toBe(controller.siteControls);
    // No attachment/usable inline player: changing a preference cannot reacquire it.
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBeNull();
    player.attached = true;
    player.mediaPrepared = true;
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBe(controller.video.parentElement);
    window.VSC.IOSPlayer.siteRelinquished.add(controller.video);
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBeNull();
    window.VSC.IOSPlayer.siteRelinquished.delete(controller.video);
    controller.refreshSiteControls();
    expect(controller.siteControls.container).toBe(controller.video.parentElement);
  });
});
