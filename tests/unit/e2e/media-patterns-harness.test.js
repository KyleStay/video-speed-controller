import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ start: vi.fn(), write: vi.fn(), mkdir: vi.fn() }));
vi.mock('../../e2e/fixture-server.js', () => ({ startFixtureServer: mocks.start }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  mkdir: mocks.mkdir,
  writeFile: mocks.write,
}));
import runMediaPatterns from '../../e2e/media-patterns.e2e.js';

beforeEach(() => {
  mocks.start.mockReset();
  mocks.write.mockReset().mockResolvedValue();
  mocks.mkdir.mockReset().mockResolvedValue();
});
const server = (port) => ({
  baseUrl: `http://127.0.0.1:${port}`,
  stop: vi.fn().mockResolvedValue(),
});
const report = () => JSON.parse(mocks.write.mock.calls.at(-1)[1]);

describe('local media harness failure ownership', () => {
  it('stops an already started server if the second server cannot start', async () => {
    const first = server(61001);
    mocks.start.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('port unavailable'));
    const launch = vi.fn();
    await expect(runMediaPatterns({ launch })).rejects.toThrow('port unavailable');
    expect(first.stop).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
    expect(report()).toMatchObject({ status: 'failed', rows: [], cleanupErrors: [] });
  });

  it('stops both servers and retains an unavailable browser as failed with zero passed cases', async () => {
    const first = server(61001),
      second = server(61002);
    mocks.start.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await expect(
      runMediaPatterns({ launch: vi.fn().mockRejectedValue(new Error('browser unavailable')) })
    ).rejects.toThrow('browser unavailable');
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(report()).toMatchObject({
      status: 'failed',
      rows: [],
      externalRequests: [],
      cleanupErrors: [],
    });
    expect(report().error).toContain('browser unavailable');
  });

  it('attempts both server cleanups even if browser close and one server cleanup fail', async () => {
    const first = server(61001),
      second = server(61002);
    first.stop.mockRejectedValue(new Error('server close failed'));
    mocks.start.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const browser = { close: vi.fn().mockRejectedValue(new Error('browser close failed')) };
    const page = {
      on: vi.fn(),
      off: vi.fn(),
      setRequestInterception: vi.fn().mockRejectedValue(new Error('interception unavailable')),
    };
    let error;
    try {
      await runMediaPatterns({ launch: vi.fn().mockResolvedValue({ browser, page }) });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((item) => item.message)).toEqual([
      'interception unavailable',
      'browser close failed',
      'server close failed',
    ]);
    expect(second.stop).toHaveBeenCalledOnce();
    expect(report()).toMatchObject({
      status: 'failed',
      cleanupErrors: ['browser close failed', 'server close failed'],
    });
  });
});
