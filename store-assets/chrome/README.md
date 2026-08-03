# Chrome Web Store graphic assets

Upload these files in the order shown:

1. `screenshot-1-control-1280x800.png`
2. `screenshot-2-popup-1280x800.png`
3. `screenshot-3-settings-1280x800.png`
4. `small-promo-440x280.png`
5. `marquee-promo-1400x560.png` (optional, recommended)

The generator also writes the Chrome-compliant 128×128 store icon to
`src/assets/icons/icon128.png`, with 96×96 artwork and transparent padding. The
dashboard reads that icon from `assets/icons/icon128.png` in the uploaded ZIP.

All assets use the dimensions required by the Chrome Web Store. The generator
is `scripts/generate-chrome-store-assets.swift`. Run it from the repository root
after any visual branding change:

```sh
swift -module-cache-path /tmp/stayfast-swift-cache \
  scripts/generate-chrome-store-assets.swift
```

The screenshots are faithful listing compositions derived from the extension's
controller, popup, and settings UI. Before uploading, compare them with the
current release build and regenerate or replace any image whose visible UI or
feature claims have changed.
