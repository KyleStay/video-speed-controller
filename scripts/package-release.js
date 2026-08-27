import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ZipArchive } from 'archiver';
import { BROWSERS, RELEASE_READY_BROWSERS } from './browser-config.mjs';
import { releaseZipName } from './release-artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const releaseDir = path.join(rootDir, 'release');
const browserArgument = process.argv.find((argument) => argument.startsWith('--browser='));
const browser = browserArgument?.split('=', 2)[1];
const packageAll = process.argv.includes('--all');

const CWS_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GB

async function packageBrowser(targetBrowser, useLegacyDist = false) {
  const distDir = useLegacyDist
    ? path.join(rootDir, 'dist')
    : path.join(rootDir, 'dist', targetBrowser);
  const zipName = useLegacyDist
    ? `videospeed-${pkg.version}.zip`
    : releaseZipName(targetBrowser, pkg.version);
  const zipPath = path.join(releaseDir, zipName);

  // Verify dist exists
  if (!(await fs.pathExists(distDir))) {
    throw new Error(
      `${path.relative(rootDir, distDir)}/ directory not found. Build ${targetBrowser} first.`
    );
  }

  // Validate manifest version matches package.json
  const manifest = await fs.readJson(path.join(distDir, 'manifest.json'));
  if (manifest.version !== pkg.version) {
    throw new Error(
      `❌ Version mismatch: manifest.json has ${manifest.version}, package.json has ${pkg.version}`
    );
  }

  // Prepare release directory
  await fs.ensureDir(releaseDir);

  // Create zip
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  archive.directory(distDir, false, (entry) => {
    // Exclude source maps and OS cruft
    if (entry.name.endsWith('.map') || entry.name === '.DS_Store') {
      return false;
    }
    return entry;
  });
  await archive.finalize();
  await done;

  const stats = await fs.stat(zipPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  if (targetBrowser === 'chrome' && stats.size > CWS_SIZE_LIMIT) {
    console.warn(`⚠️  Warning: ${zipName} is ${sizeMB} MB (Chrome Web Store limit is 2 GB)`);
  }

  console.log(`✅ Packaged ${zipName} (${sizeMB} MB) → release/`);
}

async function packageRelease() {
  if (packageAll) {
    for (const targetBrowser of RELEASE_READY_BROWSERS) {
      await packageBrowser(targetBrowser);
    }
    return;
  }

  if (browser) {
    if (!BROWSERS.includes(browser)) {
      throw new Error(`Unsupported browser "${browser}". Expected one of: ${BROWSERS.join(', ')}`);
    }
    if (!RELEASE_READY_BROWSERS.includes(browser)) {
      throw new Error(
        `${browser} is experimental and not release-package ready. Build conversion input with npm run build:${browser}.`
      );
    }
    await packageBrowser(browser);
    return;
  }

  // Preserve the historical release command, which builds Chrome into dist/.
  await packageBrowser('chrome', true);
}

packageRelease().catch((err) => {
  console.error('❌ Packaging failed:', err);
  process.exit(1);
});
