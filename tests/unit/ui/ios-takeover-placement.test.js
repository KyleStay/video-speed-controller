import { afterEach, describe, expect, it, vi } from 'vitest';

const marker = 'data-vsc-ios-site-controls';
const helpers = [];

function fixture() {
  const original = document.createElement('section');
  original.className = 'html5-video-player';
  const originalChrome = document.createElement('div');
  originalChrome.className = 'ytp-chrome-bottom';
  const ancestor = document.createElement('div');
  const parent = document.createElement('div');
  const video = document.createElement('video');
  video.src = 'https://media.example.test/retained.mp4';
  video.currentTime = 12;
  video.playbackRate = 1.5;
  video.getBoundingClientRect = vi.fn(() => ({ width: 320, height: 180 }));
  const div = document.createElement('vsc-controller');
  parent.append(video, div);
  ancestor.append(parent);
  original.append(originalChrome, ancestor);

  const destination = document.createElement('section');
  destination.className = 'plyr';
  const destinationChrome = document.createElement('div');
  destinationChrome.className = 'plyr__controls';
  destination.append(destinationChrome);
  document.body.append(original, destination);

  const controller = Object.assign(Object.create(window.VSC.VideoController.prototype), {
    video,
    div,
    parent,
    mediaParentAncestor: ancestor,
    insertionParent: parent,
    disposed: false,
    config: { settings: { siteRules: [] } },
    siteControls: new window.VSC.IOSSiteControls(video),
    controlsManager: { inlineIOS: true },
    insertIntoDOM: vi.fn((_document, wrapper) => video.parentElement.append(wrapper)),
    positionControls: vi.fn(),
  });
  const player = new window.VSC.IOSPlayer(controller);
  controller.iosPlayer = player;
  video.vsc = controller;
  player.attached = true;
  player.mediaPrepared = true;
  helpers.push(player.siteControls);
  expect(player.siteControls.acquire()).toBe(true);
  const initialStyle = player.siteControls.style;
  const refresh = vi.spyOn(player, 'refreshSiteControls');
  const acquire = vi.spyOn(player.siteControls, 'acquire');
  const repair = () => window.VSC.VideoController.prototype.repairDOMPlacement.call(controller);
  return {
    original,
    originalChrome,
    ancestor,
    parent,
    video,
    div,
    destination,
    destinationChrome,
    controller,
    player,
    initialStyle,
    refresh,
    acquire,
    repair,
  };
}

function expectTransferred(item) {
  expect(item.original.hasAttribute(marker)).toBe(false);
  expect(item.initialStyle.isConnected).toBe(false);
  expect(getComputedStyle(item.originalChrome).display).not.toBe('none');
  expect(item.destination.getAttribute(marker)).toBe(item.player.siteControls.token);
  expect(getComputedStyle(item.destinationChrome).display).toBe('none');
  expect(item.video.vsc).toBe(item.controller);
  expect(item.video.src).toBe('https://media.example.test/retained.mp4');
  expect(item.video.currentTime).toBe(12);
  expect(item.video.playbackRate).toBe(1.5);
  expect(item.video.getBoundingClientRect).not.toHaveBeenCalled();
}

