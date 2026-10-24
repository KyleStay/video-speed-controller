#!/usr/bin/env python3
"""Run offline CI in an owned source copy, preserving registered dist/releases."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_report(report, path):
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', action='store_true', help='print commands without running them')
    parser.add_argument('--output-root', type=Path, help='parent of a new, unique run directory')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    steps = [
        ('lint', ['node', 'node_modules/eslint/bin/eslint.js', 'src/**/*.js', 'tests/**/*.js']),
        ('build-chrome-firefox', ['node', 'scripts/build.mjs', '--all']),
        ('build-safari-resources', ['node', 'scripts/build.mjs', '--browser=safari']),
        ('unit-integration', ['node', 'node_modules/vitest/vitest.mjs', 'run',
                              '--configLoader=native', '--config', 'vitest.local-ci.config.mjs']),
        ('python-process-ownership', [sys.executable, 'tests/unit/e2e/browser-process-info.test.py']),
        ('package-chrome-firefox', ['node', 'scripts/package-release.js', '--all']),
    ]
    unrun = {
        'dependency-audit': 'Requires a fresh advisory service response; offline mode does not query it.',
        'browser-fixtures-and-controls': 'Use existing permitted local browser runners separately; no launch in offline CI.',
        'performance': 'Requires permitted local browser execution; compilation is not performance evidence.',
        'browser-basic-and-options': 'Requires permitted local browser execution.',
        'native-safari-and-phone': 'Requires native runtime/device access; resource builds are not runtime acceptance.',
    }
    if args.plan:
        print(json.dumps({'steps': steps, 'unrun': unrun}, indent=2))
        return 0
    if not (root / 'node_modules').is_dir():
        parser.error('Existing node_modules is required. This runner never installs dependencies.')
    output_parent = (args.output_root or root / 'test-results' / 'local-ci').resolve()
    output_parent.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix='run-', dir=output_parent))
    snapshot = output / 'source'
    snapshot.mkdir()
    names = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root
    ).decode().split('\0')
    inputs = {}
    for name in sorted(set(filter(None, names))):
        source = root / name
        if not source.exists():
            continue  # Respect tracked deletions in the current working tree.
        if source.is_symlink():
            raise RuntimeError(f'Source symlink requires explicit review before copying: {name}')
        if not source.is_file():
            continue
        before = digest(source)
        destination = snapshot / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if digest(destination) != before:
            raise RuntimeError(f'Source changed while copying: {name}')
        inputs[name] = before
    for name, expected in inputs.items():
        if digest(root / name) != expected:
            raise RuntimeError(f'Concurrent source change detected: {name}; run not started')
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    (snapshot / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
    config = """import original from './vitest.config.js';
export default { ...original, cacheDir: %s, test: { ...original.test,
  cache: false, fsModuleCachePath: %s } };
""" % (json.dumps(str(output / 'cache' / 'vite')), json.dumps(str(output / 'cache' / 'modules')))
    (snapshot / 'vitest.local-ci.config.mjs').write_text(config)
    env = {**os.environ, 'RELEASE': '1', 'npm_config_offline': 'true',
           'npm_config_update_notifier': 'false', 'PYTHONDONTWRITEBYTECODE': '1'}
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'source': str(root),
              'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
              'output': str(output), 'status': 'running',
              'steps': [{'name': name, 'command': command, 'status': 'unrun',
                         'reason': 'Not started.'} for name, command in steps], 'unrun': unrun}
    report_path = output / 'results.json'
    save_report(report, report_path)
    print(f'Local CI evidence: {output}', flush=True)
    interrupted = False
    for row in report['steps']:
        name, command = row['name'], row['command']
        if name == 'package-chrome-firefox' and any(
            previous['status'] != 'passed' for previous in report['steps']
            if previous['name'] == 'build-chrome-firefox'
        ):
            row['reason'] = 'Required resource build failed.'
        else:
            row.pop('reason', None)
            row['status'] = 'running'
            save_report(report, report_path)
            try:
                with (output / f'{name}.log').open('w') as log:
                    result = subprocess.run(command, cwd=snapshot, env=env, stdout=log, stderr=subprocess.STDOUT)
                row.update(exit_code=result.returncode,
                           status='passed' if result.returncode == 0 else 'failed')
            except OSError as error:
                row.update(status='failed', error=str(error))
            except KeyboardInterrupt:
                row.update(status='interrupted', reason='Interrupted before command completion.')
                interrupted = True
        save_report(report, report_path)
        print(f"{name}: {row['status']}", flush=True)
        if interrupted:
            break
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    failed = any(row['status'] != 'passed' for row in report['steps'])
    report['status'] = 'interrupted' if interrupted else 'failed' if failed else 'passed'
    save_report(report, report_path)
    return 130 if interrupted else int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
