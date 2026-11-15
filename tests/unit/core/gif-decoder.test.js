import { describe, expect, it } from 'vitest';
import { gifFixture } from '../../helpers/gif-fixture.js';

describe('bounded GIF framing', () => {
  const parse = (bytes) => window.VSC.GifDecoder.parse(bytes);
  it('distinguishes animated GIFs from a still GIF and keeps variable frame timing', () => {
    const gif = parse(gifFixture());
    expect(gif.frames).toHaveLength(2);
    expect(gif.duration).toBe(0.5);
    expect(gif.frames.map(({ start, end }) => [start, end])).toEqual([
      [0, 0.2],
      [0.2, 0.5],
    ]);
    expect(parse(gifFixture({ frames: [{ color: 1, delay: 20 }] })).frames).toHaveLength(1);
  });
  it.each([null, 0, 2])('retains finite/infinite loop intent: %s', (loop) => {
    expect(parse(gifFixture({ loop })).repetitions).toBe(loop);
  });
  it('uses the browser minimum delay and retains transparency/disposal/patch bounds', () => {
    const gif = parse(
      gifFixture({
        frames: [
          { color: 1, delay: 0 },
          { color: 2, delay: 1, disposal: 3, transparent: true, left: 2, width: 2 },
        ],
      })
    );
    expect(gif.duration).toBe(0.2);
    expect(gif.frames[1]).toMatchObject({ left: 2, width: 2, disposal: 3, transparent: true });
    const patch = parse(new Uint8Array(gif.frames[1].parts.flatMap((part) => [...part])));
    expect(patch).toMatchObject({ width: 2, height: 4 });
    expect(patch.frames[0]).toMatchObject({ left: 0, top: 0, transparent: true });
  });
  it('counts image descriptors rather than GIF-looking bytes inside comments', () => {
    const bytes = gifFixture({ frames: [{ color: 1, delay: 20 }] });
    const comment = [0x21, 0xfe, 4, 0x2c, 0x21, 0xf9, 0x2c, 0];
    expect(
      parse(new Uint8Array([...bytes.subarray(0, 25), ...comment, ...bytes.subarray(25)])).frames
    ).toHaveLength(1);
  });
  it('rejects every truncated prefix and invalid signatures', () => {
    const bytes = gifFixture();
    for (let length = 0; length < bytes.length; length++) {
      expect(() => parse(bytes.subarray(0, length))).toThrow();
    }
    expect(() => parse(new Uint8Array(13))).toThrow('Not a GIF');
  });
  it('rejects invalid dimensions, out-of-bounds patches and frame/memory bombs', () => {
    const bytes = gifFixture();
    bytes[6] = bytes[8] = 255;
    bytes[7] = bytes[9] = 255;
    expect(() => parse(bytes)).toThrow('dimensions');
    expect(() =>
      parse(gifFixture({ frames: [{ color: 1, delay: 20, left: 3, width: 2 }] }))
    ).toThrow('bounds');
    expect(() =>
      parse(gifFixture({ frames: Array.from({ length: 241 }, () => ({ color: 1, delay: 20 })) }))
    ).toThrow('memory');
    expect(() => parse(new Uint8Array(window.VSC.GifDecoder.limits.bytes + 1))).toThrow('large');
  });
  it('rejects interactive GIF controls and plain-text rendering', () => {
    const bytes = gifFixture();
    const index = bytes.indexOf(0xf9);
    bytes[index + 2] = 2;
    expect(() => parse(bytes)).toThrow('control');
    bytes[index] = 1;
    expect(() => parse(bytes)).toThrow('extension');
  });
  it('bounds streamed responses before full buffering and cancels oversized bodies', async () => {
    const limits = window.VSC.GifDecoder.limits;
    const response = new Response(new Uint8Array(limits.bytes + 1));
    await expect(
      window.VSC.GifDecoder.read(response, new AbortController().signal)
    ).rejects.toThrow('limit');
    const declared = new Response(new Uint8Array(1), {
      headers: { 'content-length': String(limits.bytes + 1) },
    });
    await expect(
      window.VSC.GifDecoder.read(declared, new AbortController().signal)
    ).rejects.toThrow('large');
  });
  it('aborts a stuck decoder and closes a bitmap that finishes after cancellation', async () => {
    let resolve;
    const controller = new AbortController();
    let closed = false;
    const pending = window.VSC.GifDecoder.wait(
      new Promise((done) => {
        resolve = done;
      }),
      controller.signal,
      () => {
        closed = true;
      }
    );
    controller.abort(new Error('Deadline'));
    await expect(pending).rejects.toThrow('Deadline');
    resolve({});
    await Promise.resolve();
    expect(closed).toBe(true);
  });
});
