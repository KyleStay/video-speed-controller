# Synthetic local media

These assets contain a generated moving test pattern and 440 Hz tone. They contain
no downloaded site content. The HLS VOD has three two-second fMP4 segments, H.264
Baseline video at 160×90/24 fps, and AAC audio. `fallback.mp4` remuxes that same
encoded content; `clip.webm` reencodes it as VP8/Opus. Tests start muted. Mute flags
and successful decoding provide no acoustic-continuity evidence.

The following commands generate the files in a fresh `tests/e2e/mock-media`
directory using an existing FFmpeg installation. CI uses the retained assets and
does not require FFmpeg, downloads, an account or a remote media endpoint.

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=160x90:rate=24 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 6 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -g 24 -sc_threshold 0 -c:a aac -b:a 48k -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_segment_filename tests/e2e/mock-media/segment-%02d.m4s tests/e2e/mock-media/playlist.m3u8
ffmpeg -hide_banner -loglevel error -i tests/e2e/mock-media/playlist.m3u8 -c copy -movflags +faststart tests/e2e/mock-media/fallback.mp4
ffmpeg -hide_banner -loglevel error -i tests/e2e/mock-media/fallback.mp4 -c:v libvpx -b:v 100k -c:a libopus -b:a 32k tests/e2e/mock-media/clip.webm
```

The manifest contains relative local names only. The shared fixture server serves
an explicit resource allowlist and intentionally returns404 for
`/mock-media/unavailable.mp4`. Route tests check MIME types, local references and
the missing-media path. FFprobe validated the HLS streams/duration and FFmpeg
decoded the complete HLS fixture without errors during creation; browser/native
decoding remains a separate runtime check.

`live/` contains a 24-second version of the same generated pattern/tone. The
MediaSource fixture fetches its init and twelve two-second segments from an
explicit local allowlist. It appends real bytes, removes expired media and uses
`setLiveSeekableRange` to move an eight-second native window. It aborts pending
fetches and buffer updates and revokes its object URL when removed or switched
to a recording. This is decoded MediaSource coverage, not live-HLS acceptance.
`recording.m3u8` records the complete generated asset sequence.

```sh
mkdir -p tests/e2e/mock-media/live
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=160x90:rate=24 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 24 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -g 24 -sc_threshold 0 -c:a aac -b:a 48k -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_segment_filename tests/e2e/mock-media/live/segment-%02d.m4s tests/e2e/mock-media/live/recording.m3u8
```
