import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const team = 'TF2BG2VDPD';
const actions = new Set(['prepare', 'archive', 'export', 'upload']);
const project = path.join(root, 'apple', 'StayFast Video', 'StayFast Video.xcodeproj');

export function parseTestFlightArguments(args = []) {
  const remaining = [...args];
  const action = remaining[0] && !remaining[0].startsWith('--') ? remaining.shift() : 'prepare';
  if (!actions.has(action)) {
    throw new Error(`Unknown action: ${action}. Use prepare, archive, export, or upload.`);
  }
  let build = '1';
  let sawBuild = false;
  for (const argument of remaining) {
    if (!argument.startsWith('--build=') || sawBuild) {
      throw new Error(`Unknown or repeated argument: ${argument}`);
    }
    build = argument.slice('--build='.length);
    sawBuild = true;
  }
  if (!/^[1-9]\d*$/.test(build) || !Number.isSafeInteger(Number(build))) {
    throw new Error('--build must be a positive integer without leading zeros.');
  }
  return { action, build };
}

export function createTestFlightPlan({ action = 'prepare', build = '1', version }) {
  const options = parseTestFlightArguments([action, `--build=${build}`]);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      'The package version must contain three numeric components for App Store Connect.'
    );
  }
  const directory = path.join(
    root,
    'build',
    'safari',
    'testflight',
    `${version}-build${options.build}`
  );
  const archive = path.join(directory, 'StayFast Video.xcarchive');
  const exportDirectory = path.join(directory, 'Export');
  const uploadDirectory = path.join(directory, 'Upload');
  const uploadAttempt = path.join(directory, 'upload-attempt.json');
  const commands = [];

  if (action === 'prepare' || action === 'archive') {
    commands.push({
      command: process.execPath,
      args: [path.join(root, 'scripts', 'build.mjs'), '--browser=safari'],
      env: { RELEASE: '1' },
    });
    commands.push({
      command: 'xcodebuild',
      args: [
        '-allowProvisioningUpdates',
        '-project',
        project,
        '-scheme',
        'StayFast Video (iOS)',
        '-configuration',
        'Release',
        '-destination',
        'generic/platform=iOS',
        '-derivedDataPath',
        path.join(directory, 'DerivedData'),
        '-archivePath',
        archive,
        `DEVELOPMENT_TEAM=${team}`,
        'CODE_SIGN_STYLE=Automatic',
        'CODE_SIGNING_ALLOWED=YES',
        `MARKETING_VERSION=${version}`,
        `CURRENT_PROJECT_VERSION=${options.build}`,
        'archive',
      ],
    });
  }

  if (action === 'prepare' || action === 'export' || action === 'upload') {
    commands.push({
      command: 'xcodebuild',
      args: [
        '-allowProvisioningUpdates',
        '-exportArchive',
        '-archivePath',
        archive,
        '-exportPath',
        action === 'upload' ? uploadDirectory : exportDirectory,
        '-exportOptionsPlist',
        path.join(
          root,
          'apple',
          action === 'upload'
            ? 'ExportOptions.TestFlightUpload.plist'
            : 'ExportOptions.TestFlight.plist'
        ),
      ],
    });
  }

  return {
    ...options,
    version,
    directory,
    archive,
    exportDirectory,
    uploadDirectory,
    uploadAttempt,
    commands,
  };
}

function run({ command, args, env = {} }) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status ?? 'unknown'}. No automatic retry was attempted.`
    );
  }
}

export function runSafariTestFlight(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: node scripts/safari-testflight.mjs [prepare|archive|export|upload] [--build=1]'
    );
    console.log(
      'Default prepare archives and exports locally. Only explicit upload submits to App Store Connect.'
    );
    return;
  }
  const options = parseTestFlightArguments(args);
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const plan = createTestFlightPlan({ ...options, version });
  if (plan.action === 'export' || plan.action === 'upload') {
    if (!existsSync(path.join(plan.archive, 'Info.plist'))) {
      throw new Error(
        `Archive not found: ${plan.archive}. Run archive or prepare for this build first.`
      );
    }
  }
  if (plan.action === 'upload') {
    if (
      !existsSync(plan.exportDirectory) ||
      !readdirSync(plan.exportDirectory).some((file) => file.endsWith('.ipa'))
    ) {
      throw new Error(
        'A successful local .ipa export is required before upload. Run export for this build first.'
      );
    }
    if (existsSync(plan.uploadAttempt)) {
      throw new Error(
        `An upload was already attempted for this version/build. Check App Store Connect before retrying. Attempt record: ${plan.uploadAttempt}`
      );
    }
    mkdirSync(plan.directory, { recursive: true });
    writeFileSync(
      plan.uploadAttempt,
      `${JSON.stringify(
        { version, build: plan.build, startedAt: new Date().toISOString(), status: 'attempted' },
        null,
        2
      )}\n`,
      { flag: 'wx' }
    );
  }
  for (const command of plan.commands) {
    run(command);
  }
  if (plan.action === 'upload') {
    writeFileSync(
      plan.uploadAttempt,
      `${JSON.stringify(
        { version, build: plan.build, completedAt: new Date().toISOString(), status: 'submitted' },
        null,
        2
      )}\n`
    );
    console.log(
      'Submitted to App Store Connect. Confirm Apple processing and TestFlight eligibility before tester rollout.'
    );
  } else {
    console.log(`Local TestFlight artifacts: ${plan.directory}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runSafariTestFlight();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
