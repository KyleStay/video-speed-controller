# Identity-aware release candidates

This candidate advances the extension source/package version to **0.11.6** with
options autosave and Revert, retaining the already-published 0.11.5 playback engine.
It is a local release candidate; the version bump does not
establish that every unpublished draft or store upload has been inspected.
`manifest.json` remains a build-time placeholder, and `package.json` plus the
root `package-lock.json` are aligned at 0.11.6 without running `npm version`.

The canonical [Chrome Web Store listing](https://chromewebstore.google.com/detail/stayfast-video-speed-cont/inojpjdelhcipcommmoibfahlgkekijo)
showed 0.11.5, publisher staytechco, updated October 23, 2026. The independently
verified Google-served 0.11.5 CRX3 has SHA-256
`74c09bfce2dff34a410d5fd85e53e031a9480a2de6cfafcb1686063f0a516c77`.
Its runtime/resources match the earlier delivered 0.11.5 candidate; the newer
canonical README and three options files add autosave/Revert. Private uploaded
versions remain unverified. Build any distribution artifact from the final
reviewed default-branch SHA, preserving the public-key identity checks below.

Run minified browser builds first:

```sh
npm run build:release:browsers
npm run build:release:safari
```

Then package Chrome or Firefox modes with:

```sh
npm run package:candidate -- --browser chrome --mode store
npm run package:candidate -- --browser chrome --mode development
npm run package:candidate -- --browser firefox --mode store
npm run package:candidate -- --browser firefox --mode development
npm run package:candidate -- --browser firefox --mode replacement
npm run package:candidate -- --browser safari --mode resources
```

The Chrome `store` ZIP has the normal product name and no manifest `key`; it is
an upload candidate for review against the existing listing and does not claim
that a sideloaded copy keeps the store extension ID. Chrome `development`
embeds only the retained public half of a generated keypair. Its stable
unpacked ID is `jhkigijhcbfmndinioedenfmjegefgeb`; the temporary private half
was discarded and is never packaged. Chrome `replacement` fails closed unless
the supplied public key derives the one known historical listing ID,
`inojpjdelhcipcommmoibfahlgkekijo`. An officially served 0.11.4 CRX3 first established
that public signing identity. On October 23, 2026 the package's RSA signature,
public-key-derived ID and signed header ID were verified; independent OpenSSL
verification also rejected a modified payload. The public SPKI PEM's SHA-256
is `d79a65b35186e3a2881d255c6f6f1e77d6a5129abe69cafb0b22923ef5dafec3`.
The earlier handoff included a same-ID 0.11.5 replacement ZIP, with
SHA-256 `f778c86cd005a1e3fd8090c13a3d5e4bc98e2f5d2d9e0fa6f6d45f3a598b57d1`.
Only public signing identity was recovered; installed state and actual browser
replacement remain unrun. No private key is needed or requested.

Firefox store and replacement packages retain
`stayfast-video@staytech.co`; development uses the separate
`stayfast-development@staytech.co`. The packaging check confirms version
equality between `package.json` and the local built manifest only. It does not
query AMO, verify a signed update, or prove that an installed build has that ID.

Safari packages only the built Web Extension resources. Native identifiers
remain `co.staytech.stayfast` and `co.staytech.stayfast.Extension` under team
`TF2BG2VDPD`. This resource package does not create or sign an app. Before a
signed Safari distribution, align and validate the native marketing/build
versions (`MARKETING_VERSION` currently remains on historical metadata); this
candidate does not invent a native build number or change native identity.

These modes do not implement runtime extension-to-extension arbitration or
assume that one extension ID can message another. A higher version under a new
ID does not supersede an older production install. Without cooperation from
the existing installation, an extension update cannot force that install to
disable or uninstall itself. Packaging does not publish, upload, install, or
commit anything.

For future extension publications, prepare a normal first-publication package
without inventing an existing production identity. Once the listing exists,
request and record its authoritative public URL and ID before future updates
or same-ID candidates. Retrieve a public key from the trusted dashboard or
verify that exact item's official signed package; never request private keys.
Packaging adds no page-visible product/version/channel markers, takeover bus,
telemetry or exposed resources. Existing extension UI can still be observable.
