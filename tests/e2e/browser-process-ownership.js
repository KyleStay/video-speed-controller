import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const reader = join(dirname(fileURLToPath(import.meta.url)), 'browser-process-info.py');

/** Displayed command text has lost argv boundaries and is never ownership proof. */
function profileValues(argv, { firefox = false } = {}) {
  const values = [];
  for (let i = 1; i < argv.length && argv[i] !== '--'; i++) {
    const arg = argv[i];
    if (!firefox && arg.startsWith('--user-data-dir=')) {
      values.push(arg.slice('--user-data-dir='.length));
    } else if (!firefox && arg === '--user-data-dir') {
      values.push(undefined);
    } else if (firefox && (arg === '-profile' || arg === '--profile')) {
      values.push(argv[++i]);
    }
  }
  return values;
}

export function hasProfileArgument(argv, profile, options = {}) {
  if (
    !Array.isArray(argv) ||
    !argv.every((arg) => typeof arg === 'string') ||
    typeof profile !== 'string' ||
    !profile
  ) {
    return false;
  }
  const values = profileValues(argv, options);
  // Conflicting or duplicate switches are ambiguous: never infer which wins.
  return values.length === 1 && values[0] === profile;
}

export async function profileRoots(rows, profile, executable, options = {}) {
  // Raw text narrows read-only inspection only. It never admits a root.
  const candidates = rows.filter((row) => row.command.includes(profile));
  if (!candidates.length) {
    return [];
  }
  if (typeof executable !== 'string' || !executable) {
    throw new Error(`Browser executable identity unavailable; retained ${profile}`);
  }
  let details;
  try {
    const { stdout } = await execFileAsync(
      'python3',
      [reader, executable, ...candidates.map((row) => String(row.pid))],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }
    );
    details = JSON.parse(stdout);
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      throw new Error('Invalid native argument envelope');
    }
  } catch (error) {
    throw new Error(`Native browser argument read failed; retained ${profile}`, { cause: error });
  }
  return candidates.filter((row) => {
    const info = details[row.pid];
    if (!info || !['verified', 'different-executable', 'gone'].includes(info.status)) {
      throw new Error(
        `Native browser arguments unavailable for PID ${row.pid}; retained ${profile}`
      );
    }
    if (info.status === 'gone') {
      return false;
    }
    if (
      !Array.isArray(info.argv) ||
      !info.argv.length ||
      !info.argv.every((arg) => typeof arg === 'string')
    ) {
      throw new Error(
        `Native browser arguments incomplete for PID ${row.pid}; retained ${profile}`
      );
    }
    if (
      profileValues(info.argv, options).includes(profile) &&
      !hasProfileArgument(info.argv, profile, options)
    ) {
      throw new Error(
        `Ambiguous browser profile arguments for PID ${row.pid}; retained ${profile}`
      );
    }
    const matches = hasProfileArgument(info.argv, profile, options);
    if (info.status === 'different-executable') {
      if (matches) {
        throw new Error(`Another browser executable uses the profile; retained ${profile}`);
      }
      return false;
    }
    return matches;
  });
}
