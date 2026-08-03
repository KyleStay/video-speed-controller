import esbuild from 'esbuild';
import process from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import { createRequire } from 'module';
import {
  RELEASE_READY_BROWSERS,
  createBrowserManifest,
  getBuildTarget,
} from './browser-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const isWatch = process.argv.includes('--watch');
const isRelease = process.env.RELEASE === '1';
const isAllBrowsers = process.argv.includes('--all');
const browserArgument = process.argv.find((argument) => argument.startsWith('--browser='));
const explicitBrowser = browserArgument?.split('=', 2)[1];
const requestedBrowsers = isAllBrowsers ? RELEASE_READY_BROWSERS : [explicitBrowser || 'chrome'];

if (isWatch && (isAllBrowsers || explicitBrowser)) {
  throw new Error('Watch mode uses the default Chrome dist/. Omit --all and --browser.');
}

const common = {
  bundle: true,
  sourcemap: isRelease ? false : false, // set true locally if debugging
  minify: isRelease,
  platform: 'browser',
  legalComments: 'none',
  format: 'iife', // preserve side-effects and simple global init without ESM runtime
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function copyStaticFiles(browser, outDir) {
  try {
    // Ensure the output directory exists and is clean
    await fs.emptyDir(outDir);

    // Inject version from package.json into manifest
    const baseManifest = await fs.readJson(path.join(rootDir, 'manifest.json'));
    const manifest = createBrowserManifest(baseManifest, browser, pkg.version);
    await fs.writeJson(path.join(outDir, 'manifest.json'), manifest, { spaces: 2 });
    console.log(
      `✅ ${browser} manifest version set to ${pkg.version}${isRelease ? ' (release)' : ''}`
    );

    // Paths to copy
    const pathsToCopy = {
      'src/assets': path.join(outDir, 'assets'),
      'src/ui': path.join(outDir, 'ui'),
      'src/styles': path.join(outDir, 'styles'),
      LICENSE: path.join(outDir, 'LICENSE'),
      'CONTRIBUTING.md': path.join(outDir, 'CONTRIBUTING.md'),
      'PRIVACY.md': path.join(outDir, 'PRIVACY.md'),
      'README.md': path.join(outDir, 'README.md'),
    };

    // Perform copy operations
    for (const [src, dest] of Object.entries(pathsToCopy)) {
      await fs.copy(path.join(rootDir, src), dest, {
        filter: (src) => !path.basename(src).endsWith('.js'),
      });
    }

    console.log('✅ Static files copied');
  } catch (error) {
    console.error('❌ Error copying static files:', error);
    process.exit(1);
  }
}

async function buildBrowser(browser, outDir) {
  await copyStaticFiles(browser, outDir);

  const esbuildConfig = {
    ...common,
    target: getBuildTarget(browser),
    entryPoints: {
      'content-bridge': 'src/entries/content-bridge.js',
      inject: 'src/entries/inject-entry.js',
      background: 'src/background.js',
      'ui/popup/popup': 'src/ui/popup/popup.js',
      'ui/options/options': 'src/ui/options/options.js',
    },
    outdir: path.relative(rootDir, outDir),
  };

  if (isWatch) {
    const ctx = await esbuild.context(esbuildConfig);
    await ctx.watch();
    console.log('🔧 Watching Chrome dist/ for changes...');
  } else {
    await esbuild.build(esbuildConfig);
    console.log(`✅ ${browser} build complete → ${path.relative(rootDir, outDir)}/`);
  }
}

async function build() {
  try {
    for (const browser of requestedBrowsers) {
      const outDir =
        isAllBrowsers || explicitBrowser
          ? path.join(rootDir, 'dist', browser)
          : path.join(rootDir, 'dist');
      await buildBrowser(browser, outDir);
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
