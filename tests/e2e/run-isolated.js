/** macOS browser verification through the disposable Chrome skill runner. */
import puppeteer from 'puppeteer';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import runBasic from './basic.e2e.js';
import runStartup from './startup.e2e.js';
import runResume from './resume.e2e.js';
import { installBridgeTestHooks } from './bridge-test-hooks.js';
import { profileRoots } from './browser-process-ownership.js';
import runYouTube from './youtube.e2e.js';
import runMobile from './mobile.e2e.js';
import runIOSPlayer from './ios-player.e2e.js';
import runTwitterInline from './twitter-inline.e2e.js';
import runTwitterLayout from './twitter-layout.e2e.js';
import runTwitterVisual from './twitter-visual.e2e.js';
import runVideoDiagnostics from './video-diagnostics.e2e.js';
import runTwitterPristine from './twitter-pristine.e2e.js';

const execFileAsync = promisify(execFile);
const runner =
  process.env.STAYFAST_CHROME_RUNNER ||
  join(homedir(), '.codex/skills/chrome-extension-test-runner/scripts/launch_test_chrome.py');
const suites = {
  resume: runResume,
  startup: runStartup,
  basic: runBasic,
  youtube: runYouTube,
  mobile: runMobile,
  'ios-player': runIOSPlayer,
  'twitter-inline': runTwitterInline,
  'twitter-layout': runTwitterLayout,
  'twitter-visual': runTwitterVisual,
  'video-diagnostics': runVideoDiagnostics,
  'twitter-pristine': runTwitterPristine,
};
const externalSuites = {
  fixtures: ['tests/e2e/run-browser-fixtures.js', 'all'],
  'fixtures-chrome': ['tests/e2e/run-browser-fixtures.js', 'chrome'],
  'fixtures-firefox': ['tests/e2e/run-browser-fixtures.js', 'firefox'],
  benchmarks: ['tests/e2e/run-performance-benchmark.js'],
};
const names = process.argv.slice(2);
if (!names.length) {
  names.push('basic', 'youtube');
}
if (names.some((name) => name !== 'cleanup' && !suites[name] && !externalSuites[name])) {
  throw new Error(
    'Use startup, resume, basic, mobile, ios-player, twitter-inline, twitter-layout, twitter-visual, twitter-pristine, video-diagnostics, youtube, fixtures, and/or benchmarks'
  );
}

const needsBrowserBuilds = names.some((name) => externalSuites[name]);
if (needsBrowserBuilds) {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/build.mjs', '--all'], {
    env: { ...process.env, RELEASE: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
const extensionDirectory = resolve(
  process.env.STAYFAST_EXTENSION_DIR || (needsBrowserBuilds ? 'dist/chrome' : 'dist')
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let owned = null;
let cleaning = null;
let activeExternal = null;
let activeLauncher = null;
let interrupted = false;

async function resolveChromeExecutable() {
  // Resolve through the trusted runner before launch, including standalone
  // recovery where no launch result exists. Dry-run allocates no profile.
  const { stdout } = await execFileAsync(
    'python3',
    [runner, '--extension', extensionDirectory, '--dry-run'],
    { timeout: 10000 }
  );
  const executable = JSON.parse(stdout).command?.[0];
  if (typeof executable !== 'string' || !isAbsolute(executable)) {
    throw new Error('Runner did not provide an absolute Chrome executable');
  }
  return executable;
}

async function processRows() {
  const { stdout } = await execFileAsync('ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command=']);
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), parent: Number(match[2]), start: match[3], command: match[4] }]
      : [];
  });
}

