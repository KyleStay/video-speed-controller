import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { installNativeProbe } from '../../e2e/media-native-probe.js';

const instances = [];
function probe(query = 'native-qa&case=loop-feed', setup = () => {}) {
  const dom = new JSDOM(
    '<body style="padding-top:3px"><main><video id="clip"><track></video></main>',
    {
      url: `http://127.0.0.1:62001/media-mocks.html?${query}`,
    }
  );
  const { window } = dom;
  window.__mediaMockState = () => ({ asset: 1, resets: 0, pendingReset: false, errors: [] });
  setup(window);
  const dispose = installNativeProbe(window.document);
  instances.push({ dom, dispose });
  const read = () => window.document.querySelector('button').click();
  const state = () =>
    JSON.parse(
      window.document
        .querySelector('#native-profile-state')
        .textContent.slice('Profile state: '.length)
    );
  return { window, document: window.document, read, state, dispose };
}
afterEach(() =>
  instances.splice(0).forEach(({ dom, dispose }) => {
    dispose();
    dom.window.close();
  })
);

it('is opt-in and leaves ordinary fixture documents untouched', () => {
  const f = probe('case=loop-feed');
  expect(f.document.querySelector('#native-profile-probe')).toBeNull();
  expect(f.document.body.style.paddingTop).toBe('3px');
});
it('reads native media without driving playback, timing, rates or extension commands', () => {
  const setters = [];
  const f = probe(undefined, (window) => {
    const clip = window.document.querySelector('video');
    for (const [name, value] of Object.entries({
      currentTime: 2,
      playbackRate: 1.5,
      duration: 6,
      paused: false,
      readyState: 4,
    })) {
      Object.defineProperty(clip, name, {
        get: () => value,
        set: () => {
          setters.push(name);
        },
      });
    }
    clip.play = vi.fn();
    clip.pause = vi.fn();
    clip.getVideoPlaybackQuality = () => ({ totalVideoFrames: 42 });
  });
  f.read();
  expect(f.state().media[0]).toMatchObject({
    time: 2,
    rate: 1.5,
    duration: 6,
    frames: 42,
    paused: false,
  });
  expect(f.state().trusted).toBe(0);
  expect(setters).toEqual([]);
  expect(f.document.querySelector('video').play).not.toHaveBeenCalled();
  expect(f.window.VSC).toBeUndefined();
});
it('bounds native frame sampling and cancels callbacks on source changes, removal and disposal', () => {
  let serial = 0;
  const f = probe(undefined, (window) => {
    const clip = window.document.querySelector('video');
    clip.requestVideoFrameCallback = vi.fn(() => ++serial);
    clip.cancelVideoFrameCallback = vi.fn();
  });
  const clip = f.document.querySelector('video');
  f.read();
  f.read();
  expect(clip.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
  clip.src = '/other.mp4';
  f.read();
  expect(clip.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
  clip.remove();
  f.read();
  expect(clip.cancelVideoFrameCallback).toHaveBeenCalledWith(2);
  expect(f.state().retired).toEqual([{ key: 1, controlled: false }]);
  f.dispose();
  expect(f.document.body.style.paddingTop).toBe('3px');
});
it('observes rate changes without diagnostic clicks that could imply user speed intent', async () => {
  let rate = 1.5;
  const f = probe(undefined, (window) => {
    Object.defineProperty(window.document.querySelector('video'), 'playbackRate', {
      get: () => rate,
      set: () => {
        throw new Error('Probe must not write media');
      },
    });
  });
  const button = f.document.querySelector('button');
  const click = vi.spyOn(button, 'click');
  const before = f.state().sequence;
  rate = 1;
  f.document.querySelector('video').dispatchEvent(new f.window.Event('ratechange'));
  await new Promise((done) => f.window.queueMicrotask(done));
  expect(f.state().sequence).toBe(before + 1);
  expect(f.state().media[0].rate).toBe(1);
  expect(f.state().trusted).toBe(0);
  expect(click).not.toHaveBeenCalled();
});
it('discards a queued passive rate observation after probe disposal', async () => {
  const f = probe();
  const read = vi.spyOn(f.window, '__mediaMockState');
  f.document.querySelector('video').dispatchEvent(new f.window.Event('ratechange'));
  f.dispose();
  await new Promise((done) => f.window.queueMicrotask(done));
  expect(read).not.toHaveBeenCalled();
});
it('rejects stale, wrong-origin and wrong-window child telemetry', () => {
  const f = probe(undefined, (window) => {
    const frame = window.document.createElement('iframe');
    frame.src = 'http://127.0.0.1:62002/media-mocks.html?case=frame-player';
    window.document.querySelector('main').append(frame);
  });
  const frame = f.document.querySelector('iframe');
  f.read();
  const send = (origin, source, sequence) =>
    f.window.dispatchEvent(
      new f.window.MessageEvent('message', {
        origin,
        source,
        data: { type: 'local-profile-state', sequence, state: { errors: [] } },
      })
    );
  send('http://127.0.0.1:62003', frame.contentWindow, 1);
  send('http://127.0.0.1:62002', f.window, 1);
  send('http://127.0.0.1:62002', frame.contentWindow, 0);
  expect(f.state().pendingFrames).toBe(1);
  send('http://127.0.0.1:62002', frame.contentWindow, 1);
  expect(f.state().pendingFrames).toBe(0);
  f.read();
  expect(f.state().pendingFrames).toBe(1);
});
it('keeps stable owner/caption identity and reports unreleased retired ownership', () => {
  const f = probe();
  const clip = f.document.querySelector('video');
  const owner = f.document.createElement('div');
  owner.className = 'vsc-controller';
  f.document.querySelector('main').append(owner);
  clip.vsc = { div: owner };
  f.read();
  const initial = f.state().media[0];
  f.read();
  expect(f.state().media[0]).toMatchObject({
    key: initial.key,
    owner: initial.owner,
    track: initial.track,
    controlled: true,
  });
  clip.remove();
  f.read();
  expect(f.state().retired).toEqual([{ key: initial.key, controlled: true }]);
  delete clip.vsc;
  f.read();
  expect(f.state().retired[0].controlled).toBe(false);
});
it('reports the actual local source URL without adding navigation or command controls', () => {
  const f = probe();
  expect(f.state().url).toBe(f.window.location.href);
  expect(f.state().anchor).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  expect([...f.document.querySelectorAll('button')].map((node) => node.textContent)).toEqual([
    'Read profile state',
  ]);
  expect(f.document.querySelector('input,select')).toBeNull();
});
