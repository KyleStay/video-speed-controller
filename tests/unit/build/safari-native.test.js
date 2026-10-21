import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { nativeBuildArguments } from '../../../scripts/safari-native.mjs';

const projectRoot = process.cwd();
const appleRoot = path.join(projectRoot, 'apple', 'StayFast Video');

describe('Safari native packaging', () => {
  it.each([
    ['ios-simulator', 'StayFast Video (iOS)', 'generic/platform=iOS Simulator'],
    ['ios', 'StayFast Video (iOS)', 'generic/platform=iOS'],
    ['macos', 'StayFast Video (macOS)', 'generic/platform=macOS'],
  ])(
    'builds %s without installing or requiring Apple credentials',
    (platform, scheme, destination) => {
      const args = nativeBuildArguments(platform, '2.3.4', '/tmp/stayfast-derived-data');
      expect(args).toContain(scheme);
      expect(args).toContain(destination);
      expect(args).toContain('MARKETING_VERSION=2.3.4');
      expect(args).toContain(`CODE_SIGNING_ALLOWED=${platform === 'ios-simulator' ? 'YES' : 'NO'}`);
      if (platform === 'ios-simulator') {
        expect(args).toContain('CODE_SIGN_IDENTITY=-');
      }
      expect(args).toContain('/tmp/stayfast-derived-data');
      expect(args.at(-1)).toBe('build');
    }
  );

  it('rejects unsupported platforms before invoking tools', () => {
    expect(() => nativeBuildArguments('watchos', '1.0.0', '/tmp/build')).toThrow(
      'Unknown Safari platform'
    );
  });

  it('keeps the supported OS baseline and shares generated extension resources', () => {
    const project = readFileSync(
      path.join(appleRoot, 'StayFast Video.xcodeproj/project.pbxproj'),
      'utf8'
    );
    expect(project).toContain('IPHONEOS_DEPLOYMENT_TARGET = 18.4;');
    expect(project).toContain('MACOSX_DEPLOYMENT_TARGET = 15.4;');
    expect(project).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
    for (const resource of [
      'manifest.json',
      'inject.js',
      'content-bridge.js',
      'ui',
      'styles',
      'assets',
    ]) {
      expect(project).toContain(`../../../dist/safari/${resource}`);
    }
  });

  it('includes explicit privacy and encryption metadata for all four native bundles', () => {
    const project = readFileSync(
      path.join(appleRoot, 'StayFast Video.xcodeproj/project.pbxproj'),
      'utf8'
    );
    expect(project.match(/PrivacyInfo\.xcprivacy in Resources/g)).toHaveLength(8);
    const privacy = readFileSync(path.join(appleRoot, 'PrivacyInfo.xcprivacy'), 'utf8');
    expect(privacy).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    for (const key of [
      'NSPrivacyTrackingDomains',
      'NSPrivacyCollectedDataTypes',
      'NSPrivacyAccessedAPITypes',
    ]) {
      expect(privacy).toMatch(new RegExp(`<key>${key}</key>\\s*<array/>`));
    }
    for (const target of ['iOS (App)', 'macOS (App)', 'iOS (Extension)', 'macOS (Extension)']) {
      const info = readFileSync(path.join(appleRoot, target, 'Info.plist'), 'utf8');
      expect(info).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    }
  });

  it('ships a full-size opaque iOS icon rendered from the shared vector mark', () => {
    const icon = readFileSync(
      path.join(
        appleRoot,
        'Shared (App)/Assets.xcassets/AppIcon.appiconset/universal-icon-1024@1x.png'
      )
    );
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
    expect(icon[25]).toBe(2); // PNG RGB; alpha is not accepted for iOS distribution icons.
  });

  it('keeps onboarding accessible and native messaging private', () => {
    const page = readFileSync(
      path.join(appleRoot, 'Shared (App)/Resources/Base.lproj/Main.html'),
      'utf8'
    );
    const controller = readFileSync(
      path.join(appleRoot, 'Shared (App)/ViewController.swift'),
      'utf8'
    );
    const handler = readFileSync(
      path.join(appleRoot, 'Shared (Extension)/SafariWebExtensionHandler.swift'),
      'utf8'
    );
    expect(page).toContain('lang="en"');
    expect(page).not.toContain('user-scalable=no');
    expect(page.replace(/\s+/g, ' ')).toContain('do not sync between devices');
    expect(controller).toContain('message.body as? String');
    expect(controller).not.toContain('as! String');
    expect(handler).not.toContain('os_log');
    expect(handler).not.toContain('"echo"');
  });
});
