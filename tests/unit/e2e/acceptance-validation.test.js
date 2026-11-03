import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ACCEPTANCE_CASES } from '../../safari-ios/acceptance-cases.js';
import { acceptanceDigest, validateAcceptanceRun } from '../../e2e/acceptance-validation.js';
import { loadAcceptanceArtifact } from '../../../scripts/validate-acceptance.mjs';

const sha = 'a'.repeat(64);
function example(requirements = {}) {
  const cases = [
    {
      id: 'original-feed',
      description: 'Original feed case',
      requirements: {
        platform: 'physical-iphone-safari',
        environment: 'live-site',
        navigation: 'feed-scroll',
        sourceIdentity: 'post1',
        requestedRate: null,
        minimumDurationMs: 20000,
        minimumWraps: 0,
        presentation: 'inline',
        audioEvidence: 'not-required',
        requiredDistinctAssets: 1,
        startupAndTransitions: true,
        ...requirements,
      },
    },
  ];
  const raw = {
    kind: 'live-observation',
    recorder: 'device-owner',
    capturedAt: '2026-11-03T00:00:00Z',
    revision: 'revision1',
    ...cases[0].requirements,
    assets: ['asset1'],
    resourceManifest: { 'inject.js': sha },
    trustedInput: { arrived: true, targetIdentity: 'post1' },
  };
  const review = {
    kind: 'independent-review',
    reviewer: 'reviewer',
    caseId: cases[0].id,
    evidenceDigest: sha,
    verdict: 'accepted',
    reason: 'Inspected exact raw observations and interactions',
  };
  const run = {
    scopeDigest: acceptanceDigest(cases),
    revision: 'revision1',
    owner: 'coordinator',
    caseResults: [
      {
        caseId: cases[0].id,
        evidence: { path: 'raw.json', sha256: sha },
        review: { path: 'review.json', sha256: 'b'.repeat(64) },
      },
    ],
  };
  const check = () =>
    validateAcceptanceRun(
      cases,
      run,
      (ref) => ({ 'raw.json': raw, 'review.json': review })[ref.path]
    );
  return { cases, raw, review, run, check };
}
describe('acceptance scope and provenance', () => {
  it('accepts independently reviewed exact scope and retains the measured revision', () => {
    const { check } = example();
    expect(check()).toMatchObject({
      behaviorAcceptance: 'accepted',
      cases: [{ measuredRevision: 'revision1' }],
    });
  });
  it.each([
    ['navigation', 'direct-post'],
    ['platform', 'chromium'],
    ['platform', 'ios-simulator-safari'],
    ['environment', 'controlled-fixture'],
    ['presentation', 'owned'],
  ])('cannot replace required %s with %s', (field, value) => {
    const { raw, check } = example();
    raw[field] = value;
    expect(check().behaviorAcceptance).toBe('incomplete');
  });
  it('retains removed and weakened cases in a partial-delivery report', () => {
    const { run, cases, check } = example();
    run.proposedCases = [];
    run.caseResults = [];
    run.delivery = { uploaded: { at: '2026-11-03T02:20:03Z', version: '0.11.6 (38)' } };
    run.issueClosed = true;
    expect(check()).toMatchObject({
      state: 'partial-delivery',
      behaviorAcceptance: 'incomplete',
      cases: [{ id: cases[0].id, requirements: cases[0].requirements }],
      scopeChanges: [{ caseId: cases[0].id, proposed: null }],
    });
    run.proposedCases = [
      { ...cases[0], requirements: { ...cases[0].requirements, minimumDurationMs: 6000 } },
    ];
    expect(check().scopeChanges).toHaveLength(1);
    expect(check().failures.join(' ')).toContain('cannot close');
  });
  it('does not promote enabled audio flags into audible continuity', () => {
    const { raw, check } = example({ audioEvidence: 'audible-smooth' });
    raw.audio = { muted: false, volume: 1, enabled: true, audible: true, smooth: true };
    expect(check().cases[0].errors.join(' ')).toContain('flags do not prove');
  });
  it('does not let a six-second passed summary satisfy a twenty-second live case', () => {
    const { raw, check } = example({ requestedRate: 4 });
    const observations = [0, 3000, 6000].map((elapsedMs) => ({
      elapsedMs,
      nativeTime: elapsedMs / 250,
      uiTime: elapsedMs / 250,
      sourceIdentity: 'post1',
      sourceEpoch: 0,
      seekEpoch: 0,
      targetEpoch: 0,
      seeking: false,
      mediaTime: elapsedMs / 250,
      presentedFrames: elapsedMs / 10,
    }));
    raw.requestedRate = 4;
    raw.measurement = {
      protocol: 'live-case',
      passed: true,
      pageErrors: [],
      results: [
        {
          requested: 4,
          observation: {
            finished: true,
            reason: 'window-complete',
            truncated: false,
            elapsedMs: 6000,
            observations,
            frames: observations,
          },
        },
      ],
    };
    expect(check().behaviorAcceptance).toBe('incomplete');
    expect(check().cases[0].errors.join(' ')).toContain('incomplete window');
  });
  it('rejects self-authored passed summaries and missing trusted input', () => {
    const { raw, review, check } = example();
    raw.passed = true;
    raw.trustedInput.arrived = false;
    review.reviewer = raw.recorder;
    expect(check().cases[0].errors.join(' ')).toContain('harness failure');
    expect(check().cases[0].errors.join(' ')).toContain('Independent review');
  });
  it('requires a reviewed source substitution', () => {
    const { raw, review, check } = example();
    raw.sourceIdentity = 'replacement-post';
    raw.trustedInput.targetIdentity = raw.sourceIdentity;
    expect(check().behaviorAcceptance).toBe('incomplete');
    review.sourceSubstitution = {
      original: 'post1',
      observed: 'replacement-post',
      reason: 'Authorized equivalent scenario with raw source binding',
    };
    expect(check().behaviorAcceptance).toBe('accepted');
  });
  it('rejects relabeled older measurements and unverified equivalence summaries', () => {
    const { raw, review, check } = example();
    raw.revision = 'older';
    expect(check().behaviorAcceptance).toBe('incomplete');
    const manifests = { measured: { 'inject.js': sha }, target: { 'inject.js': sha } };
    raw.revisionEquivalence = {
      from: 'older',
      to: 'revision1',
      sourceManifest: manifests,
      resourceManifest: manifests,
      verification: { path: 'review.json', sha256: 'b'.repeat(64) },
    };
    review.equivalenceEvidence = 'b'.repeat(64);
    expect(check().cases[0].errors.join(' ')).toContain(
      'source/resource equivalence is unavailable'
    );
  });
  it('reports every original case even for malformed results', () => {
    const report = validateAcceptanceRun(ACCEPTANCE_CASES, null, () => {
      throw new Error('unavailable');
    });
    expect(report.cases).toHaveLength(ACCEPTANCE_CASES.length);
    expect(new Set(report.cases.map((item) => item.id)).size).toBe(report.cases.length);
    expect(report.behaviorAcceptance).toBe('incomplete');
  });
  it('retains original rows when result or raw asset lists are malformed', () => {
    const { run, raw, check } = example({ requestedRate: 4 });
    run.caseResults.push(null);
    run.proposedCases = [null];
    raw.assetMeasurements = {};
    expect(check().cases).toHaveLength(1);
    expect(check().cases[0].state).toBe('incomplete');
  });
  it('keeps the original physical/audio/feed requirements anchored to source records', () => {
    expect(
      ACCEPTANCE_CASES.find((item) => item.id === 'SF-TW-1-saved-feed').requirements
    ).toMatchObject({
      navigation: 'feed-scroll',
      requiredDistinctAssets: 5,
      minimumDurationMs: 20000,
    });
    expect(ACCEPTANCE_CASES.filter((item) => item.id.includes('-long-'))).toHaveLength(16);
    expect(
      ACCEPTANCE_CASES.filter((item) => item.id.includes('-loop-')).every(
        (item) => item.requirements.minimumWraps === 5
      )
    ).toBe(true);
  });
  it('checks actual artifact bytes instead of trusting verified fields', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'stayfast-acceptance-'));
    try {
      const file = path.join(directory, 'raw.json');
      writeFileSync(file, JSON.stringify({ passed: true, verified: true }));
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(loadAcceptanceArtifact({ path: file, sha256: hash })).toHaveProperty('passed', true);
      writeFileSync(file, '{}');
      expect(() => loadAcceptanceArtifact({ path: file, sha256: hash })).toThrow('hash mismatch');
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
