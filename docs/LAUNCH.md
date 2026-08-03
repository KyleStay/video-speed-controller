# StayFast Video launch plan

StayFast Video is a StayTech flagship for playback power users. The launch
promise is **Every video. Your speed.** Reliability and honest platform claims
take priority over announcing every browser on the same day.

## Launch gates

### 1. Identity and rights

- Clear “StayFast Video” across browser stores, relevant domains, and trademark
  records.
- Use original StayTech icons, wordmarks, screenshots, and promotional art.
- Preserve `LICENSE` in every distributed package.
- Make the upstream credit available in the store listing, product About
  experience, and distributed license.
- Publish the public StayTech source repository before store submission.

### 2. Product readiness

- Complete a cohesive popup, settings, controller, and onboarding refresh.
- Verify keyboard navigation, readable contrast, reduced-motion behavior, and
  screen-reader labels.
- Pass lint, test, release-build, and packaging checks.
- Run repeatable and manual compatibility checks against the release package.
- Confirm that permissions are limited to the product's single purpose.

### 3. Privacy and support

- Publish [`PRIVACY.md`](../PRIVACY.md) at a stable public URL.
- Ensure browser-store privacy disclosures match the published policy.
- Publish a support channel, troubleshooting guide, and response expectations.
- Confirm there are no analytics, advertising SDKs, accounts, or StayTech
  network requests in the release.

### 4. Browser releases

Build from shared source, but treat each package as its own release candidate:

1. Verify and submit the Chrome package.
2. Verify and submit the Firefox package.
3. Keep Safari experimental until a tested MAIN-world bootstrap and blank-frame
   strategy replace the unsupported manifest behavior.
4. Only then verify and submit the Safari web extension and containing Apple app.
5. Announce a platform only after its listing is approved and installable.

Document browser-specific differences rather than claiming parity before it is
tested.

## Launch assets

- Product page at <https://staytech.co/stayfast>
- Browser-store title, descriptions, category, and disclosures
- Original icon set and store graphics
- Product screenshots showing speed, precision, shortcuts, and site rules
- Privacy policy, source, license, acknowledgments, and support links
- Release notes and a verified compatibility matrix

## Six-month success review

The primary goal is StayTech credibility. Review:

- Rating quality and recurring review themes
- Reliability and compatibility regressions
- Support responsiveness and resolution quality
- Release cadence and public repository maintenance
- Verified feature parity across released browsers
- Retention or adoption only when measurable without user tracking
