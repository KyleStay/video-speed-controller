import { bridgeEvents } from '../../../src/utils/bridge-events.js';

describe('video diagnostic lifecycle and commands', () => {
  let extension;
  let savedRecorder;
  let savedAuto;

  beforeEach(() => {
    extension = window.VSC_controller;
    savedRecorder = extension.videoDiagnostics;
    savedAuto = extension.diagnosticsAutoStarted;
    extension.videoDiagnostics = null;
    extension.diagnosticsAutoStarted = false;
  });

  afterEach(() => {
    extension.videoDiagnostics?.cleanup();
    extension.videoDiagnostics = savedRecorder;
    extension.diagnosticsAutoStarted = savedAuto;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function command(action) {
    let response;
    const onResult = (event) => {
      if (event.detail.requestId === 'diagnostic-test') {
        response = event.detail;
      }
    };
    bridgeEvents.addEventListener('VSC_MESSAGE_RESULT', onResult);
    try {
      bridgeEvents.dispatchEvent(
        new CustomEvent('VSC_MESSAGE', {
          detail: {
            type: 'VSC_VIDEO_DIAGNOSTICS',
            payload: { action },
            requestId: 'diagnostic-test',
          },
        })
      );
    } finally {
      bridgeEvents.removeEventListener('VSC_MESSAGE_RESULT', onResult);
    }
    return response;
  }

  it('returns bounded reports even in a media-less parent without changing storage', () => {
    const storage = vi.spyOn(chrome.storage.sync, 'set');
    const start = command('start');
    expect(start.ok).toBe(true);
    expect(start.diagnostics).toMatchObject({ schema: 1, active: true });
    expect(start.diagnostics.events.length).toBeGreaterThan(0);
    const report = command('stop');
    expect(report.diagnostics.active).toBe(false);
    expect(command('report').diagnostics.events).toEqual(report.diagnostics.events);
    expect(storage).not.toHaveBeenCalled();
    expect(command('clear').diagnostics.events).toEqual([]);
  });

  it('rejects unknown actions before allocating a recorder', () => {
    expect(command('arbitrary')).toMatchObject({ ok: false });
    expect(extension.videoDiagnostics).toBeNull();
  });

  it('does not automatically capture in ordinary builds', () => {
    vi.stubGlobal('__VSC_DIAGNOSTICS__', false);
    extension.startAutomaticVideoDiagnostics();
    expect(extension.videoDiagnostics).toBeNull();
  });

  it('automatically starts only once on a diagnostic-build Twitter page', () => {
    vi.stubGlobal('__VSC_DIAGNOSTICS__', true);
    const host = vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(false);
    extension.startAutomaticVideoDiagnostics();
    expect(extension.videoDiagnostics).toBeNull();
    host.mockReturnValue(true);
    extension.startAutomaticVideoDiagnostics();
    const recorder = extension.videoDiagnostics;
    expect(recorder.snapshot()).toMatchObject({ active: true, reason: 'diagnostic-build' });
    recorder.stop();
    extension.startAutomaticVideoDiagnostics();
    expect(recorder.snapshot().active).toBe(false);
  });

  it('cleans diagnostic resources before an otherwise inactive teardown returns', () => {
    extension.handleVideoDiagnostics('start');
    const recorder = extension.videoDiagnostics;
    const cleanup = vi.spyOn(recorder, 'cleanup');
    // The normal extension state is not changed by the diagnostic command.
    const flags = [
      'initialized',
      'eventListenersInitialized',
      'eventManager',
      'initializationInProgress',
    ];
    const saved = flags.map((key) => extension[key]);
    flags.forEach((key) => {
      extension[key] = false;
    });
    try {
      extension.teardown();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(extension.handleVideoDiagnostics('report')).toMatchObject({ active: false });
      expect(recorder.snapshot().events.length).toBeGreaterThan(0);
    } finally {
      flags.forEach((key, index) => {
        extension[key] = saved[index];
      });
    }
  });

  it('contains diagnostic startup failures so media initialization can continue', () => {
    vi.stubGlobal('__VSC_DIAGNOSTICS__', true);
    vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(true);
    vi.spyOn(extension, 'ensureVideoDiagnostics').mockImplementation(() => {
      throw new Error('page getter');
    });
    expect(() => extension.startAutomaticVideoDiagnostics()).not.toThrow();
    expect(command('report')).toMatchObject({ ok: false });
  });
});
