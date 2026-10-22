# Apple precision scrubbing

Researched 2026-10-22. Primary sources distinguish the documented gesture from
implementation choices that Apple did not publicly specify.

## What Apple documented

The iOS 5 iPhone guide, Music, printed page 77, describes starting on the
playhead, dragging horizontally to choose a time, and moving the held finger
downward to reduce the scrub rate. The same instructions cover songs,
podcasts, and audiobooks. Its Videos screenshot, printed page 126, places the
timeline at the top of the player. Thus downward movement takes the finger
away from that rail and into the content. The guide does not specify a timed
long press or numeric distance thresholds. [Apple iOS 5 guide](https://cdsassets.apple.com/live/6GJYWVAV/user/ma1622_iphone_ios5_user_guide.pdf)

The iOS 6 guide repeats the downward motion in Music, printed page 59. Its
Videos screenshot, printed page 78, also has a top timeline. Neither section
explains how to bring the finger back to the rail or how cancellation works.
[Apple iOS 6 guide](https://cdsassets.apple.com/live/6GJYWVAV/user/ma1658_iphone_ios6_user_guide.pdf)

Apple's earlier iOS 3.1 guide explicitly applies the same vertical adjustment
to **video** playback, printed page 82; its Music instructions, printed page
76, say farther downward movement progressively slows scrubbing. This is
useful corroboration of the old video gesture, rather than inferring video
behavior only from the Music chapters. [Apple iOS 3.1 guide](https://cdsassets.apple.com/live/6GJYWVAV/user/ma616_iphone_ios3_1_user_guide.pdf)

Apple's later Podcasts announcement explicitly names the modes: Hi-Speed,
Half-Speed, Quarter-Speed, and Fine Scrubbing. The sequence is to keep hold
of the playback position, move the finger over the artwork to select a mode,
and move horizontally to seek. This corroborates the mode names and the
two-axis interaction, but is a 2022 description, not proof of every detail
in iOS 5 or 6. [Apple Podcasts announcement](https://podcasters.apple.com/4359-ios-16-whats-new-for-apple-podcasts)

## What the primary technical description adds

Apple's patent EP2409214B1 has a 2009 priority date. Figures 5K–5O and method
600 describe horizontal finger displacement driving playhead displacement at
a gain determined by perpendicular motion. Examples include half, quarter,
and **one-eighth** gain for Fine. A quarter-width horizontal finger movement
at quarter gain moves the playhead one-sixteenth of the bar. The disclosure
also describes displaying the active mode and ending scrubbing when contact
ends, with audio/video playback continuing at the selected position.

These are example embodiments, including alternatives. They do **not** prove
the exact shipped iOS 5/6 thresholds, a tenth-speed Fine mode, fixed hold
duration, or a return-to-rail catch-up rule. Do not label StayFast's existing
44/88/132 CSS-pixel thresholds or 0.1 gain as Apple's exact algorithm.
[Apple patent text and figures](https://patents.google.com/patent/EP2409214B1/en),
[EPO publication](https://data.epo.org/publication-server/rest/v1.2/patents/EP2409214NWB1/document.pdf)

## Recommended StayFast interaction

These are product recommendations grounded in the gesture above, with the
unspecified details chosen for predictable interaction:

1. Start a captured drag immediately on the playhead's full touch target;
   preserve the current selected time when grabbing it. No waiting period is
   needed. Keep tap-to-seek available elsewhere on the rail.
2. With the rail at the **bottom**, let the held finger travel **upward into
   the video** for finer control. Supporting both vertical directions is useful
   when there is room, but downward-only behavior would be inaccessible here.
3. Show a persistent, readable active-mode label during the drag: Normal,
   Half, Quarter, Fine. Show selected time with fractional precision in Fine
   mode so short clips reveal the difference. Mode labels must describe seek
   sensitivity separately from playback speed.
4. Apply each horizontal increment at the current gain, keep the playhead
   selected time steady during purely vertical movement, and change modes
   without remapping all earlier horizontal travel. Average gain over a
   diagonal segment to avoid dependence on delivered event frequency.
5. Permit returning toward the rail within the same drag to regain coarse
   control. Preserve the selected time during vertical return; this is an
   explicit StayFast stability rule, **not a verified Apple return rule**.
6. Lifting commits the latest delivered coordinates. Preserve the prior
   paused/playing state; cancellation restores the gesture's starting time.
   These lifecycle choices must remain guarded against a changed source or
   closed presentation. Apple manuals do not specify cancellation behavior.

For verification, compare equal horizontal drags at each reachable height in
one continuous genuine touch gesture, including vertical-only motion, return,
release, and cancellation. Test a sufficiently long seekable clip as well as
a short feed video: a 0.4-second change rounded to whole seconds can appear
unchanged even when the precision math is working. Confirm the same gesture
works in the actual X inline and expanded interfaces, not only StayFast's
owned player fixture.

No iOS 5/6 device or simulator was exercised for this research. Exact historical
thresholds, pause behavior, and vertical return mapping remain unverified.
