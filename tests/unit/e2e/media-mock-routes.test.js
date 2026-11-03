import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('node:http', () => ({ createServer: http.create }));
import { startFixtureServer } from '../../e2e/fixture-server.js';

let handler, fixture;
const server = {
  once: vi.fn(),
  listen: vi.fn((port, host, ready) => ready()),
  address: () => ({ port: 62001 }),
  close: vi.fn((done) => done()),
};
beforeEach(async () => {
  http.create.mockImplementation((callback) => {
    handler = callback;
    return server;
  });
  fixture = await startFixtureServer();
});
afterEach(async () => {
  await fixture?.stop();
});
function request(url, headers = {}) {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  handler({ url, headers }, response);
  return {
    status: response.writeHead.mock.calls[0][0],
    headers: response.writeHead.mock.calls[0][1],
    body: response.end.mock.calls[0][0],
  };
}
describe('local mock resource boundaries', () => {
  it('binds only loopback and serves the module/CSP wrapper with their correct types', () => {
    expect(server.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
    const page = request('/media-mocks.html?case=loop-feed');
    expect(page.status).toBe(200);
    expect(page.body).toContain("connect-src 'self'");
    for (const path of [
      '/media-mock-entry.js',
      '/media-mock-fixture.js',
      '/media-profile-fixture.js',
    ]) {
      const result = request(path);
      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toContain('application/javascript');
      expect(result.body.length).toBeGreaterThan(0);
    }
  });
  it('serves an actual finite HLS manifest with local init and segment bytes', () => {
    const manifest = request('/mock-media/playlist.m3u8');
    expect(manifest.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
    const text = manifest.body.toString();
    expect(text).toContain('#EXT-X-ENDLIST');
    const names = [...text.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]);
    names.push(...text.split('\n').filter((line) => line && !line.startsWith('#')));
    expect(names).toHaveLength(4);
    for (const name of names) {
      expect(name).toMatch(/^(?:init\.mp4|segment-\d{2}\.m4s)$/);
      const resource = request(`/mock-media/${name}`);
      expect(resource.status).toBe(200);
      expect(resource.body.length).toBeGreaterThan(32);
    }
    expect(request('/mock-media/init.mp4').body.toString('ascii', 4, 8)).toBe('ftyp');
  });
  it('serves local media/GIF/caption variants and keeps the unavailable route a real404', () => {
    for (const path of [
      '/mock-media/fallback.mp4?quality=high',
      '/mock-media/clip.webm',
      '/mock-animated.gif',
      '/mock-still.gif',
      '/mock-captions.vtt',
    ]) {
      expect(request(path).status).toBe(200);
    }
    expect(request('/mock-animated.gif').body.toString('ascii', 0, 6)).toBe('GIF89a');
    expect(request('/mock-animated.gif').body.length).toBeGreaterThan(
      request('/mock-still.gif').body.length
    );
    expect(request('/mock-media/unavailable.mp4').status).toBe(404);
    expect(request('/mock-media/../private.txt').status).toBe(404);
  });
  it('serves only the generated live init and twelve segment resources', () => {
    for (const file of [
      'init.mp4',
      ...Array.from({ length: 12 }, (_, i) => `segment-${String(i).padStart(2, '0')}.m4s`),
    ]) {
      const resource = request(`/mock-live/${file}`);
      expect(resource.status).toBe(200);
      expect(resource.headers['Content-Type']).toBe('video/mp4');
      expect(resource.body.length).toBeGreaterThan(32);
    }
    expect(request('/mock-live/segment-12.m4s').status).toBe(404);
    expect(request('/mock-live/../private.txt').status).toBe(404);
  });
  it('honors native media byte-range probes and rejects unsatisfiable ranges', () => {
    const full = request('/mock-media/fallback.mp4');
    const probe = request('/mock-media/fallback.mp4?asset=2', { range: 'bytes=0-1' });
    expect(probe.status).toBe(206);
    expect(probe.headers['Accept-Ranges']).toBe('bytes');
    expect(probe.headers['Content-Range']).toBe(`bytes 0-1/${full.body.length}`);
    expect(probe.headers['Content-Length']).toBe(2);
    expect(probe.body).toEqual(full.body.subarray(0, 2));
    expect(
      request('/mock-media/fallback.mp4', { range: `bytes=${full.body.length}-` }).status
    ).toBe(416);
  });
});