afterEach(() => {
  for (const helper of helpers.splice(0)) {
    helper.cleanup();
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('iOS site-control ownership during controller placement repair', () => {
  it('moves suppression to the new player when the same-size original media is reparented', () => {
    const item = fixture();
    item.destination.append(item.video);
    expect(item.repair()).toBe(true);
    expect(item.controller.insertIntoDOM).toHaveBeenCalledOnce();
    expect(item.controller.positionControls).toHaveBeenCalledExactlyOnceWith(item.div);
    expect(item.div.parentNode).toBe(item.destination);
    expect(item.refresh).toHaveBeenCalled();
    expectTransferred(item);
  });

  it('refreshes a moved higher ancestor even when direct placement and its parent are unchanged', () => {
    const item = fixture();
    item.destination.append(item.ancestor);
    expect(item.video.parentNode).toBe(item.parent);
    expect(item.parent.parentNode).toBe(item.ancestor);
    expect(item.repair()).toBe(false);
    expect(item.controller.insertIntoDOM).not.toHaveBeenCalled();
    expect(item.controller.positionControls).not.toHaveBeenCalled();
    expect(item.refresh).toHaveBeenCalledOnce();
    expectTransferred(item);
  });

  it('does not reacquire or measure unchanged placement on repeated reconciliation', () => {
    const item = fixture();
    expect(item.repair()).toBe(false);
    expect(item.repair()).toBe(false);
    expect(item.refresh).not.toHaveBeenCalled();
    expect(item.acquire).not.toHaveBeenCalled();
    expect(item.player.siteControls.style).toBe(item.initialStyle);
    expect(item.controller.positionControls).not.toHaveBeenCalled();
    expect(item.video.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it.each(['active', 'disposed', 'detached-media'])('skips placement refresh for %s', (state) => {
    const item = fixture();
    item.destination.append(item.video);
    if (state === 'active') {
      item.player.active = true;
    }
    if (state === 'disposed') {
      item.controller.disposed = true;
    }
    if (state === 'detached-media') {
      item.video.remove();
    }
    expect(item.repair()).toBe(false);
    expect(item.refresh).not.toHaveBeenCalled();
    expect(item.acquire).not.toHaveBeenCalled();
    expect(item.controller.insertIntoDOM).not.toHaveBeenCalled();
  });

  it.each(['unprepared', 'site-handback', 'unavailable-inline', 'disposed-player'])(
    'does not reacquire site chrome for %s',
    (state) => {
      const item = fixture();
      item.destination.append(item.video);
      if (state === 'unprepared') {
        item.player.mediaPrepared = false;
      }
      if (state === 'site-handback') {
        window.VSC.IOSPlayer.siteRelinquished.add(item.video);
      }
      if (state === 'unavailable-inline') {
        item.player.inlineUnavailable = true;
      }
      if (state === 'disposed-player') {
        item.player.disposed = true;
      }
      expect(item.repair()).toBe(true);
      expect(item.acquire).not.toHaveBeenCalled();
      expect(item.destination.hasAttribute(marker)).toBe(false);
    }
  );

  it('releases ambiguous chrome through child-list reconciliation without moving the original', () => {
    const item = fixture();
    item.controller.repairDOMPlacement = item.repair;
    const observer = new window.VSC.VideoMutationObserver({ settings: {} }, vi.fn(), vi.fn());
    const second = document.createElement('video');
    item.original.append(second);
    observer.reconcileController({ controller: item.controller });
    expect(item.refresh).toHaveBeenCalledOnce();
    expect(item.original.hasAttribute(marker)).toBe(false);
    expect(getComputedStyle(item.originalChrome).display).not.toBe('none');
    expect(item.controller.insertIntoDOM).not.toHaveBeenCalled();
    second.remove();
    observer.reconcileController({ controller: item.controller });
    expect(item.original.getAttribute(marker)).toBe(item.player.siteControls.token);
    expect(getComputedStyle(item.originalChrome).display).toBe('none');
    expect(item.video.getBoundingClientRect).not.toHaveBeenCalled();
    observer.stop();
  });

  it('acquires late recognized chrome through the existing known-media visibility recheck', () => {
    const item = fixture();
    item.original.className = '';
    item.player.refreshSiteControls();
    expect(item.player.siteControls.container).toBeNull();
    item.refresh.mockClear();
    item.controller.repairDOMPlacement = item.repair;
    item.controller.updateVisibility = vi.fn();
    const observer = new window.VSC.VideoMutationObserver({ settings: {} }, vi.fn(), vi.fn(), {
      isValidMediaElement: () => true,
    });
    item.original.className = 'html5-video-player';
    observer.recheckVideoElement(item.video);
    expect(item.refresh).toHaveBeenCalledOnce();
    expect(item.original.getAttribute(marker)).toBe(item.player.siteControls.token);
    expect(getComputedStyle(item.originalChrome).display).toBe('none');
    expect(item.controller.insertIntoDOM).not.toHaveBeenCalled();
    expect(item.controller.updateVisibility).toHaveBeenCalledOnce();
    expect(item.video.getBoundingClientRect).not.toHaveBeenCalled();
    observer.stop();
  });

  it('continues a real placement repair when a site replaces the old container contains API', () => {
    const item = fixture();
    item.destination.append(item.video);
    item.original.contains = () => {
      throw new Error('site replaced contains');
    };
    expect(() => item.repair()).not.toThrow();
    expect(item.controller.positionControls).toHaveBeenCalledOnce();
    expectTransferred(item);
  });
});