async function processTree(pid, profile, executable) {
  const rows = await processRows();
  const roots = await profileRoots(rows, profile, executable);
  const current = roots.length ? await processRows() : rows;
  for (const root of roots) {
    const now = current.find((row) => row.pid === root.pid);
    if (!now || now.start !== root.start || now.command !== root.command) {
      throw new Error(`Browser identity changed during inspection; retained ${profile}`);
    }
  }
  const ownedPids = new Set(roots.map((row) => row.pid));
  // A recycled root PID cannot establish ownership without the exact profile.
  if (!ownedPids.has(pid)) {
    return new Map();
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const row of current) {
      if (ownedPids.has(row.parent) && !ownedPids.has(row.pid)) {
        ownedPids.add(row.pid);
        grew = true;
      }
    }
  }
  return new Map(current.filter((row) => ownedPids.has(row.pid)).map((row) => [row.pid, row]));
}

async function liveOwned(identities) {
  return (await processRows()).filter((row) => {
    const expected = identities.get(row.pid);
    return expected?.start === row.start && expected.command === row.command;
  });
}

async function terminateExact(identities) {
  for (const row of (await liveOwned(identities)).reverse()) {
    // Recheck start and command immediately before each signal.
    if ((await liveOwned(new Map([[row.pid, row]]))).length) {
      try {
        process.kill(row.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error;
        }
      }
    }
  }
}

async function cleanup() {
  if (!owned) {
    return;
  }
  if (cleaning) {
    return cleaning;
  }
  cleaning = (async () => {
    const { browser, profile } = owned;
    const identities = new Map(owned.identities || []);
    let inventoryError;
    try {
      const roots = await profileRoots(await processRows(), profile, owned.executable, {
        retained: owned.identities,
      });
      for (const root of roots) {
        for (const [child, identity] of await processTree(root.pid, profile, owned.executable)) {
          identities.set(child, identity);
        }
      }
    } catch (error) {
      inventoryError = error;
    }
    if (browser) {
      try {
        const session = await browser.target().createCDPSession();
        await session.send('Browser.close');
      } catch {
        // Suites may already have closed the browser in their finally block.
      }
    }
    // Close the known browser even when native inspection failed, but retain
    // its profile and never signal discovered identities on incomplete proof.
    if (inventoryError) {
      throw inventoryError;
    }
    if (!browser) {
      await terminateExact(identities);
    }
    for (let attempt = 0; attempt < 30 && (await liveOwned(identities)).length; attempt++) {
      await sleep(100);
    }
    await terminateExact(identities);
    for (let attempt = 0; attempt < 100 && (await liveOwned(identities)).length; attempt++) {
      await sleep(50);
    }
    const surviving = await liveOwned(identities);
    if (surviving.length) {
      throw new Error(
        `Chrome PIDs ${surviving.map((row) => row.pid).join(', ')} remain; retain ${profile}`
      );
    }
    // A launch must settle before this inventory, including during signals.
    if (
      (
        await profileRoots(await processRows(), profile, owned.executable, {
          retained: owned.identities,
        })
      ).length
    ) {
      throw new Error(`Chrome still owns ${profile}; retained the disposable profile`);
    }
    await rm(profile, { recursive: true, force: true });
    console.log('Cleanup verified: 0 owned Chrome PIDs, 0 disposable profiles');
    owned = null;
  })();
  try {
    await cleaning;
  } finally {
    cleaning = null;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    if (interrupted) {
      return;
    }
    interrupted = true;
    try {
      if (activeLauncher) {
        const child = activeLauncher.child;
        const exited =
          child.exitCode !== null || child.signalCode !== null
            ? Promise.resolve()
            : new Promise((resolveExit) => child.once('exit', resolveExit));
        child.kill(signal);
        // Pipes can be inherited by browser helpers: wait for process exit,
        // then clean those helpers before waiting for pipe closure.
        await Promise.race([exited, sleep(5000)]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        await exited;
      }
      if (activeExternal) {
        activeExternal.child.kill(signal);
        await activeExternal.done;
      }
      await cleanup();
    } catch (error) {
      console.error(`Cleanup failed: ${error.message}`);
    } finally {
      process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
    }
  });
}

