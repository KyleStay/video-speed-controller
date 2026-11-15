import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ start: vi.fn(), write: vi.fn(), mkdir: vi.fn() }));
vi.mock('../../e2e/fixture-server.js', () => ({ startFixtureServer: mocks.start }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  mkdir: mocks.mkdir,
  writeFile: mocks.write,
}));
import runSiteMocks from '../../e2e/site-mocks.e2e.js';
import { MEDIA_MOCK_CASES } from '../../e2e/media-mock-fixture.js';
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.start.mockReset();
  mocks.write.mockReset().mockResolvedValue();
  mocks.mkdir.mockReset().mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
const server = (port) => ({
  baseUrl: `http://127.0.0.1:${port}`,
  stop: vi.fn().mockResolvedValue(),
});
const report = () => JSON.parse(mocks.write.mock.calls.at(-1)[1]);
describe('complete mock matrix ownership and reporting', () => {
  it('retains every profile as unrun when server setup is unavailable', async () => {
    mocks.start.mockRejectedValue(new Error('loopback unavailable'));
    const launch = vi.fn();
    await expect(runSiteMocks({ launch })).rejects.toThrow('loopback unavailable');
    expect(launch).not.toHaveBeenCalled();
    expect(report().status).toBe('incomplete');
    expect(report().cases.map(({ id, contract }) => ({ id, contract }))).toEqual(MEDIA_MOCK_CASES);
    for (const row of report().cases) {
      expect(Object.keys(row).sort()).toEqual(['checks', 'contract', 'id', 'reason', 'status']);
    }
    expect(
      report().cases.every(
        (row) =>
          row.status === 'unrun' && row.checks.length === 0 && row.reason === 'loopback unavailable'
      )
    ).toBe(true);
  });
  it('attempts both cleanups and retains cleanup failure alongside browser failure', async () => {
    const first = server(62001),
      second = server(62002);
    mocks.start.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    first.stop.mockRejectedValue(new Error('server cleanup failed'));
    await expect(
      runSiteMocks({ launch: vi.fn().mockRejectedValue(new Error('browser unavailable')) })
    ).rejects.toBeInstanceOf(AggregateError);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(report()).toMatchObject({ status: 'failed', cleanupErrors: ['server cleanup failed'] });
    expect(report().cases.every((row) => row.status === 'unrun')).toBe(true);
  });
  it.each([
    ['http://127.0.0.1:62001', true],
    ['http://127.0.0.1:62002', true],
    ['http://127.0.0.1:62003', false],
    ['https://example.invalid', false],
  ])('allows only an exact owned origin: %s', async (origin, allowed) => {
    const first = server(62001),
      second = server(62002);
    mocks.start.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const abort = vi.fn(),
      proceed = vi.fn();
    let receive;
    const page = {
      on: vi.fn((event, handler) => {
        if (event === 'request') {
          receive = handler;
        }
      }),
      off: vi.fn(),
      evaluate: vi.fn().mockResolvedValue(null),
      setDefaultTimeout: vi.fn(),
      setRequestInterception: vi.fn().mockResolvedValue(),
      screenshot: vi.fn().mockResolvedValue(),
      goto: vi.fn(async () => {
        receive({ url: () => `${origin}/synthetic-resource`, abort, continue: proceed });
        throw new Error('Synthetic case stop');
      }),
    };
    const browser = { close: vi.fn().mockResolvedValue() };
    const result = await runSiteMocks({ launch: vi.fn().mockResolvedValue({ browser, page }) });
    expect(result).toEqual({ passed: 0, failed: MEDIA_MOCK_CASES.length });
    expect(allowed ? proceed : abort).toHaveBeenCalledTimes(MEDIA_MOCK_CASES.length);
    expect(allowed ? abort : proceed).not.toHaveBeenCalled();
    expect(report().blockedRequests).toHaveLength(allowed ? 0 : MEDIA_MOCK_CASES.length);
    expect(report().cases.every((row) => row.status === 'failed')).toBe(true);
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
