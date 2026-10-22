import puppeteer from 'puppeteer';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

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

async function collectOwned(profile, retained) {
  const rows = await processRows();
  const marker = `--user-data-dir=${profile}`;
  const owned = new Set(
    rows
      .filter(
        (row) =>
          sameProcess(retained.get(row.pid), row) ||
          row.command.includes(marker) ||
          row.command.includes(`-profile ${profile}`)
      )
      .map((row) => row.pid)
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) {
      if (owned.has(row.parent) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
    }
  }
  for (const row of rows) {
    if (owned.has(row.pid)) {
      retained.set(row.pid, row);
    }
  }
  return rows.filter((row) => sameProcess(retained.get(row.pid), row));
}

async function waitForExit(profile, retained, attempts = 50) {
  let zeroSamples = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await collectOwned(profile, retained)).length === 0) {
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
  let originalClose;
  let launching;
  let closing;
  const close = () => {
    if (closing) {
      return closing;
    }
    closing = (async () => {
      await collectOwned(profile, retained);
      controller.abort();
      // A signal may arrive before Puppeteer hands back its browser handle.
      await launching?.catch(() => undefined);
      await collectOwned(profile, retained);
      try {
        if (originalClose) {
          await Promise.race([originalClose(), sleep(5000)]);
        }
      } catch {
        /* Exact owned-process fallback below. */
      }
      if (!(await waitForExit(profile, retained, 10))) {
        for (const row of (await collectOwned(profile, retained)).reverse()) {
          const current = (await processRows()).find((item) => item.pid === row.pid);
          if (sameProcess(row, current)) {
            process.kill(row.pid, 'SIGTERM');
          }
        }
      }
      if (!(await waitForExit(profile, retained))) {
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
    launching = puppeteer.launch(launchOptions).then((launched) => {
      browser = launched;
      originalClose = browser.close.bind(browser);
      browser.close = close;
      return launched;
    });
    await launching;
    await collectOwned(profile, retained);
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
