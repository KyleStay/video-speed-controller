#!/usr/bin/env node
import { createHash, createPublicKey } from 'node:crypto';
import {
  cp,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  lstat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_CHROME_ID = 'inojpjdelhcipcommmoibfahlgkekijo';
const PRODUCTION_FIREFOX_ID = 'stayfast-video@staytech.co';
const DEVELOPMENT_FIREFOX_ID = 'stayfast-development@staytech.co';
const SAFARI_APP_ID = 'co.staytech.stayfast';
const SAFARI_EXTENSION_ID = `${SAFARI_APP_ID}.Extension`;
const SAFARI_TEAM_ID = 'TF2BG2VDPD';
const DEVELOPMENT_CHROME_ID = 'jhkigijhcbfmndinioedenfmjegefgeb';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--help') {
      args.help = true;
      continue;
    }
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`);
    const name = item.slice(2);
    if (!['browser', 'mode', 'out-dir', 'production-public-key', 'production-id'].includes(name)) {
      throw new Error(`Unknown option: ${item}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${item}`);
    args[name] = value;
  }
  if (!args.help && (!args.browser || !args.mode)) {
    throw new Error('Both --browser and --mode are required');
  }
  if (args.browser !== 'chrome' && (args['production-public-key'] || args['production-id'])) {
    throw new Error(
      'Production Chrome identity options can only be used with Chrome replacement mode'
    );
  }
  if (args.mode !== 'replacement' && (args['production-public-key'] || args['production-id'])) {
    throw new Error('Production identity options are accepted only in replacement mode');
  }
  return args;
}

function chromeId(publicKeyDer) {
  const hex = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('');
}

export function readChromePublicKey(keyText) {
  if (typeof keyText !== 'string') throw new Error('Production public key must be text');
  const stripped = keyText.trim();
  let publicKey;
  const isPem = stripped.includes('-----BEGIN') || stripped.includes('-----END');
  if (isPem) {
    if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(stripped)) {
      throw new Error('Production key must be public; private-key PEM is not accepted');
    }
    if (!/^-----BEGIN PUBLIC KEY-----\s+[\s\S]+?\s+-----END PUBLIC KEY-----$/.test(stripped)) {
      throw new Error('Production public key PEM must use the PUBLIC KEY header');
    }
    try {
      publicKey = createPublicKey(stripped);
    } catch {
      throw new Error('Production public key PEM is invalid');
    }
  } else {
    const base64 = stripped.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) {
      throw new Error('Production public key must be PEM or base64-encoded DER');
    }
    const der = Buffer.from(base64, 'base64');
    if (!der.length || der.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
      throw new Error('Production public key must be canonical base64-encoded DER');
    }
    try {
      publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      throw new Error('Production public key is not valid DER SubjectPublicKeyInfo');
    }
    const canonicalDer = publicKey.export({ type: 'spki', format: 'der' });
    if (!canonicalDer.equals(der)) {
      throw new Error('Production public key DER is not canonical SubjectPublicKeyInfo');
    }
  }
  if (publicKey.asymmetricKeyType !== 'rsa') {
    throw new Error('Chrome identity public key must use RSA');
  }
  return publicKey.export({ type: 'spki', format: 'der' });
}

export function selectManifest({
  manifest,
  browser,
  mode,
  devPublicKey,
  productionPublicKey,
  productionId,
}) {
  const selected = structuredClone(manifest);
  delete selected.key;

  if (browser === 'chrome') {
    if (mode === 'store') return selected;
    if (mode === 'development') {
      selected.name = `${manifest.name} (Development)`;
      selected.key = devPublicKey.trim();
      return selected;
    }
    if (mode === 'replacement') {
      if (!productionPublicKey || !productionId) {
        throw new Error(
          'Chrome replacement requires a verified production public key and --production-id; no replacement package was created'
        );
      }
      if (!/^[a-p]{32}$/.test(productionId) || productionId !== PRODUCTION_CHROME_ID) {
        throw new Error(
          `Chrome replacement is restricted to the known production ID ${PRODUCTION_CHROME_ID}`
        );
      }
      const der = readChromePublicKey(productionPublicKey);
      const derivedId = chromeId(der);
      if (derivedId !== productionId) {
        throw new Error(
          `Production public key derives ID ${derivedId}, which does not match claimed ID ${productionId}; no replacement package was created`
        );
      }
      selected.key = der.toString('base64');
      return selected;
    }
    throw new Error('Chrome mode must be store, development, or replacement');
  }

  if (browser === 'firefox') {
    if (!['store', 'replacement', 'development'].includes(mode)) {
      throw new Error('Firefox mode must be store, development, or replacement');
    }
    selected.browser_specific_settings = {
      ...selected.browser_specific_settings,
      gecko: {
        ...selected.browser_specific_settings?.gecko,
        id: mode === 'development' ? DEVELOPMENT_FIREFOX_ID : PRODUCTION_FIREFOX_ID,
      },
    };
    if (mode === 'development') selected.name = `${manifest.name} (Development)`;
    return selected;
  }

  if (browser === 'safari' && mode === 'resources') return selected;
  throw new Error('Safari supports resources mode only');
}

async function walkFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name.endsWith('.map')) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Package input contains a symlink: ${relative}`);
    if (entry.isDirectory())
      files.push(...(await walkFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

async function validateSafariNativeIdentity() {
  const projectPath = path.join(
    ROOT,
    'apple/StayFast Video/StayFast Video.xcodeproj/project.pbxproj'
  );
  const project = await readFile(projectPath, 'utf8');
  const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(
    (match) => match[1]
  );
  if (ids.length !== 8 || ids.some((id) => ![SAFARI_APP_ID, SAFARI_EXTENSION_ID].includes(id))) {
    throw new Error(
      'Safari native bundle identity did not match the retained app and extension IDs'
    );
  }
  const teamIds = [...project.matchAll(/DEVELOPMENT_TEAM = ([^;]+);/g)].map((match) => match[1]);
  if (teamIds.some((team) => team !== SAFARI_TEAM_ID)) {
    throw new Error('Safari native team identity differs from the retained team ID');
  }
}

export async function packageCandidate({
  browser,
  mode,
  outDir,
  productionPublicKeyPath,
  productionId,
}) {
  if (!['chrome', 'firefox', 'safari'].includes(browser))
    throw new Error('Browser must be chrome, firefox, or safari');
  const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const distDir = path.join(ROOT, 'dist', browser);
  const distManifest = JSON.parse(await readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  if (distManifest.version !== packageJson.version) {
    throw new Error(
      `Offline version mismatch: package.json=${packageJson.version}, ${browser} manifest=${distManifest.version}`
    );
  }
  const publicKeyPath = path.join(ROOT, 'release-keys/development-public-key.txt');
  const devPublicKey = await readFile(publicKeyPath, 'utf8');
  if (chromeId(Buffer.from(devPublicKey.trim(), 'base64')) !== DEVELOPMENT_CHROME_ID) {
    throw new Error('Pinned development public key no longer matches its documented extension ID');
  }
  if (browser === 'safari') await validateSafariNativeIdentity();
  const productionPublicKey = productionPublicKeyPath
    ? await readFile(path.resolve(productionPublicKeyPath), 'utf8')
    : null;
  const manifest = selectManifest({
    manifest: distManifest,
    browser,
    mode,
    devPublicKey,
    productionPublicKey,
    productionId,
  });
  if (
    JSON.stringify(manifest.permissions ?? []) !== JSON.stringify(distManifest.permissions ?? [])
  ) {
    throw new Error('Package mode unexpectedly changed permissions');
  }
  if (
    JSON.stringify(manifest.host_permissions ?? []) !==
    JSON.stringify(distManifest.host_permissions ?? [])
  ) {
    throw new Error('Package mode unexpectedly changed host permissions');
  }
  if (browser === 'safari' && JSON.stringify(manifest) !== JSON.stringify(distManifest)) {
    throw new Error('Safari resource packaging must preserve the built manifest unchanged');
  }

  const outputDirectory = path.resolve(outDir || path.join(ROOT, 'release/candidates'));
  await mkdir(outputDirectory, { recursive: true });
  const packageFiles = await walkFiles(distDir);
  if (!packageFiles.includes('manifest.json'))
    throw new Error('Built browser resources lack manifest.json');
  if (packageFiles.some((file) => /(^|\/)(release-keys?|.*private.*key.*)(\/|$)/i.test(file))) {
    throw new Error('Package input contains a private-key or release-key path');
  }
  const zipName = `stayfast-${packageJson.version}-${browser}-${mode}.zip`;
  const finalPath = path.join(outputDirectory, zipName);
  const checksumPath = `${finalPath}.sha256`;
  let publicationStage;
  let stage;
  let temporaryPath;
  let publishedZip = false;
  let publishedChecksum = false;
  try {
    for (const outputPath of [finalPath, checksumPath]) {
      try {
        await lstat(outputPath);
        throw new Error(`Refusing to overwrite existing release artifact: ${outputPath}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    publicationStage = await mkdtemp(path.join(outputDirectory, '.stayfast-candidate-'));
    stage = path.join(publicationStage, 'contents');
    temporaryPath = path.join(publicationStage, zipName);
    await mkdir(stage);
    for (const file of packageFiles) {
      const target = path.join(stage, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(distDir, file), target);
    }
    await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync('zip', ['-X', '-q', temporaryPath, ...packageFiles], { cwd: stage });
    const entries = execFileSync('unzip', ['-Z1', temporaryPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort();
    if (
      entries.length !== packageFiles.length ||
      entries.some((entry, index) => entry !== packageFiles[index])
    ) {
      throw new Error('Packaged ZIP contents differ from the built resource allowlist');
    }
    const packedManifest = JSON.parse(
      execFileSync('unzip', ['-p', temporaryPath, 'manifest.json'], { encoding: 'utf8' })
    );
    if (JSON.stringify(packedManifest) !== JSON.stringify(manifest))
      throw new Error('Packaged manifest failed verification');
    await link(temporaryPath, finalPath);
    publishedZip = true;
    await writeFile(
      checksumPath,
      `${createHash('sha256')
        .update(await readFile(finalPath))
        .digest('hex')}  ${zipName}\n`,
      { flag: 'wx' }
    );
    publishedChecksum = true;
  } catch (error) {
    if (publishedZip) await rm(finalPath, { force: true });
    if (publishedChecksum) await rm(checksumPath, { force: true });
    throw error;
  } finally {
    if (publicationStage) await rm(publicationStage, { recursive: true, force: true });
  }
  const digest = createHash('sha256')
    .update(await readFile(finalPath))
    .digest('hex');
  return { path: finalPath, digest, version: packageJson.version, fileCount: packageFiles.length };
}

function usage() {
  process.stdout.write(
    'Usage: npm run package:candidate -- --browser <chrome|firefox|safari> --mode <store|development|replacement|resources> [--out-dir DIR] [--production-public-key FILE --production-id ID]\n'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) usage();
    else {
      const result = await packageCandidate({
        browser: args.browser,
        mode: args.mode,
        outDir: args['out-dir'],
        productionPublicKeyPath: args['production-public-key'],
        productionId: args['production-id'],
      });
      process.stdout.write(
        `version=${result.version}\nfiles=${result.fileCount}\nsha256=${result.digest}\npackage=${result.path}\n`
      );
    }
  } catch (error) {
    process.stderr.write(`Package failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
