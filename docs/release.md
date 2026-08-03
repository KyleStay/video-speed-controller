# Release Process

## How versioning works

`package.json` is the single source of truth for the extension version. The checked-in `manifest.json` contains `"version": "0.0.0"` as a placeholder. At build time, `scripts/build.mjs` reads the version from `package.json` and writes it into `dist/manifest.json`.

## Build modes

| Command                 | Minified | Use case                     |
| ----------------------- | -------- | ---------------------------- |
| `npm run build`         | No       | Local development, debugging |
| `npm run build:release` | Yes      | CI, release packaging        |

Both modes inject the version from `package.json` into the manifest identically.

## Cutting a release

```bash
# 1. Bump version (creates a commit automatically)
npm version patch   # or minor, major

# 2. Run the Chrome release pipeline: clean -> lint -> test -> build -> zip
npm run release:chrome

# 3. Tag and push
git tag v$(node -p "require('./package.json').version")
git push origin main --tags

# 4. Create a draft GitHub release (requires gh CLI)
npm run release:github

# 5. Review the draft on GitHub, then publish
# 6. Upload release/stayfast-video-chrome-*.zip to the Chrome Web Store
```

## What `npm run release:chrome` does

1. **`clean`** -- removes `dist/` and `release/`
2. **`lint`** -- checks source and tests with ESLint
3. **`test`** -- runs the complete Vitest suite
4. **`build:release:chrome`** -- builds a minified Chrome package under
   `dist/chrome/`
5. **`package:chrome`** -- creates
   `release/stayfast-video-chrome-{version}.zip`:
   - Validates manifest version matches `package.json`
   - Excludes source maps and `.DS_Store`
   - Warns if the zip exceeds the Chrome Web Store 2 GB limit

## What `npm run release:github` does

- Verifies `gh` CLI is installed and authenticated
- Verifies the git tag exists
- Auto-generates release notes from commits since the previous tag
- Creates a **draft** release on GitHub with the zip attached
- Draft requires manual review before publishing

## Quality gates

| Hook       | Runs                                               | When                      |
| ---------- | -------------------------------------------------- | ------------------------- |
| Pre-commit | `lint-staged` (eslint + prettier on changed files) | Every commit              |
| Pre-push   | `npm run lint` + `npm test`                        | Every push                |
| CI         | lint, Chrome release build, test, package ZIP      | Push/PR to main or master |

CI uploads the versioned Chrome ZIP as an artifact, so every passing build on
the maintained branches produces a release candidate.
