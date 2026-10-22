import puppeteer from 'puppeteer';
import { execFile } from 'node:child_process';
import { mkdtemp, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { profileRoots } from './browser-process-ownership.js';

const execFileAsync = promisify(execFile);
const owners = new Set();
const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

async function processRows() {
  const { stdout } = await execFileAsync('ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command=']);
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            start: match[3],
            command: match[4],
          },
        ]
      : [];
  });
}

function sameProcess(a, b) {
  return a && b && a.pid === b.pid && a.start === b.start && a.command === b.command;
}

async function actualLaunchedExecutable(browser, fallback) {
  if (process.platform !== 'linux') {
    return fallback;
  }
  const pid = browser.process()?.pid;
  const before = (await processRows()).find((row) => row.pid === pid);
  if (!before) {
    throw new Error('Launched browser identity unavailable');
  }
  // Linux launchers can exec another binary (Firefox uses firefox-bin).
  // Pin the actual kernel executable while retaining the same birth identity.
  const executable = await readlink(`/proc/${pid}/exe`);
  const after = (await processRows()).find((row) => row.pid === pid);
  if (!sameProcess(before, after) || !executable.startsWith('/')) {
    throw new Error('Launched browser identity changed during executable inspection');
  }
  return executable;
}

async function collectOwned(profile, retained, executable, browserName) {
  const rows = await processRows();
  const roots = await profileRoots(rows, profile, executable, {
    firefox: browserName === 'firefox',
    retained,
  });
  const current = roots.length ? await processRows() : rows;
  for (const root of roots) {
    if (
      !sameProcess(
        root,
        current.find((row) => row.pid === root.pid)
      )
    ) {
      throw new Error(`Browser identity changed during inspection; retained ${profile}`);
    }
  }
  const rootPids = new Set(roots.map((row) => row.pid));
  const owned = new Set(
    current
      .filter((row) => rootPids.has(row.pid) || sameProcess(retained.get(row.pid), row))
      .map((row) => row.pid)
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const row of current) {
      if (owned.has(row.parent) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
    }
  }
  for (const row of current) {
    if (owned.has(row.pid)) {
      retained.set(row.pid, row);
    }
  }
  return current.filter((row) => sameProcess(retained.get(row.pid), row));
}

async function waitForExit(profile, retained, executable, browserName, attempts = 50) {
  let zeroSamples = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await collectOwned(profile, retained, executable, browserName)).length === 0) {
      if (++zeroSamples === 3) {
        return true;
      }
    } else {
      zeroSamples = 0;
    }
    await sleep(100);
  }
  return false;
}

export async function cleanupFixtureBrowsers() {
  await Promise.all([...owners].map((close) => close()));
}

export function extensionBuildPath(browserName) {
  if (!['chrome', 'firefox'].includes(browserName)) {
    throw new Error(`Unsupported fixture browser: ${browserName}`);
  }
  return resolve('dist', browserName);
}

/** Own the profile before launch, including launch/install failures and interruption. */
export async function launchFixtureBrowser(browserName, options = {}) {
  const profile = await mkdtemp(join(tmpdir(), `stayfast-${browserName}-fixture-`));
  const retained = new Map();
  const controller = new AbortController();
  let browser;
  let executable;
  let originalClose;
  let launching;
  let closing;
  const close = () => {
    if (closing) {
      return closing;
    }
    closing = (async () => {
      let inventoryError;
      try {
        await collectOwned(profile, retained, executable, browserName);
      } catch (error) {
        inventoryError = error;
      }
      if (!browser) {
        controller.abort();
      }
      // A signal may arrive before Puppeteer hands back its browser handle.
      await launching?.catch(() => undefined);
      try {
        await collectOwned(profile, retained, executable, browserName);
      } catch (error) {
        inventoryError ||= error;
      }
      try {
        if (originalClose) {
          await Promise.race([originalClose(), sleep(5000)]);
        }
      } catch {
        /* Exact owned-process fallback below. */
      }
      // The returned browser handle is ours to close even if native inspection
      // failed. Do not signal discovered PIDs or remove an ambiguous profile.
      if (inventoryError) {
        // A helper can exit between the process snapshot and native argv read.
        // A fresh successful inventory supersedes that earlier uncertainty.
        await collectOwned(profile, retained, executable, browserName);
      }
      if (!(await waitForExit(profile, retained, executable, browserName, 10))) {
        for (const row of (
          await collectOwned(profile, retained, executable, browserName)
        ).reverse()) {
          const current = (await processRows()).find((item) => item.pid === row.pid);
          if (sameProcess(row, current)) {
            process.kill(row.pid, 'SIGTERM');
          }
        }
      }
      if (!(await waitForExit(profile, retained, executable, browserName))) {
        throw new Error(`Owned ${browserName} processes remain; retained ${profile}`);
      }
      await rm(profile, { recursive: true, force: true });
      owners.delete(close);
      console.log(`Cleanup verified: 0 owned ${browserName} PIDs, 0 disposable profiles`);
    })();
    closing.catch(() => {
      closing = undefined;
    });
    return closing;
  };
  owners.add(close);
  try {
    const launchOptions = {
      browser: browserName,
      headless: browserName === 'firefox',
      protocolTimeout: 30000,
      timeout: 60000,
      dumpio: process.env.STAYFAST_BROWSER_DEBUG === '1',
      ...options,
      userDataDir: profile,
      signal: controller.signal,
      // The caller awaits our cleanup instead of Puppeteer's immediate signal exit.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    };
    delete launchOptions.extensionPath;
    if (browserName === 'chrome') {
      launchOptions.enableExtensions = true;
      launchOptions.args ||= ['--disable-dev-shm-usage', '--disable-gpu'];
      if (process.env.CI === 'true' && process.platform === 'linux') {
        launchOptions.args.push('--no-sandbox', '--disable-setuid-sandbox');
      }
    }
    if (browserName === 'firefox' && process.env.FIREFOX_BIN) {
      launchOptions.executablePath = process.env.FIREFOX_BIN;
    }
    executable = launchOptions.executablePath;
    if (controller.signal.aborted) {
      throw new Error('Browser launch canceled');
    }
    launching = puppeteer.launch(launchOptions).then((launched) => {
      // Use the executable Puppeteer actually launched. Pre-resolving another
      // browser can select the previous launcher's cached version.
      executable = launched.process()?.spawnfile || executable;
      browser = launched;
      originalClose = browser.close.bind(browser);
      browser.close = close;
      return launched;
    });
    await launching;
    executable = await actualLaunchedExecutable(browser, executable);
    await collectOwned(profile, retained, executable, browserName);
    const pid = browser.process()?.pid;
    const extensionId = await browser.installExtension(
      options.extensionPath || extensionBuildPath(browserName)
    );
    if (!extensionId) {
      throw new Error(`${browserName} did not return an installed extension ID`);
    }
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.setViewport({ width: 1280, height: 800 });
    console.log(`Disposable ${browserName} ${pid || 'unknown PID'}, extension ${extensionId}`);
    return { browser, page, browserName, extensionId, pid, profile };
  } catch (error) {
    await close();
    throw new Error(`Could not launch ${browserName} fixture runtime: ${error.message}`, {
      cause: error,
    });
  }
}
