import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import {
  packageCandidate,
  readChromePublicKey,
  selectManifest,
} from '../../../scripts/package-identity-candidate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const devPublicKey = readFileSync(
  path.join(root, 'release-keys/development-public-key.txt'),
  'utf8'
).trim();
const productionChromeId = 'inojpjdelhcipcommmoibfahlgkekijo';
const productionFirefoxId = 'stayfast-video@staytech.co';
const developmentFirefoxId = 'stayfast-development@staytech.co';
const packageOutput = mkdtempSync(path.join(tmpdir(), 'stayfast-package-test-'));
const sampleManifest = {
  name: 'StayFast Video: Speed Controller',
  version: '0.11.5',
  key: 'source placeholder should be removed',
  permissions: ['storage'],
  host_permissions: [],
  browser_specific_settings: { gecko: { id: 'source-id' } },
};

function derivedChromeId(key) {
  return [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
}

describe('identity-aware release candidate manifests', () => {
  it('keeps Chrome store output free of an unpacked development identity', () => {
    const selected = selectManifest({ manifest: sampleManifest, browser: 'chrome', mode: 'store' });
    expect(selected.version).toBe('0.11.5');
    expect(selected.name).toBe(sampleManifest.name);
    expect(selected).not.toHaveProperty('key');
    expect(selected.permissions).toEqual(sampleManifest.permissions);
  });

  it('pins the unpacked Chrome development ID to the retained public key', () => {
    const selected = selectManifest({
      manifest: sampleManifest,
      browser: 'chrome',
      mode: 'development',
      devPublicKey,
    });
    expect(selected.name).toMatch(/\(Development\)$/);
    expect(derivedChromeId(selected.key)).toBe('jhkigijhcbfmndinioedenfmjegefgeb');
    expect(selected.permissions).toEqual(sampleManifest.permissions);
  });

  it('blocks Chrome replacement without verified production identity inputs', () => {
    expect(() =>
      selectManifest({ manifest: sampleManifest, browser: 'chrome', mode: 'replacement' })
    ).toThrow(/verified production public key and --production-id/);
    expect(() =>
      selectManifest({
        manifest: sampleManifest,
        browser: 'chrome',
        mode: 'replacement',
        productionPublicKey: devPublicKey,
        productionId: productionChromeId,
      })
    ).toThrow(/does not match claimed ID/);
  });

  it('accepts only canonical RSA public keys and rejects malformed, non-RSA, and private inputs', () => {
    const developmentDer = Buffer.from(devPublicKey, 'base64');
    const developmentPem = createPublicKey({
      key: developmentDer,
      format: 'der',
      type: 'spki',
    }).export({ type: 'spki', format: 'pem' });
    expect(readChromePublicKey(devPublicKey)).toEqual(developmentDer);
    expect(readChromePublicKey(developmentPem.toString())).toEqual(developmentDer);

    expect(() => readChromePublicKey('@@@')).toThrow(/PEM or base64-encoded DER/);
    expect(() => readChromePublicKey(Buffer.from([1, 2, 3]).toString('base64'))).toThrow(
      /valid DER SubjectPublicKeyInfo/
    );
    expect(() =>
      readChromePublicKey(Buffer.concat([developmentDer, Buffer.from([0])]).toString('base64'))
    ).toThrow(/canonical SubjectPublicKeyInfo|valid DER SubjectPublicKeyInfo/);

    const { publicKey: ecPublicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecDer = ecPublicKey.export({ type: 'spki', format: 'der' });
    expect(() => readChromePublicKey(ecDer.toString('base64'))).toThrow(/must use RSA/);

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => readChromePublicKey(privatePem)).toThrow(/private-key PEM is not accepted/);
  });

  it('uses the existing Firefox ID for upload candidates and a separate development ID', () => {
    const store = selectManifest({ manifest: sampleManifest, browser: 'firefox', mode: 'store' });
    const replacement = selectManifest({
      manifest: sampleManifest,
      browser: 'firefox',
      mode: 'replacement',
    });
    const development = selectManifest({
      manifest: sampleManifest,
      browser: 'firefox',
      mode: 'development',
    });
    expect(store.browser_specific_settings.gecko.id).toBe(productionFirefoxId);
    expect(replacement.browser_specific_settings.gecko.id).toBe(productionFirefoxId);
    expect(development.browser_specific_settings.gecko.id).toBe(developmentFirefoxId);
    expect(development.name).toMatch(/\(Development\)$/);
  });

  it('preserves the built Safari resource manifest without injecting extension identity arbitration', () => {
    const safariManifest = { ...sampleManifest };
    delete safariManifest.key;
    const selected = selectManifest({
      manifest: safariManifest,
      browser: 'safari',
      mode: 'resources',
    });
    expect(selected).toEqual(safariManifest);
  });

  it('refuses to overwrite a previously packaged candidate and preserves both artifacts byte-for-byte', async () => {
    const first = await packageCandidate({
      browser: 'chrome',
      mode: 'store',
      outDir: packageOutput,
    });
    const zipBefore = readFileSync(first.path);
    const checksumPath = `${first.path}.sha256`;
    const checksumBefore = readFileSync(checksumPath);

    await expect(
      packageCandidate({ browser: 'chrome', mode: 'store', outDir: packageOutput })
    ).rejects.toThrow(/Refusing to overwrite existing release artifact/);

    expect(readFileSync(first.path)).toEqual(zipBefore);
    expect(readFileSync(checksumPath)).toEqual(checksumBefore);
  });

  it('packages the pinned development key and complete versioned assets without private key material', async () => {
    const result = await packageCandidate({
      browser: 'chrome',
      mode: 'development',
      outDir: packageOutput,
    });
    const manifest = JSON.parse(
      execFileSync('unzip', ['-p', result.path, 'manifest.json'], { encoding: 'utf8' })
    );
    const entries = execFileSync('unzip', ['-Z1', result.path], { encoding: 'utf8' })
      .trim()
      .split('\n');

    expect(manifest.version).toBe('0.11.5');
    expect(manifest.name).toMatch(/\(Development\)$/);
    expect(derivedChromeId(manifest.key)).toBe('jhkigijhcbfmndinioedenfmjegefgeb');
    expect(manifest.permissions).toEqual(['storage']);
    expect(entries).toContain('assets/icons/icon128.png');
    expect(entries.some((entry) => /private|release-key/i.test(entry))).toBe(false);
    for (const entry of entries) {
      const bytes = execFileSync('unzip', ['-p', result.path, entry]);
      expect(bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----'))).toBe(false);
      expect(bytes.includes(Buffer.from('-----BEGIN RSA PRIVATE KEY-----'))).toBe(false);
    }
  });

  it('preserves a checksum-only collision and does not publish a ZIP beside it', async () => {
    const checksumOnlyPath = path.join(packageOutput, 'stayfast-0.11.5-firefox-store.zip.sha256');
    const sentinel = Buffer.from('retain existing checksum artifact');
    writeFileSync(checksumOnlyPath, sentinel);

    await expect(
      packageCandidate({ browser: 'firefox', mode: 'store', outDir: packageOutput })
    ).rejects.toThrow(/Refusing to overwrite existing release artifact/);

    expect(readFileSync(checksumOnlyPath)).toEqual(sentinel);
    expect(() => readFileSync(checksumOnlyPath.replace(/\.sha256$/, ''))).toThrow();
  });
});

afterAll(() => rmSync(packageOutput, { recursive: true, force: true }));
