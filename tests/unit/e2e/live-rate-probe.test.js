import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  collectPlaybackObservations,
  summarizePlaybackObservations,
  validateLiveRateProbeReport,
} from '../../e2e/rate-probe-validation.js';

import regressions from './fixtures/playback-accounting.json';
const row = (elapsedMs, nativeTime, extra = {}) => ({
  elapsedMs,
  nativeTime,
  uiTime: nativeTime,
  duration: 1000,
  sourceIdentity: 'same-asset',
  sourceEpoch: 0,
  seekEpoch: 0,
  targetEpoch: 0,
  seeking: false,
  paused: false,
  rate: 4,
  quality: { totalVideoFrames: elapsedMs / 10 },
  ...extra,
});
function observation(rate = 2.1, elapsedMs = 20000) {
  const observations = Array.from({ length: elapsedMs / 100 + 1 }, (_, index) =>
    row(index * 100, (index * rate) / 10, { rate })
  );
  return {
    finished: true,
    reason: 'window-complete',
    truncated: false,
    elapsedMs,
    inputs: [],
    inputCaptureComplete: true,
    observations,
    frames: observations.map((item, index) => ({
      ...item,
      mediaTime: item.nativeTime,
      presentedFrames: index * 3,
    })),
  };
}
const report = (rate = 2.1, raw = observation(rate)) => ({
  protocol: 'live-case',
  pageErrors: [],
  results: [{ requested: rate, observation: raw }],
});

