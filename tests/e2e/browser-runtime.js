import puppeteer from 'puppeteer';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function isAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
    return false;
  }
}

async function processRows() {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command=']);
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match ? { pid: Number(match[1]), parent: Number(match[2]), command: match[3] } : null;
    })
    .filter(Boolean);
}

async function ownedProcessTree(pid, profile) {
  const rows = await processRows();
  const pids = new Set();
  if (pid) {
    pids.add(pid);
  }
  for (const row of rows) {
    if (row.command.includes(profile)) {
      pids.add(row.pid);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) {
      if (pids.has(row.parent) && !pids.has(row.pid)) {
        pids.add(row.pid);
        changed = true;
      }
    }
  }
  return pids;
}

async function waitForExit(pids) {
  for (let attempt = 0; attempt < 100 && [...pids].some(isAlive); attempt++) {
    await sleep(50);
  }
  const surviving = [...pids].filter(isAlive);
  if (surviving.length) {
    throw new Error(
      `Owned browser PIDs ${surviving.join(', ')} remain alive; retained the disposable profile`
    );
  }
}

async function terminateOwnedProcesses(pids) {
  for (const ownedPid of [...pids].reverse()) {
    if (isAlive(ownedPid)) {
      process.kill(ownedPid, 'SIGTERM');
    }
  }
  await waitForExit(pids);
}

export function extensionBuildPath(browserName) {
  if (!['chrome', 'firefox'].includes(browserName)) {
    throw new Error(`Unsupported fixture browser: ${browserName}`);
  }
  return resolve('dist', browserName);
}

/**
 * Launch a browser in a disposable profile and install the unpacked extension
 * through Puppeteer's native extension API. Firefox uses WebDriver BiDi; in
 * Puppeteer 25 this maps directly to webExtension.install with path data.
 */
export async function launchFixtureBrowser(browserName) {
  const profile = await mkdtemp(join(tmpdir(), `stayfast-${browserName}-fixture-`));
  let browser;
  let pid;
  try {
    const launchOptions = {
      browser: browserName,
      headless: browserName === 'firefox',
      protocolTimeout: 30000,
      timeout: 60000,
      userDataDir: profile,
      dumpio: process.env.STAYFAST_BROWSER_DEBUG === '1',
    };
    if (browserName === 'chrome') {
      launchOptions.headless = false;
      launchOptions.enableExtensions = true;
      launchOptions.args = ['--disable-dev-shm-usage', '--disable-gpu'];
      if (process.env.CI === 'true' && process.platform === 'linux') {
        launchOptions.args.push('--no-sandbox', '--disable-setuid-sandbox');
      }
    }
    if (browserName === 'firefox' && process.env.FIREFOX_BIN) {
      launchOptions.executablePath = process.env.FIREFOX_BIN;
    }

    browser = await puppeteer.launch(launchOptions);
    pid = browser.process()?.pid;
    const extensionId = await browser.installExtension(extensionBuildPath(browserName));
    if (!extensionId) {
      throw new Error(`${browserName} did not return an installed extension ID`);
    }

    const originalClose = browser.close.bind(browser);
    let closed = false;
    browser.close = async () => {
      if (closed) {
        return;
      }
      closed = true;
      const ownedPids = await ownedProcessTree(pid, profile);
      let closeError;
      try {
        await originalClose();
      } catch (error) {
        closeError = error;
      }
      try {
        await waitForExit(ownedPids);
      } catch (error) {
        await terminateOwnedProcesses(ownedPids).catch(() => {
          throw error;
        });
      }
      await rm(profile, { recursive: true, force: true });
      console.log(`Cleanup verified: 0 owned ${browserName} PIDs, 0 disposable profiles`);
      if (closeError) {
        throw closeError;
      }
    };

    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.setViewport({ width: 1280, height: 800 });
    console.log(`Disposable ${browserName} ${pid || 'unknown PID'}, extension ${extensionId}`);
    return { browser, page, browserName, extensionId, pid, profile };
  } catch (error) {
    let cleanupError;
    const ownedPids = await ownedProcessTree(pid, profile);
    try {
      await browser?.close();
    } catch (caughtCleanupError) {
      cleanupError = caughtCleanupError;
    }
    if ([...ownedPids].some(isAlive)) {
      try {
        await terminateOwnedProcesses(ownedPids);
      } catch (terminationError) {
        cleanupError ||= terminationError;
      }
    }
    if (![...ownedPids].some(isAlive)) {
      await rm(profile, { recursive: true, force: true });
      console.log(`Cleanup verified: 0 owned ${browserName} PIDs, 0 disposable profiles`);
    }
    const prerequisite =
      browserName === 'firefox'
        ? ' Install it with "npx puppeteer browsers install firefox" or set FIREFOX_BIN.'
        : '';
    const cleanupDetail = cleanupError ? ` Cleanup also failed: ${cleanupError.message}` : '';
    throw new Error(
      `Could not launch ${browserName} fixture runtime.${prerequisite} ${error.message}${cleanupDetail}`,
      { cause: error }
    );
  }
}
