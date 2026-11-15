import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isDeletionOnlyPush(input) {
  const lines = input.replace(/\n$/, '').split('\n');
  return lines.every((line) => {
    const fields = line.split(' ');
    if (fields.length !== 4) return false;
    const [localRef, localOid, remoteRef, remoteOid] = fields;
    if (
      localRef !== '(delete)' ||
      !/^(?:0{40}|0{64})$/.test(localOid) ||
      !/^[a-f0-9]+$/.test(remoteOid) ||
      remoteOid.length !== localOid.length ||
      /^0+$/.test(remoteOid)
    ) {
      return false;
    }
    return spawnSync('git', ['check-ref-format', remoteRef], { stdio: 'ignore' }).status === 0;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = isDeletionOnlyPush(readFileSync(0, 'utf8')) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
