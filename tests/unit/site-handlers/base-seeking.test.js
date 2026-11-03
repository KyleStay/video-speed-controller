import { describe, expect, it, vi } from 'vitest';

const ranges = (start, end) => ({ length: 1, start: () => start, end: () => end });
const seek = (video, delta) => new window.VSC.BaseSiteHandler().handleSeek(video, delta);

describe('generic native seek boundaries', () => {
  it('retains the full finite recording timeline even when only part is buffered', () => {
    const video = { currentTime: 30, duration: 120, seekable: ranges(20, 40) };
    seek(video, 80);
    expect(video.currentTime).toBe(110);
    seek(video, 50);
    expect(video.currentTime).toBe(120);
    seek(video, -500);
    expect(video.currentTime).toBe(0);
  });
  it.each([Infinity, NaN])(
    'clamps an unbounded timeline to the current native seek window: %s',
    (duration) => {
      const video = { currentTime: 110, duration, seekable: ranges(100, 130) };
      seek(video, -30);
      expect(video.currentTime).toBe(100);
      video.seekable = ranges(125, 155);
      seek(video, -10);
      expect(video.currentTime).toBe(125);
      seek(video, 100);
      expect(video.currentTime).toBe(155);
    }
  );
  it('does not invent seek positions before native timing or a usable live range is available', () => {
    for (const video of [
      { currentTime: NaN, duration: 100 },
      { currentTime: 12, duration: Infinity, seekable: { length: 0 } },
      { currentTime: 12, duration: NaN, seekable: ranges(20, 20) },
      { currentTime: 12, duration: Infinity, seekable: ranges(NaN, 30) },
    ]) {
      const original = video.currentTime;
      seek(video, -30);
      expect(video.currentTime).toBe(original);
    }
  });
  it.each([NaN, Infinity, -Infinity])('ignores an invalid relative seek: %s', (delta) => {
    const video = { currentTime: 30, duration: 100 };
    seek(video, delta);
    expect(video.currentTime).toBe(30);
  });
  it('contains timing getter and setter failures from a changing page-owned player', () => {
    const getter = {
      get currentTime() {
        throw new Error('Source changed');
      },
    };
    expect(() => seek(getter, 10)).not.toThrow();
    const setter = {
      duration: 100,
      get currentTime() {
        return 30;
      },
      set currentTime(_value) {
        throw new Error('Not ready');
      },
    };
    expect(() => seek(setter, 10)).not.toThrow();
  });
  it('uses only the newest complete range on a discontinuous live timeline', () => {
    const start = vi.fn((i) => [10, 50][i]),
      end = vi.fn((i) => [20, 70][i]);
    const video = { currentTime: 60, duration: Infinity, seekable: { length: 2, start, end } };
    seek(video, -100);
    expect(video.currentTime).toBe(50);
    expect(start).toHaveBeenCalledWith(1);
    expect(end).toHaveBeenCalledWith(1);
  });
});