async function runExternal(script, arguments_) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...arguments_], {
      stdio: 'inherit',
    });
    let exited;
    const done = new Promise((resolveExit) => {
      exited = resolveExit;
    });
    activeExternal = { child, done };
    const removeSignals = () => {
      activeExternal = null;
      exited();
    };
    child.once('error', (error) => {
      removeSignals();
      rejectRun(error);
    });
    child.once('exit', (code, signal) => {
      removeSignals();
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${script} failed (${signal || code})`));
      }
    });
  });
}

let failed = 0;
for (const name of names) {
  if (interrupted) {
    break;
  }
  try {
    if (name === 'cleanup') {
      const profile = resolve(process.env.STAYFAST_CLEANUP_PROFILE || '');
      if (
        dirname(profile) !== resolve(tmpdir()) ||
        !/^stayfast-browser-qa-[\w-]+$/.test(basename(profile))
      ) {
        throw new Error(
          'Cleanup requires an exact generated disposable profile in the temporary directory'
        );
      }
      owned = { profile, executable: await resolveChromeExecutable() };
      await cleanup();
      continue;
    }
    if (externalSuites[name]) {
      const [script, ...arguments_] = externalSuites[name];
      await runExternal(script, arguments_);
      continue;
    }
    const result = await suites[name]({
      launch: async ({ bridgeHooks = false } = {}) => {
        const profile = await mkdtemp(join(tmpdir(), 'stayfast-browser-qa-'));
        owned = { profile };
        owned.executable = await resolveChromeExecutable();
        let loadDirectory = extensionDirectory;
        if (bridgeHooks) {
          loadDirectory = join(profile, 'extension-under-test');
          await cp(extensionDirectory, loadDirectory, { recursive: true });
          const bundle = join(loadDirectory, 'content-bridge.js');
          const source = await readFile(bundle, 'utf8');
          await writeFile(bundle, `(${installBridgeTestHooks.toString()})();\n${source}`);
        }
        let stdout;
        try {
          activeLauncher = execFileAsync(
            'python3',
            [
              runner,
              '--chrome',
              owned.executable,
              '--extension',
              loadDirectory,
              '--profile',
              profile,
              '--owner-pid',
              String(process.pid),
              '--url',
              'about:blank',
            ],
            { timeout: 30000 }
          );
          ({ stdout } = await activeLauncher);
        } catch (error) {
          throw new Error(
            `Disposable Chrome launch failed: ${error.stderr || error.stdout || error.message}`,
            { cause: error }
          );
        } finally {
          activeLauncher = null;
        }
        const info = JSON.parse(stdout);
        owned.pid = info.pid;
        owned.executable = info.command?.[0];
        if (!info.debugger_ready || !info.extension_loaded) {
          throw new Error(`Extension failed to load; inspect ${info.log_file}`);
        }
        console.log(`Disposable Chrome ${info.pid}, extension ${info.extension_id}`);
        const browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${info.debug_port}`,
          protocolTimeout: 30000,
        });
        owned.browser = browser;
        owned.identities = await processTree(info.pid, profile, owned.executable);
        const close = browser.close.bind(browser);
        browser.close = async () => {
          let inventoryError;
          try {
            const current = await processTree(info.pid, profile, owned.executable);
            for (const [pid, identity] of current) {
              owned.identities.set(pid, identity);
            }
          } catch (error) {
            inventoryError = error;
          }
          await close();
          if (inventoryError) {
            throw inventoryError;
          }
        };
        const page = (await browser.pages())[0] || (await browser.newPage());
        await page.setViewport({ width: 1280, height: 800 });
        page.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
        return { browser, page, extensionId: info.extension_id };
      },
    });
    failed += result.failed;
  } catch (error) {
    failed++;
    console.error(`${name}: ${error.stack || error.message}`);
  } finally {
    await cleanup();
  }
}
process.exitCode = failed ? 1 : 0;