describe('signed live playback accounting', () => {
  it('measures 2.1x and 4x from complete raw windows', () => {
    const live = {
      protocol: 'live-case',
      pageErrors: [],
      results: [2.1, 4].map((requested) => ({ requested, observation: observation(requested) })),
    };
    expect(validateLiveRateProbeReport(live).passed).toBe(true);
    expect(validateLiveRateProbeReport(report(), { rates: [2.1] }).passed).toBe(true);
    expect(validateLiveRateProbeReport(report(2), { rates: [2] }).passed).toBe(true);
  });

  it('requires terminal native readback to match the requested rate', () => {
    for (const rate of [4, NaN, null]) {
      const raw = observation(2.1);
      raw.observations.at(-1).rate = rate;
      expect(validateLiveRateProbeReport(report(2.1, raw), { rates: [2.1] }).passed).toBe(false);
    }
  });

  it('keeps six-second fixture samples and missing startup coverage incomplete', () => {
    expect(
      validateLiveRateProbeReport(report(4, observation(4, 6000)), { rates: [4] }).passed
    ).toBe(false);
    const raw = observation();
    raw.observations = raw.observations.slice(20);
    expect(summarizePlaybackObservations(raw).errors).toContain(
      'Missing initial or trailing native observation'
    );
  });

  it('does not clamp unexplained negative advancement', () => {
    const raw = observation();
    raw.observations = regressions.unexplainedBackstep.map((time, index) =>
      row(index * 1000, time)
    );
    const summary = summarizePlaybackObservations(raw);
    expect(summary.nativeAdvance).toBe(2);
    expect(summary.negativeAdvancement[0].delta).toBeCloseTo(-0.1);
    expect(summary.valid).toBe(false);
  });

  it('excludes source/seek/handoff displacement while charging the full wall window', () => {
    for (const epoch of ['sourceEpoch', 'seekEpoch', 'targetEpoch']) {
      const raw = observation();
      raw.observations = regressions.copiedHandoff.map((time, index) =>
        row(index * 1000, time, { [epoch]: index < 2 ? 0 : 1 })
      );
      const summary = summarizePlaybackObservations(raw);
      expect(summary.nativeAdvance).toBe(2);
      expect(summary.nativeRate).toBe(0.1);
      expect(summary.excludedDisplacements[0].nativeDelta).toBe(489);
    }
  });

  it('does not credit a seek write before its queued seeking event', () => {
    const raw = observation();
    raw.elapsedMs = 1000;
    raw.observations = [
      row(0, 0, { rate: 1 }),
      row(100, 10, { rate: 1 }),
      row(101, 10, { rate: 1, seekEpoch: 1, seeking: true }),
      row(110, 10, { rate: 1, seekEpoch: 1 }),
      row(1000, 10.89, { rate: 1, seekEpoch: 1 }),
    ];
    raw.frames = raw.observations.map((item, index) => ({
      ...item,
      mediaTime: item.nativeTime,
      presentedFrames: index,
    }));
    const summary = summarizePlaybackObservations(raw);
    expect(summary.valid).toBe(false);
    expect(summary.nativeSignedAdvance).toBeCloseTo(10.89);
    expect(summary.nativeAdvance).toBeCloseTo(0.89);
    expect(summary.frameAdvance).toBeCloseTo(0.89);
    expect(summary.positiveDisplacements[0].delta).toBe(10);
  });

  it('excludes the small paused Arrow seek and unlocalized pre-seeking interval', () => {
    const raw = observation();
    raw.elapsedMs = 1000;
    raw.observations = [
      row(0, 1, { paused: true }),
      row(100, 1.0509328, { paused: true }),
      row(101, 1.0509328, { seeking: true, seekEpoch: 1 }),
      row(110, 1.0509328, { seekEpoch: 1 }),
      row(1000, 1.9409328, { seekEpoch: 1 }),
    ];
    raw.events = [{ ...raw.observations[2], type: 'seeking', isTrusted: true }];
    raw.frames = raw.observations.map((item, index) => ({
      ...item,
      mediaTime: item.nativeTime,
      presentedFrames: index,
    }));
    const summary = summarizePlaybackObservations(raw);
    expect(summary.nativeSignedAdvance).toBeCloseTo(0.9409328);
    expect(summary.nativeAdvance).toBeCloseTo(0.89);
    expect(summary.frameAdvance).toBeCloseTo(0.89);
    expect(summary.seekUncertaintyWindows).toEqual([{ fromMs: 0, toMs: 101 }]);
    // The same queued assignment while playing remains uncredited.
    raw.observations.forEach((item) => {
      item.paused = false;
    });
    raw.frames.forEach((item) => {
      item.paused = false;
    });
    expect(summarizePlaybackObservations(raw).nativeAdvance).toBeCloseTo(0.89);
  });

  it('counts only certified natural native wraps and retains their raw signed displacement', () => {
    const raw = observation();
    raw.elapsedMs = 100;
    raw.observations = [
      row(0, 9.8, { nativeDuration: 10 }),
      row(100, 0.2, { nativeDuration: 10, seekEpoch: 1 }),
    ];
    raw.frames = raw.observations.map((item, index) => ({
      ...item,
      mediaTime: item.nativeTime,
      presentedFrames: index,
    }));
    raw.events = ['ended', 'seeking', 'seeked', 'playing'].map((type, index) => ({
      ...row(20 + index * 20, index === 0 ? 10 : 0, { nativeDuration: 10 }),
      type,
      isTrusted: true,
    }));
    expect(summarizePlaybackObservations(raw).actualWraps).toBe(0);
    const independentlyVerified = { inputCaptureComplete: true };
    const summary = summarizePlaybackObservations(raw, independentlyVerified);
    expect(summary.actualWraps).toBe(1);
    expect(summary.nativeSignedAdvance).toBeCloseTo(-9.6);
    expect(summary.nativeAdvance).toBeCloseTo(0.4);
    expect(summary.frameAdvance).toBeCloseTo(0.4);
    expect(summary.naturalWraps[0]).toMatchObject({ period: 10, rawDelta: expect.closeTo(-9.6) });
    // The collector samples each native event too; the negative seam precedes playing.
    raw.observations = [
      row(0, 9.8, { nativeDuration: 10 }),
      ...raw.events.map((event, index) => ({
        ...event,
        seekEpoch: index ? 1 : 0,
        seeking: index === 1,
      })),
      row(100, 0.2, { nativeDuration: 10, seekEpoch: 1 }),
    ];
    const withEventRows = summarizePlaybackObservations(raw, independentlyVerified);
    expect(withEventRows.actualWraps).toBe(1);
    expect(withEventRows.nativeAdvance).toBeCloseTo(0.4);
    raw.inputs = [{ elapsedMs: 50, type: 'click', isTrusted: true }];
    expect(summarizePlaybackObservations(raw, independentlyVerified).actualWraps).toBe(0);
    raw.inputs = [];
    raw.events[0].isTrusted = false;
    expect(summarizePlaybackObservations(raw, independentlyVerified).actualWraps).toBe(0);
  });

  it('keeps UI seams separate from continuous native playback and requires five observed wraps', () => {
    const raw = observation(4);
    raw.observations.forEach((item) => {
      item.uiTime = item.nativeTime % 10;
      item.duration = 10;
    });
    expect(summarizePlaybackObservations(raw)).toMatchObject({ nativeAdvance: 80, actualWraps: 8 });
    expect(
      validateLiveRateProbeReport(report(4, raw), { rates: [4], shortLoop: true }).passed
    ).toBe(true);
    raw.observations.forEach((item) => {
      item.uiTime = item.nativeTime % 30;
      item.duration = 30;
    });
    expect(
      validateLiveRateProbeReport(report(4, raw), { rates: [4], shortLoop: true, minimumWraps: 1 })
        .passed
    ).toBe(false);
  });

  it('requires advancing presented frames after the fifth observed wrap', () => {
    const raw = observation(4);
    raw.observations.forEach((item) => {
      item.uiTime = item.nativeTime % 16;
      item.duration = 16;
    });
    const summary = summarizePlaybackObservations(raw);
    expect(summary.actualWraps).toBe(5);
    expect(summary.postWrapFrameProgress[4]).toBe(false);
    expect(
      validateLiveRateProbeReport(report(4, raw), { rates: [4], shortLoop: true }).passed
    ).toBe(false);
  });

  it('does not turn frame counter resets into negative or huge decoded throughput', () => {
    const raw = observation();
    raw.observations[1].quality.totalVideoFrames = 999;
    const summary = summarizePlaybackObservations(raw);
    expect(summary.counterResets).toEqual([
      { key: 'totalVideoFrames', atMs: 200, before: 999, after: 20 },
    ]);
  });

  it('certifies a cached first callback only against an exact retained prior tail', () => {
    const data = regressions.cachedHead;
    const raw = observation();
    raw.frames = data.native.map((time, index) => ({
      ...row(index * 1000, time),
      mediaTime: data.pts[index],
      presentedFrames: data.presented[index],
    }));
    expect(summarizePlaybackObservations(raw).cachedHeadCertified).toBe(false);
    const verifiedPriorFrameTail = {
      artifact: 'prior-raw.json',
      sourceIdentity: 'same-asset',
      mediaTime: 2,
      presentedFrames: 20,
    };
    raw.priorFrameTail = verifiedPriorFrameTail;
    expect(summarizePlaybackObservations(raw).cachedHeadCertified).toBe(false);
    const summary = summarizePlaybackObservations(raw, { priorFrameTail: verifiedPriorFrameTail });
    expect(summary.cachedHeadCertified).toBe(true);
    expect(summary.rawFrameAdvance).toBeCloseTo(98.95);
    expect(summary.frameAdvance).toBeCloseTo(0.9);
    expect(summary.initialFrameGapMs).toBe(1000);
    expect(raw.frames).toHaveLength(3);
  });

  it('retains current frames that merely lag the native clock', () => {
    const data = regressions.currentLaggingHead;
    const raw = observation();
    raw.frames = data.native.map((time, index) => ({
      ...row(index * 1000, time),
      mediaTime: data.pts[index],
      presentedFrames: data.presented[index],
    }));
    const summary = summarizePlaybackObservations(raw);
    expect(summary.cachedHeadCertified).toBe(false);
    expect(summary.frameAdvance).toBe(2);
  });

  it('distinguishes callback holes with counter progress from no observed progress', () => {
    const raw = observation();
    raw.frames = [raw.frames[0], raw.frames[10], raw.frames.at(-1)];
    expect(summarizePlaybackObservations(raw).callbackGaps[0].classification).toBe(
      'counter-progress-during-callback-hole'
    );
    raw.observations.forEach((item) => {
      item.quality.totalVideoFrames = 0;
    });
    expect(summarizePlaybackObservations(raw).callbackGaps[0].classification).toBe(
      'no-observed-counter-progress'
    );
  });

  it('preserves initial/trailing gaps and never derives an acoustic verdict from flags', () => {
    const raw = observation();
    raw.frames = raw.frames.slice(3, -4);
    raw.audioEnabled = true;
    expect(summarizePlaybackObservations(raw)).toMatchObject({
      initialFrameGapMs: 300,
      trailingFrameGapMs: 400,
      audioEvidence: expect.stringContaining('Not measured'),
    });
  });

  it('fails missing/truncated windows and malformed clocks without accepting a passed summary', () => {
    for (const patch of [
      { truncated: true },
      { finished: false },
      { reason: 'cancelled' },
      { elapsedMs: NaN },
    ]) {
      const live = report(4, { ...observation(4), ...patch, passed: true });
      expect(validateLiveRateProbeReport(live, { rates: [4] }).passed).toBe(false);
    }
  });
});

