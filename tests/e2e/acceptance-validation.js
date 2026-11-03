import { createHash } from 'node:crypto';
import { validateLiveRateProbeReport } from './rate-probe-validation.js';

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}
export function acceptanceDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

// loadArtifact verifies bytes outside this pure validator; input claims never verify themselves.
export function validateAcceptanceRun(originalCases, run, loadArtifact) {
  run = run && typeof run === 'object' ? run : {};
  const scopeDigest = acceptanceDigest(originalCases);
  const failures = [];
  if (run?.scopeDigest !== scopeDigest) {
    failures.push('Original acceptance scope digest mismatch');
  }
  if (!run?.revision || !run?.owner) {
    failures.push('Missing revision or accountable run owner');
  }
  const results = Array.isArray(run?.caseResults) ? run.caseResults : [];
  const originalIds = new Set(originalCases.map((item) => item.id));
  if (results.some((item) => !originalIds.has(item?.caseId))) {
    failures.push('Unknown result case ID');
  }
  const scopeChanges = [];
  if (Array.isArray(run.proposedCases)) {
    for (const item of originalCases) {
      const proposed = run.proposedCases.find((candidate) => candidate?.id === item.id);
      if (!proposed || acceptanceDigest(proposed) !== acceptanceDigest(item)) {
        scopeChanges.push({ caseId: item.id, original: item, proposed: proposed || null });
      }
    }
  }
  if (scopeChanges.length) {
    failures.push('Proposed scope changes retained; original requirements still apply');
  }
  const rows = originalCases.map((definition) => {
    const errors = [];
    const matches = results.filter((item) => item?.caseId === definition.id);
    const item = matches[0];
    const requirement = definition.requirements;
    if (matches.length !== 1) {
      errors.push('Missing or duplicate execution result');
    }
    let raw;
    let review;
    try {
      raw = item?.evidence && loadArtifact(item.evidence);
      review = item?.review && loadArtifact(item.review);
    } catch (error) {
      errors.push(`Evidence verification failed: ${error.message}`);
    }
    if (raw?.kind !== 'live-observation') {
      errors.push('Missing raw live observations');
    }
    if (raw) {
      try {
        for (const field of ['platform', 'environment', 'navigation', 'presentation']) {
          if (raw[field] !== requirement[field]) {
            errors.push(`Required ${field}: ${requirement[field]}`);
          }
        }
        if (!raw.recorder || !raw.capturedAt || !Number.isFinite(Date.parse(raw.capturedAt))) {
          errors.push('Missing recorder or observation timestamp');
        }
        if (
          !raw.sourceIdentity ||
          !raw.resourceManifest ||
          !Object.keys(raw.resourceManifest).length ||
          Object.values(raw.resourceManifest).some((value) => !/^[a-f0-9]{64}$/.test(value))
        ) {
          errors.push('Missing observed source identity or resource hashes');
        }
        if (raw.sourceIdentity !== requirement.sourceIdentity) {
          const substitution = review?.sourceSubstitution;
          if (
            substitution?.original !== requirement.sourceIdentity ||
            substitution?.observed !== raw.sourceIdentity ||
            !substitution?.reason
          ) {
            errors.push('Source substitution requires independent semantic review');
          }
        }
        if (raw.revision !== run.revision) {
          errors.push(
            'Older revision remains contextual evidence: verified complete source/resource equivalence is unavailable'
          );
        }
        if (requirement.startupAndTransitions && raw.startupAndTransitions !== true) {
          errors.push('Full startup and transition window required');
        }
        if (
          raw.trustedInput?.arrived !== true ||
          raw.trustedInput?.targetIdentity !== raw.sourceIdentity
        ) {
          errors.push('Missing expected trusted input: harness failure');
        }
        if (
          !Array.isArray(raw.assets) ||
          new Set(raw.assets).size < requirement.requiredDistinctAssets
        ) {
          errors.push('Insufficient distinct source assets');
        }
        if (requirement.requestedRate !== null) {
          if (raw.requestedRate !== requirement.requestedRate) {
            errors.push('Wrong requested rate');
          }
          const measured = validateLiveRateProbeReport(raw.measurement, {
            rates: [requirement.requestedRate],
            minimumDurationMs: requirement.minimumDurationMs,
            minimumWraps: requirement.minimumWraps,
          });
          if (!measured.passed) {
            errors.push(...measured.failures);
          }
          if (
            requirement.requiredDistinctAssets > 1 &&
            (raw.interveningSpeedInput !== false ||
              !Array.isArray(raw.assetMeasurements) ||
              new Set(raw.assetMeasurements.map((asset) => asset.sourceIdentity)).size !==
                raw.assets?.length ||
              raw.assetMeasurements.length !== raw.assets?.length)
          ) {
            errors.push('Each subsequent asset needs measurement without intervening speed input');
          }
          for (const asset of raw.assetMeasurements || []) {
            if (
              !raw.assets.includes(asset.sourceIdentity) ||
              !validateLiveRateProbeReport(asset.measurement, {
                rates: [requirement.requestedRate],
                minimumDurationMs: requirement.minimumDurationMs,
                minimumWraps: asset.isLoop ? 5 : requirement.minimumWraps,
              }).passed
            ) {
              errors.push('Incomplete subsequent-asset measurement');
            }
          }
        }
        if (requirement.audioEvidence === 'audible-smooth') {
          if (
            !['recording', 'human-listening'].includes(raw.audio?.kind) ||
            raw.audio?.audible !== true ||
            raw.audio?.smooth !== true ||
            !raw.audio?.observer ||
            review?.audioEvidence !== raw.audio?.evidence?.sha256
          ) {
            errors.push('Enabled audio flags do not prove audible smooth output');
          } else {
            try {
              loadArtifact(raw.audio.evidence);
            } catch (error) {
              errors.push(`Audio evidence verification failed: ${error.message}`);
            }
          }
        } else if (requirement.audioEvidence === 'muted' && raw.audio?.muted !== true) {
          errors.push('Muted case not observed muted');
        }
      } catch (error) {
        errors.push(`Malformed raw evidence: ${error.message}`);
      }
    }
    if (
      review?.kind !== 'independent-review' ||
      !review.reviewer ||
      review.reviewer === raw?.recorder ||
      review.reviewer === run.owner ||
      review.caseId !== definition.id ||
      review.evidenceDigest !== item?.evidence?.sha256 ||
      review.verdict !== 'accepted' ||
      !review.reason
    ) {
      errors.push(
        'Independent review of exact raw evidence required; a passed summary is insufficient'
      );
    }
    return {
      ...definition,
      state: errors.length ? 'incomplete' : 'accepted',
      errors,
      evidence: item?.evidence || null,
      measuredRevision: raw?.revision || null,
    };
  });
  const behaviorAccepted =
    !failures.length && rows.length > 0 && rows.every((row) => row.state === 'accepted');
  if (run?.issueClosed === true && !behaviorAccepted) {
    failures.push('Delivery milestones cannot close incomplete behavior acceptance');
  }
  return {
    scopeDigest,
    revision: run?.revision || null,
    failures,
    scopeChanges,
    delivery: run?.delivery || {},
    behaviorAcceptance: behaviorAccepted ? 'accepted' : 'incomplete',
    state: behaviorAccepted
      ? 'accepted'
      : Object.keys(run?.delivery || {}).length
        ? 'partial-delivery'
        : 'incomplete',
    cases: rows,
  };
}
