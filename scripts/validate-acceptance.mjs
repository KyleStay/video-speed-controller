import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE_CASES } from '../tests/safari-ios/acceptance-cases.js';
import { acceptanceDigest, validateAcceptanceRun } from '../tests/e2e/acceptance-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadAcceptanceArtifact(reference, base = root) {
  if (!reference?.path || !/^[a-f0-9]{64}$/.test(reference.sha256)) {
    throw new Error('Artifact requires a path and SHA-256');
  }
  const bytes = readFileSync(path.resolve(base, reference.path));
  if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) {
    throw new Error(`Artifact hash mismatch: ${reference.path}`);
  }
  return path.extname(reference.path) === '.json' ? JSON.parse(bytes) : { kind: 'binary-artifact' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [input, output, ...extra] = process.argv.slice(2);
    if (input === '--scope' && !output) {
      console.log(
        JSON.stringify(
          { scopeDigest: acceptanceDigest(ACCEPTANCE_CASES), cases: ACCEPTANCE_CASES },
          null,
          2
        )
      );
    } else {
      if (!input || extra.length) throw new Error('Use --scope, or <run.json> [report.json]');
      const run = JSON.parse(readFileSync(input, 'utf8'));
      const report = validateAcceptanceRun(ACCEPTANCE_CASES, run, loadAcceptanceArtifact);
      if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      console.log(
        JSON.stringify({
          state: report.state,
          behaviorAcceptance: report.behaviorAcceptance,
          acceptedCases: report.cases.filter((row) => row.state === 'accepted').length,
          totalCases: report.cases.length,
          failures: report.failures,
          report: output || null,
        })
      );
      process.exitCode = report.behaviorAcceptance === 'accepted' ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
