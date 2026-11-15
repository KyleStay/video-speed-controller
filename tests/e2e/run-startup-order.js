import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(process.env.STAYFAST_EXTENSION_DIR || 'dist');
const variants = [
  ['normal', null, 0],
  ['main-first', 'content-bridge.js', 250],
  ['bridge-after-timeout', 'content-bridge.js', 2500],
  ['bridge-first', 'inject.js', 250],
];

for (const [name, delayedFile, delay] of variants) {
  const directory = await mkdtemp(join(tmpdir(), 'stayfast-startup-order-'));
  try {
    await cp(source, directory, { recursive: true });
    if (delayedFile) {
      const file = join(directory, delayedFile);
      const script = await readFile(file, 'utf8');
      // Change scheduling only in this disposable test copy of the built bundle.
      await writeFile(file, `setTimeout(() => {\n${script}\n}, ${delay});\n`);
    }
    console.log(`Startup ordering: ${name}`);
    await new Promise((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, ['tests/e2e/run-isolated.js', 'startup'], {
        stdio: 'inherit',
        env: { ...process.env, STAYFAST_EXTENSION_DIR: directory },
      });
      const stop = () => child.kill('SIGTERM');
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      const detach = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      };
      child.once('error', (error) => {
        detach();
        rejectRun(error);
      });
      child.once('exit', (code, signal) => {
        detach();
        if (code === 0) {
          resolveRun();
        } else {
          rejectRun(new Error(`${name} failed (${signal || code})`));
        }
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
