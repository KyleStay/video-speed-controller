const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: (...args) => mocks.exec(...args) }),
  };
});
import { hasProfileArgument, profileRoots } from '../../e2e/browser-process-ownership.js';

const profile = '/tmp/stayfast-browser-qa-ABC';
const executable = '/owned/Chrome';
const row = { pid: 123, start: 'birth', command: `Chrome --user-data-dir=${profile}` };
const verified = (argv) => ({ status: 'verified', argv });
beforeEach(() => {
  mocks.exec.mockReset();
});

describe('actual browser argv boundaries', () => {
  it.each([
    [[executable, `--user-data-dir=${profile}`], true],
    [[executable, '--headless', `--user-data-dir=${profile}`, '--disable-gpu'], true],
    [[executable, '--user-data-dir', profile], false],
    [[executable, `--user-data-dir=${profile}-other`], false],
    [[executable, `--user-data-dir=${profile}/Default`], false],
    [[executable, `--user-data-dir=${profile.toLowerCase()}`], false],
    [[executable, `--message=--user-data-dir=${profile}`], false],
    [[executable, `--message=reviewing --user-data-dir=${profile} --headless`], false],
    [[executable, `reviewing --user-data-dir=${profile} --headless`], false],
    [[executable, `"--user-data-dir=${profile}"`], false],
    [[executable, `--user-data-dir="${profile}"`], false],
    [[executable, `--user-data-dir='${profile}'`], false],
    [[executable, `--user-data-dir=${profile} --headless`], false],
    [[executable, '--', `--user-data-dir=${profile}`], false],
    [[executable, `--user-data-dir=${profile}`, '--user-data-dir=/tmp/other'], false],
    [[executable, '--user-data-dir=/tmp/other', `--user-data-dir=${profile}`], false],
    [[executable, `--user-data-dir=${profile}`, `--user-data-dir=${profile}`], false],
    [[executable, `--user-data-dir=${profile}`, '--user-data-dir', '/tmp/other'], false],
    [[executable, '--user-data-dir'], false],
    [[executable, '--user-data-dir=/Users/fixture/Personal'], false],
    [[], false],
  ])('uses exact native entries: %j', (argv, expected) => {
    expect(hasProfileArgument(argv, profile)).toBe(expected);
  });

  it.each([
    `node audit --message="reviewing --user-data-dir=${profile} --headless"`,
    `node audit --message=reviewing --user-data-dir=${profile} --headless`,
    `node audit --message="reviewing -profile ${profile} --headless"`,
    `Chrome --user-data-dir=${profile}`,
    [executable, null],
    null,
    undefined,
  ])('rejects all flattened or malformed process text: %j', (text) => {
    expect(hasProfileArgument(text, profile, { firefox: true })).toBe(false);
  });

  it.each([
    [['Firefox', '-profile', profile], true],
    [['Firefox', `--user-data-dir=${profile}`], false, true],
    [['Firefox', `-profile=${profile}`], false],
    [['Firefox', '--profile', profile, '--headless'], true],
    [['Firefox', '-profile', `${profile}-other`], false],
    [['Firefox', `-profile ${profile}`], false],
    [['Firefox', `--message=reviewing -profile ${profile} --headless`], false],
    [['Firefox', '-profile', `"${profile}"`], false],
    [['Firefox', '--', '-profile', profile], false],
    [['Firefox', '-profile', profile, '--profile', '/tmp/other'], false],
  ])('requires Firefox flag and value boundaries: %j', (argv, expected, chromium = false) => {
    expect(hasProfileArgument(argv, profile, { firefox: true })).toBe(expected);
    expect(hasProfileArgument(argv, profile)).toBe(chromium);
  });

  it('preserves spaces, metacharacters and literal quotes in exact path values', () => {
    for (const path of ['/tmp/a b', '/tmp/[QA].run+1', '/tmp/literal"quote']) {
      expect(hasProfileArgument([executable, `--user-data-dir=${path}`], path)).toBe(true);
      expect(hasProfileArgument([executable, `--user-data-dir=${path}-other`], path)).toBe(false);
    }
    expect(hasProfileArgument([executable, '--user-data-dir='], '')).toBe(false);
  });
});

describe('native executable and argument verification', () => {
  it('does not admit any root from its displayed command alone', async () => {
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({ 123: { status: 'different-executable' } }),
    });
    expect(await profileRoots([row], profile, executable)).toEqual([]);
    expect(mocks.exec).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([executable, '123']),
      expect.objectContaining({ timeout: 5000 })
    );
  });
  it.each([
    [
      `node audit --message="reviewing --user-data-dir=${profile} --headless"`,
      ['node', 'audit', `--message=reviewing --user-data-dir=${profile} --headless`],
    ],
    [
      `node audit --message=reviewing --user-data-dir=${profile} --headless`,
      ['node', 'audit', `--message=reviewing --user-data-dir=${profile} --headless`],
    ],
    [
      `node audit --message="reviewing -profile ${profile} --headless"`,
      ['node', 'audit', `--message=reviewing -profile ${profile} --headless`],
    ],
  ])('rejects reviewer replay even with a verified executable: %s', async (command, argv) => {
    mocks.exec.mockResolvedValue({ stdout: JSON.stringify({ 123: verified(argv) }) });
    expect(
      await profileRoots([{ ...row, command }], profile, executable, { firefox: true })
    ).toEqual([]);
  });
  it('admits an exact argument only after native executable verification', async () => {
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({ 123: verified([executable, `--user-data-dir=${profile}`]) }),
    });
    expect(await profileRoots([row], profile, executable)).toEqual([row]);
  });
  it.each([undefined, { status: 'unavailable' }, verified([]), verified([null])])(
    'retains ambiguous profiles when native information is unavailable: %j',
    async (details) => {
      mocks.exec.mockResolvedValue({ stdout: JSON.stringify({ 123: details }) });
      await expect(profileRoots([row], profile, executable)).rejects.toThrow(/retained/);
    }
  );
  it('retains a profile when conflicting native flags include the owned path', async () => {
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        123: verified([executable, `--user-data-dir=${profile}`, '--user-data-dir=/tmp/other']),
      }),
    });
    await expect(profileRoots([row], profile, executable)).rejects.toThrow(/Ambiguous/);
  });
  it.each(['null', '[]', '42', 'not json'])(
    'retains the profile after malformed native envelope: %s',
    async (stdout) => {
      mocks.exec.mockResolvedValue({ stdout });
      await expect(profileRoots([row], profile, executable)).rejects.toThrow(/retained/);
    }
  );
  it('retains the profile after reader failure or timeout', async () => {
    mocks.exec.mockRejectedValue(new Error('fixture native read denied'));
    await expect(profileRoots([row], profile, executable)).rejects.toThrow(/retained/);
  });
  it('requires an expected executable for ambiguous candidates', async () => {
    await expect(profileRoots([row], profile, undefined)).rejects.toThrow(/identity unavailable/);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('avoids native inspection when no displayed candidate mentions the profile', async () => {
    expect(
      await profileRoots([{ ...row, command: 'personal browser' }], profile, undefined)
    ).toEqual([]);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
