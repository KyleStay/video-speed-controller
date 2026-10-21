import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  createTestFlightPlan,
  parseTestFlightArguments,
} from '../../../scripts/safari-testflight.mjs';

const root = process.cwd();
const plan = (action = 'prepare', build = '1') =>
  createTestFlightPlan({ action, build, version: '0.11.3' });

function plistValue(source, key, value) {
  expect(source).toMatch(new RegExp(`<key>${key}</key>\\s*<string>${value}</string>`));
}

describe('Safari TestFlight release tooling', () => {
  it('defaults to a local archive and export with build 1', () => {
    expect(parseTestFlightArguments()).toEqual({ action: 'prepare', build: '1' });
    expect(plan().commands).toHaveLength(3);
    expect(plan().commands.at(-1).args).toContain(
      path.join(root, 'apple', 'ExportOptions.TestFlight.plist')
    );
    expect(plan().commands.at(-1).args).not.toContain(
      path.join(root, 'apple', 'ExportOptions.TestFlightUpload.plist')
    );
  });

  it('accepts explicit actions and an integer build override', () => {
    expect(parseTestFlightArguments(['archive', '--build=27'])).toEqual({
      action: 'archive',
      build: '27',
    });
    expect(parseTestFlightArguments(['--build=2'])).toEqual({ action: 'prepare', build: '2' });
  });

  it.each(['0', '-1', '1.5', 'NaN', '', '01', '0x10', '9007199254740992'])(
    'rejects invalid build number %j before any command',
    (build) => {
      expect(() => parseTestFlightArguments([`--build=${build}`])).toThrow('positive integer');
    }
  );

  it('rejects unknown and repeated command arguments', () => {
    expect(() => parseTestFlightArguments(['publish'])).toThrow('Unknown action');
    expect(() => parseTestFlightArguments(['archive', '--build=1', '--build=2'])).toThrow(
      'repeated argument'
    );
    expect(() => parseTestFlightArguments(['--team=OTHER'])).toThrow('Unknown or repeated');
  });

  it('rebuilds minified Safari resources before an automatically signed device archive', () => {
    const archive = plan('archive', '7');
    expect(archive.commands).toHaveLength(2);
    expect(archive.commands[0]).toMatchObject({
      command: process.execPath,
      args: [path.join(root, 'scripts', 'build.mjs'), '--browser=safari'],
      env: { RELEASE: '1' },
    });
    expect(archive.commands[1].args).toEqual(
      expect.arrayContaining([
        '-allowProvisioningUpdates',
        '-project',
        path.join(root, 'apple', 'StayFast Video', 'StayFast Video.xcodeproj'),
        'StayFast Video (iOS)',
        'Release',
        'generic/platform=iOS',
        'DEVELOPMENT_TEAM=TF2BG2VDPD',
        'CODE_SIGN_STYLE=Automatic',
        'CODE_SIGNING_ALLOWED=YES',
        'MARKETING_VERSION=0.11.3',
        'CURRENT_PROJECT_VERSION=7',
      ])
    );
    expect(archive.commands[1].args.at(-1)).toBe('archive');
    expect(archive.commands[1].args).not.toContain('CODE_SIGNING_ALLOWED=NO');
    expect(archive.archive).toContain('0.11.3-build7');
  });

  it('exports an existing archive without rebuilding or changing version', () => {
    const exported = plan('export', '4');
    expect(exported.commands).toHaveLength(1);
    expect(exported.commands[0].args).toEqual([
      '-allowProvisioningUpdates',
      '-exportArchive',
      '-archivePath',
      exported.archive,
      '-exportPath',
      exported.exportDirectory,
      '-exportOptionsPlist',
      path.join(root, 'apple', 'ExportOptions.TestFlight.plist'),
    ]);
  });

  it('uses upload options only for the explicit upload action', () => {
    const upload = plan('upload');
    expect(upload.commands).toHaveLength(1);
    expect(upload.commands[0].args).toContain(upload.uploadDirectory);
    expect(upload.commands[0].args).toContain(
      path.join(root, 'apple', 'ExportOptions.TestFlightUpload.plist')
    );
    for (const action of ['prepare', 'archive', 'export']) {
      expect(JSON.stringify(plan(action).commands)).not.toContain('TestFlightUpload.plist');
    }
  });

  it('preserves version/build during export and allows automatic distribution signing', () => {
    for (const [file, destination] of [
      ['ExportOptions.TestFlight.plist', 'export'],
      ['ExportOptions.TestFlightUpload.plist', 'upload'],
    ]) {
      const source = readFileSync(path.join(root, 'apple', file), 'utf8');
      plistValue(source, 'destination', destination);
      plistValue(source, 'method', 'app-store-connect');
      plistValue(source, 'signingStyle', 'automatic');
      plistValue(source, 'teamID', 'TF2BG2VDPD');
      expect(source).toMatch(/<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/);
      expect(source).toMatch(/<key>uploadSymbols<\/key>\s*<true\/>/);
    }
  });

  it('leaves uploading out of the default npm command', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['testflight:safari']).toBe('node scripts/safari-testflight.mjs');
    expect(pkg.scripts['testflight:safari:upload']).toBe(
      'node scripts/safari-testflight.mjs upload'
    );
  });

  it('rejects package versions that App Store Connect cannot accept', () => {
    expect(() => createTestFlightPlan({ version: '0.11.3-beta.1' })).toThrow('numeric components');
  });
});
