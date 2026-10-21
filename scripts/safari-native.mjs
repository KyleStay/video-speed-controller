import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'apple', 'StayFast Video', 'StayFast Video.xcodeproj');
const platforms = {
  'ios-simulator': {
    scheme: 'StayFast Video (iOS)',
    destination: 'generic/platform=iOS Simulator',
  },
  ios: { scheme: 'StayFast Video (iOS)', destination: 'generic/platform=iOS' },
  macos: { scheme: 'StayFast Video (macOS)', destination: 'generic/platform=macOS' },
};

export function nativeBuildArguments(platform, version, derivedDataPath) {
  const target = platforms[platform];
  if (!target) {
    throw new Error(`Unknown Safari platform: ${platform}. Use ios-simulator, ios, or macos.`);
  }
  return [
    '-project',
    project,
    '-scheme',
    target.scheme,
    '-configuration',
    'Release',
    '-destination',
    target.destination,
    '-derivedDataPath',
    derivedDataPath,
    `MARKETING_VERSION=${version}`,
    ...(platform === 'ios-simulator'
      ? ['CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']
      : ['CODE_SIGNING_ALLOWED=NO']),
    'build',
  ];
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

export function buildSafariNative(args = process.argv.slice(2)) {
  const platform = args.find((arg) => arg.startsWith('--platform='))?.slice(11) || 'ios-simulator';
  const unknown = args.find((arg) => !arg.startsWith('--platform='));
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}`);
  }
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const derivedData = path.join(root, 'build', 'safari', platform);
  const buildArgs = nativeBuildArguments(platform, version, derivedData);
  // Always rebuild shared resources before Xcode copies them into the extension.
  run(process.execPath, [path.join(root, 'scripts/build.mjs'), '--browser=safari'], {
    ...process.env,
    RELEASE: '1',
  });
  run('xcodebuild', buildArgs);
  console.log(`Safari ${platform} build: ${path.join(derivedData, 'Build', 'Products')}`);
  console.log(
    platform === 'ios-simulator'
      ? 'Simulator app signed ad hoc. Device installation and distribution require Apple signing.'
      : 'Unsigned local build only. Device installation and distribution require Apple signing.'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildSafariNative();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
