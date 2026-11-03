// Original scope is separate from run results. Changes require a visible scope review.
const origin = 'test-results/twitter-iphone-rate-repair/loop151/acceptance-matrix157.json';
const scopeAudit =
  'test-results/twitter-iphone-rate-repair/loop151/measurement-reuse-and-remaining-acceptance190.json';
const common = {
  platform: 'physical-iphone-safari',
  environment: 'live-site',
  navigation: 'direct-post',
  sourceIdentity: null,
  requestedRate: null,
  minimumDurationMs: 0,
  minimumWraps: 0,
  presentation: 'inline',
  audioEvidence: 'not-required',
  requiredDistinctAssets: 1,
  startupAndTransitions: true,
};
const cases = [];
function add(id, description, requirements, reference = origin) {
  cases.push({ id, description, reference, requirements: { ...common, ...requirements } });
}
for (const post of ['2116631726629786057', '2115566875904237717']) {
  for (const rate of [2.1, 4]) {
    for (const audio of ['audible-smooth', 'muted']) {
      for (const presentation of ['inline', 'owned']) {
        add(
          `SF-TW-1-long-${post}-${rate}-${audio}-${presentation}`,
          'Full long-clip playback, including the first command and transitions',
          {
            sourceIdentity: post,
            requestedRate: rate,
            minimumDurationMs: 20000,
            presentation,
            audioEvidence: audio,
          }
        );
      }
    }
  }
}
for (const post of ['2116722286795669669', '2116843330541858960']) {
  for (const rate of [2.1, 4]) {
    for (const audio of ['audible-smooth', 'muted']) {
      for (const presentation of ['inline', 'owned']) {
        add(
          `SF-TW-1-loop-${post}-${rate}-${audio}-${presentation}`,
          'At least five actual wraps with advancing frames after the last wrap',
          {
            sourceIdentity: post,
            requestedRate: rate,
            minimumDurationMs: 20000,
            minimumWraps: 5,
            presentation,
            audioEvidence: audio,
          },
          scopeAudit
        );
      }
    }
  }
}
add(
  'SF-TW-1-baseline2',
  'Compare 2× playback on an affected post',
  {
    sourceIdentity: 'affected-post',
    requestedRate: 2,
    minimumDurationMs: 20000,
    audioEvidence: 'audible-smooth',
  },
  'docs/safari.md#open-twitter-regressions'
);
add(
  'SF-TW-1-saved-feed',
  'Saved 4× on five subsequent distinct feed assets, without speed input',
  {
    navigation: 'feed-scroll',
    sourceIdentity: 'five-subsequent-feed-assets',
    requestedRate: 4,
    minimumDurationMs: 20000,
    requiredDistinctAssets: 5,
    audioEvidence: 'audible-smooth',
  },
  scopeAudit
);
add(
  'SF-TW-1-lifecycle',
  'Pause, accurate seek, source replacement, paused and playing handback',
  {
    navigation: 'feed-scroll',
    sourceIdentity: 'affected-post',
    presentation: 'inline-and-owned',
  },
  scopeAudit
);
add(
  'SF-TW-2',
  'Picture swipe in normal feed; retain vertical scroll, pinch, controls and viewer cases',
  {
    navigation: 'feed-scroll',
    sourceIdentity: 'x-picture-wrapper',
  },
  'docs/safari.md#open-twitter-regressions'
);
add(
  'SF-TW-3',
  'Visible 44px mute action at 300px and responsive boundaries; preserve other actions',
  {
    navigation: 'feed-scroll',
    sourceIdentity: 'x-embedded-300px',
  },
  'docs/safari.md#open-twitter-regressions'
);
add(
  'SF-TW-4',
  'Same tweet and visible offset through repeated fullscreen entry/return and rotation, page and nested scroll',
  {
    navigation: 'feed-scroll',
    sourceIdentity: 'x-partial-video-down-feed',
    presentation: 'inline-and-owned',
  },
  'docs/safari.md#open-twitter-regressions'
);
add(
  'SF-IMAGEBOARD-DRAG',
  'Physical iPhone image-board drag regression',
  {
    navigation: 'live-page',
    sourceIdentity: 'image-board-expanded-video',
  },
  'test-results/twitter-iphone-rate-repair/loop151/DELIVERY38.json'
);

export const ACCEPTANCE_CASES = Object.freeze(
  cases.map((item) =>
    Object.freeze({
      ...item,
      requirements: Object.freeze(item.requirements),
    })
  )
);