describe('shared live collector', () => {
  it('is independently browser-injectable and reads prototype time separately from UI time', async () => {
    expect(() => new Script(`(${collectPlaybackObservations.toString()})`)).not.toThrow();
    const video = document.createElement('video');
    document.body.append(video);
    video.currentTime = 101;
    video.playbackRate = 2.1;
    Object.defineProperty(video, 'playbackRate', { configurable: true, get: () => 4 });
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1 });
    let clock = 0;
    const now = vi.spyOn(window.performance, 'now').mockImplementation(() => clock);
    const run = collectPlaybackObservations(video);
    expect(run.record.observations[0]).toMatchObject({ nativeTime: 101, uiTime: 1, rate: 2.1 });
    clock = 20000;
    run.stop('window-complete');
    expect(await run.result).toMatchObject({
      finished: true,
      reason: 'window-complete',
      elapsedMs: 20000,
    });
    expect(run.record.observations.at(-1).elapsedMs).toBe(20000);
    now.mockRestore();
    video.remove();
  });

  it('records copied handoff positions and cleans listeners on finish', async () => {
    const original = document.createElement('video');
    const companion = document.createElement('video');
    document.body.append(original, companion);
    original.currentTime = 10;
    companion.currentTime = 500;
    const run = collectPlaybackObservations(original);
    run.attach(companion);
    expect(run.record.handoffs[0]).toMatchObject({
      before: { nativeTime: 10, targetEpoch: 0 },
      after: { nativeTime: 500, targetEpoch: 1 },
    });
    run.stop();
    const count = run.record.events.length;
    companion.dispatchEvent(new Event('seeking'));
    expect(run.record.events).toHaveLength(count);
    expect((await run.result).reason).toBe('cancelled');
    original.remove();
    companion.remove();
  });
});
