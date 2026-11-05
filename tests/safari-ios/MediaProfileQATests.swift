import XCTest
import UIKit

/// Local, synthetic profiles. The opt-in page probe only observes native state.
@MainActor final class MediaProfileQATests: XCTestCase {
    struct Clip: Decodable {
        let key: Int, id: String, tag: String, source: String
        let owner: Int?, controlled: Bool, visible: Bool
        let paused: Bool?, muted: Bool?, rate: Double?, time: Double?, duration: Double?
        let live: Bool, ready: Int?, frames: Double?, presented: Double?, seekable: [Double]
        let track: Int?, cues: Int, mediaError: Int
        let rect: Bounds
        var decoded: Double { max(frames ?? 0, presented ?? 0) }
    }
    struct Bounds: Decodable { let x: Double, y: Double, width: Double, height: Double }
    struct Retired: Decodable { let key: Int, controlled: Bool }
    struct Detail: Decodable {
        let asset: Int?, mode: String?, phase: String?, advances: Int?, active: Int?, concurrent: Bool?
    }
    struct Fixture: Decodable { let resets: Int, pendingReset: Bool, errors: [String] }
    struct Child: Decodable { let key: Int, title: String, rect: Bounds, state: Snapshot? }
    struct Snapshot: Decodable {
        let url: String, document: String, profile: String, run: String, sequence: Int, trusted: Int
        let errors: [String], controllers: Int, media: [Clip], retired: [Retired]
        let fixture: Fixture?, detail: Detail?, children: [Child]?, pendingFrames: Int?
        let anchor: Bounds
        func clip(_ id: String = "mock-video", frame: Int? = nil) -> Clip? {
            if let frame {
                guard let children, children.indices.contains(frame) else { return nil }
                return children[frame].state?.clip(id)
            }
            return media.first { $0.id == id }
        }
    }
    enum Failure: Error { case check(String) }
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    var lastJSON = ""
    var profile = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        safari.activate()
    }
    override func tearDownWithError() throws {
        let state = XCTAttachment(string: lastJSON)
        state.name = profile + "-native-state"; state.lifetime = .keepAlways; add(state)
        let image = XCTAttachment(screenshot: safari.screenshot())
        image.name = profile + "-screen"; image.lifetime = .keepAlways; add(image)
        if testRun?.hasSucceeded == false {
            let tree = XCTAttachment(string: safari.debugDescription)
            tree.name = profile + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
        }
    }
    func require(_ value: Bool, _ message: String) throws {
        if !value { throw Failure.check(message) }
    }
    func tap(_ label: String) throws {
        let button = safari.buttons[label].firstMatch
        try require(button.exists || button.waitForExistence(timeout: 8), "Missing button: " + label)
        for _ in 0..<3 {
            if button.isHittable { break }
            if button.frame.minY > safari.frame.maxY - 120 { safari.swipeUp() }
            else if button.frame.maxY < 120 { safari.swipeDown() }
            else { break }
        }
        try require(button.isHittable, "Native target stayed covered: " + label)
        button.tap()
    }
    func decode() -> Snapshot? {
        let element = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Profile state: '")).firstMatch
        guard element.exists else { return nil }
        lastJSON = String(element.label.dropFirst("Profile state: ".count))
        return try? JSONDecoder().decode(Snapshot.self, from: Data(lastJSON.utf8))
    }
    @discardableResult func read() throws -> Snapshot {
        let before = decode()
        try tap("Read profile state")
        let deadline = Date().addingTimeInterval(10)
        var nextFrameRead = Date().addingTimeInterval(1)
        repeat {
            if let value = decode(), (value.document != before?.document || value.sequence > (before?.sequence ?? -1)), value.pendingFrames == 0 {
                try require(value.errors.isEmpty, "Page/CSP error: \(value.errors)")
                try require(value.retired.allSatisfy { !$0.controlled }, "Retired owner retained")
                for child in value.children ?? [] {
                    try require(child.state?.errors.isEmpty == true, "Frame telemetry/error")
                    try require(child.state?.retired.allSatisfy { !$0.controlled } == true, "Retired frame owner retained")
                }
                return value
            }
            if Date() >= nextFrameRead {
                try tap("Read profile state")
                nextFrameRead = Date().addingTimeInterval(1)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        throw Failure.check("Native snapshot missing, stale or incomplete: " + lastJSON)
    }
    @discardableResult func wait(_ message: String, timeout: TimeInterval = 25,
                                _ condition: (Snapshot) -> Bool) throws -> Snapshot {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let value = try read()
            if condition(value) { return value }
        } while Date() < deadline
        throw Failure.check(message + ": " + lastJSON)
    }
    func open(_ id: String) throws {
        profile = id
        guard let previous = decode(), var url = URLComponents(string: previous.url),
              url.scheme == "http", url.host == "127.0.0.1", url.port != nil,
              url.path == "/media-mocks.html" else {
            throw Failure.check("Open the native-qa loopback fixture first")
        }
        var query = (url.queryItems ?? []).filter { !["case", "entry", "navigation"].contains($0.name) }
        query.append(URLQueryItem(name: "case", value: id))
        query.append(URLQueryItem(name: "navigation", value: UUID().uuidString))
        url.queryItems = query
        guard let target = url.url else { throw Failure.check("Invalid local profile URL") }
        XCUIDevice.shared.system.open(target)
        let fresh = safari.staticTexts.matching(NSPredicate(format:
            "label BEGINSWITH 'Profile state: ' AND label CONTAINS %@ AND NOT (label CONTAINS %@)",
            "\"profile\":\"\(id)\"", previous.document)).firstMatch
        try require(fresh.waitForExistence(timeout: 20), "Fresh profile document unavailable")
        try wait("Fresh local profile did not load") { $0.profile == id && $0.document != previous.document }

    }
    @discardableResult func ready(_ id: String = "mock-video", frame: Int? = nil) throws -> Clip {
        let state = try wait("Controlled decoded media/captions unavailable: " + id) {
            guard let v = $0.clip(id, frame: frame) else { return false }
            return v.controlled && v.owner != nil && v.mediaError == 0 &&
                (v.tag == "IMG" || ((v.ready ?? 0) >= 1 && v.cues > 0))
        }
        return state.clip(id, frame: frame)!
    }
    @discardableResult func progress(_ id: String = "mock-video", frame: Int? = nil) throws -> Clip {
        let before = try ready(id, frame: frame)
        let state = try wait("Playback needs advancing native time and decoded frames: " + id) {
            guard let v = $0.clip(id, frame: frame), v.paused == false,
                  let t = v.time, let initial = before.time else { return false }
            let advanced = t > initial + 0.15 || (v.duration != nil && t < initial - 0.5)
            return v.key == before.key && v.decoded > before.decoded && advanced
        }
        return state.clip(id, frame: frame)!
    }
    func same(_ before: Clip, _ after: Clip) throws {
        try require(before.key == after.key && before.owner == after.owner && before.track == after.track,
                    "Media, controller or caption identity changed")
        try require(after.controlled && after.cues > 0, "Owner/captions not retained")
    }
    @discardableResult func faster(_ id: String = "mock-video", frame: Int? = nil) throws -> Double {
        let show = safari.buttons.matching(NSPredicate(format: "label == %@", "Show \(id) controls")).element(boundBy: frame ?? 0)
        if show.exists { show.tap() }
        let before = try ready(id, frame: frame)
        let state = try read()
        var x = before.rect.x, y = before.rect.y
        if let frame, let child = state.children?[frame] {
            x += child.rect.x; y += child.rect.y
        }
        // Align CSS and native coordinates using the same visible read button.
        // Safari's toolbar/content insets are not the WebView's AX frame origin.
        let anchor = safari.buttons["Read profile state"].frame
        x += anchor.minX - state.anchor.x
        y += anchor.minY - state.anchor.y
        let bounds = CGRect(x: x - 2, y: y - 2, width: before.rect.width + 4, height: before.rect.height + 4)
        let pills = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).allElementsBoundByIndex
        guard let pill = pills.first(where: { bounds.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY)) }) else {
            throw Failure.check("Speed control unavailable inside selected media: \(bounds)")
        }
        if !pill.isHittable {
            // WebKit exposes the picture as a changing duration label. Use the
            // observed media bounds for a genuine picture tap to reveal idle UI.
            safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: bounds.midX, dy: bounds.midY)).tap()
        }
        try require(pill.isHittable, "Selected player speed control stayed hidden")
        pill.tap()
        let chosen = abs((before.rate ?? 1) - 1.5) > 0.01 ? 1.5 : 2.0
        let option = safari.switches["Set playback speed to \(chosen == 1.5 ? "1.5" : "2") times"]
        try require(option.waitForExistence(timeout: 5), "Speed option unavailable")
        option.tap()
        let close = safari.buttons["Close speed controls"]
        if close.exists { close.tap() }
        try wait("Accepted rate did not change") { abs(($0.clip(id, frame: frame)?.rate ?? 0) - chosen) < 0.01 }
        return chosen
    }
    func play(_ id: String = "mock-video", frame: Int? = nil, label: String = "Play or pause") throws {
        if try ready(id, frame: frame).paused == true { try tap(label) }
        try progress(id, frame: frame)
    }
    func colorSamples(_ state: Snapshot, frame: Int, image: CGImage) throws -> Int {
        guard let child = state.children?[frame], let clip = child.state?.clip() else {
            throw Failure.check("Missing native frame for painting check")
        }
        let anchor = safari.buttons["Read profile state"].frame
        let x = child.rect.x + clip.rect.x + anchor.minX - state.anchor.x
        let y = child.rect.y + clip.rect.y + anchor.minY - state.anchor.y
        // Inspect the generated picture's middle band, clear of captions and
        // transport. White/black text and UI cannot satisfy this color check.
        let rect = CGRect(x: x + clip.rect.width * 0.1, y: y + clip.rect.height * 0.42,
                          width: clip.rect.width * 0.8, height: clip.rect.height * 0.22)
        try require(safari.frame.contains(rect), "Painting sample is outside the viewport")
        let scale = CGFloat(image.width) / safari.frame.width
        let pixels = CGRect(x: rect.minX * scale, y: rect.minY * scale,
                            width: rect.width * scale, height: rect.height * scale)
        guard let crop = image.cropping(to: pixels) else { throw Failure.check("Native screenshot crop unavailable") }
        var rgba = [UInt8](repeating: 0, count: 8 * 8 * 4)
        let drawn = rgba.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: 8, height: 8,
                bitsPerComponent: 8, bytesPerRow: 32, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(crop, in: CGRect(x: 0, y: 0, width: 8, height: 8))
            return true
        }
        try require(drawn, "Native screenshot pixels unavailable")
        return (0..<64).filter { index in
            let colors = [rgba[index * 4], rgba[index * 4 + 1], rgba[index * 4 + 2]]
            return Int(colors.max()!) - Int(colors.min()!) > 45 && colors.max()! > 100
        }.count
    }
    func requireConcurrentPictures() throws {
        var samples = [Int]()
        for attempt in 0..<3 {
            let state = try read()
            let screen = XCUIScreen.main.screenshot()
            guard let image = screen.image.cgImage else { throw Failure.check("Native screenshot unavailable") }
            samples = try [0, 1].map { try colorSamples(state, frame: $0, image: image) }
            print("NATIVE_PAINT \(profile) attempt=\(attempt) samples=\(samples)")
            let attachment = XCTAttachment(screenshot: screen)
            attachment.name = "concurrent-pictures-\(attempt)"; attachment.lifetime = .keepAlways; add(attachment)
            if samples.allSatisfy({ $0 >= 12 }) { return }
        }
        throw Failure.check("Concurrent native pictures were blank despite decoded counters: \(samples)")
    }
    func finish() throws {
        let state = try read()
        try require(state.trusted > 0, "No genuine device input recorded")
        print("NATIVE_PROFILE_PASS \(profile) \(lastJSON)")
    }
    func testLoopFeed() throws {
        try open("loop-feed")
        let original = try ready()
        let rate = try faster()
        try tap("Mute or unmute")
        try play()
        for quality in ["SD", "HD"] {
            try tap(quality); try play(); try same(original, ready())
        }
        for asset in 2...6 {
            try tap("Next clip")
            try wait("Next rendition not selected") { $0.clip()?.source.contains("asset=\(asset)&quality=hd") == true }
            try play(); try same(original, ready())
            let now = try ready()
            try require(now.muted == false && abs((now.rate ?? 0) - rate) < 0.01, "Mute/rate intent lost")
        }
        try finish()
    }
    func testAdaptiveWatch() throws {
        try open("adaptive-watch")
        let original = try ready()
        try tap("Use adaptive source"); try play()
        try require(ready().source.contains(".m3u8"), "Native HLS was not selected")
        try tap("Use file source"); try tap("LOW")
        try faster(); try play(); try same(original, ready()); try finish()
    }
    func testRenditionWatch() throws {
        try open("rendition-watch")
        let original = try ready(), rate = try faster()
        try tap("Queue site rate reset")
        // Polling the Read button creates fresh user gestures and would make
        // the delayed reset look like an intentional site speed command.
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let state = self.decode() else { return false }
            return state.fixture?.resets == 1 && abs((state.clip()?.rate ?? 0) - rate) < 0.01
        }, object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 15), .completed, lastJSON)
        try tap("Queue site rate reset"); try tap("LOW")
        try wait("Source replacement did not cancel stale reset") { $0.fixture?.pendingReset == false }
        try play(); try same(original, ready()); try finish()
    }
    func testPlaylistWatch() throws {
        try open("playlist-watch")
        let original = try ready(), rate = try faster()
        try tap("Choose unavailable source")
        try wait("Missing source did not report media failure") { !($0.fixture?.errors.isEmpty ?? true) }
        try tap("Use available source"); try play(); try same(original, ready())
        for asset in 2...3 {
            try tap("Next clip")
            try wait("Playlist source did not advance") { $0.clip()?.source.contains("asset=\(asset)") == true }
            try play(); try same(original, ready())
            try require(abs((ready().rate ?? 0) - rate) < 0.01, "Playlist rate intent lost")
        }
        try finish()
    }
    func posts(_ id: String) throws {
        try open(id)
        let original = try ready("original-video")
        try faster("original-video")
        try tap(id == "discussion-feed" ? "Crosspost clip" : "Repost clip")
        try ready("duplicate-video")
        let before = try read().media.filter { $0.tag == "VIDEO" }.map { $0.rate }
        let comment = safari.textViews["Comment"]
        comment.tap(); comment.typeText("sdd comment")
        try tap("Read profile state") // Dismiss author input before playback controls.
        try require(read().media.filter { $0.tag == "VIDEO" }.map { $0.rate } == before, "Typing changed rates")
        try tap("Add embedded clip")
        try ready(frame: 0); try faster(frame: 0)
        let play = safari.buttons.matching(NSPredicate(format: "label == 'Play video'")).allElementsBoundByIndex.last!
        play.tap(); try progress(frame: 0)
        try require(read().media.filter { $0.tag == "VIDEO" }.map { $0.rate } == before, "Frame changed parent rates")
        try tap("Remove repost")
        try wait("Duplicate owner retained") { $0.clip("duplicate-video") == nil && $0.children?.count == 1 }
        if id == "post-viewer" {
            try ready("post-animation")
            try tap("Open post viewer"); try same(original, ready("original-video"))
            try tap("Close post viewer"); try same(original, ready("original-video"))
        }
        try finish()
    }
    func testDiscussionFeed() throws { try posts("discussion-feed") }
    func testPostViewer() throws { try posts("post-viewer") }
    func testMixedGallery() throws {
        try open("mixed-gallery")
        try require(read().controllers == 0, "Still image acquired a controller")
        try tap("Next item"); try ready("gallery-item")
        try faster("gallery-item")
        for suffix in ["fallback.mp4", "clip.webm"] {
            try tap("Next item")
            let clip = try ready("gallery-item")
            try require(clip.source.contains(suffix), "Wrong native media format")
            try faster("gallery-item"); try play("gallery-item", label: "Play clip")
            try require(read().controllers == 1, "Duplicate gallery owners")
        }
        try tap("Next item")
        try wait("Retired gallery owner/still controller retained") { $0.controllers == 0 }
        try tap("Previous item"); try ready("gallery-item"); try finish()
    }
    func embed(_ id: String) throws {
        try open(id); try tap("Load embedded clip")
        try ready(frame: 0); try faster(frame: 0)
        try tap("Play video"); try progress(frame: 0)
        let before = try read()
        try require(before.controllers == 0 && before.media.isEmpty, "Frame owns parent media")
        if id == "source-embed" {
            let clip = try ready(frame: 0)
            try tap("LOW"); try same(clip, ready(frame: 0))
            try tap("Toggle site viewer"); try ready(frame: 0); try tap("Toggle site viewer")
            try tap("Recreate player")
            try wait("Frame was not replaced") {
                $0.children?.first?.state?.document != before.children?.first?.state?.document &&
                    $0.clip(frame: 0)?.source.contains("asset=2") == true
            }
        } else {
            try tap("Resize embedded clip")
            try wait("Frame did not resize in place") {
                guard let child = $0.children?.first, let old = before.children?.first else { return false }
                return child.rect.width > old.rect.width && child.state?.document == old.state?.document
            }
        }
        try tap("Remove embedded clip")
        try wait("Frame removal retained parent owner") { $0.children?.isEmpty == true && $0.controllers == 0 }
        try tap("Load embedded clip"); try ready(frame: 0); try faster(frame: 0)
        try tap("Play video"); try progress(frame: 0); try finish()
    }
    func testSourceEmbed() throws { try embed("source-embed") }
    func testCompactEmbed() throws { try embed("compact-embed") }
    func testWatchNavigation() throws {
        try open("watch-navigation")
        let original = try ready(), rate = try faster()
        try tap("Toggle short layout")
        try require(ready().rect.height > ready().rect.width, "Short layout not applied")
        try play()
        // The tall layout puts page actions beneath Safari's bottom toolbar.
        // Scroll with genuine input before using the visible navigation button.
        safari.swipeUp()
        try tap("Next entry"); try tap("Next entry")
        try wait("Latest navigation not committed") { $0.clip()?.source.contains("asset=3") == true }
        let replacement = try ready()
        try require(replacement.key != original.key, "Navigation retained old media")
        try play(); try require(abs((ready().rate ?? 0) - rate) < 0.01, "Navigation lost rate")
        try tap("Toggle short layout"); try same(replacement, ready()); try finish()
    }
    func testCarouselViewer() throws {
        try open("carousel-viewer")
        let first = try ready("carousel-video-0")
        try faster("carousel-video-0"); try tap("Mute or unmute"); try play("carousel-video-0")
        try tap("Next item")
        try require(read().media.filter { $0.tag == "VIDEO" }.allSatisfy { $0.paused == true }, "Hidden clip kept playing")
        try tap("Next item")
        try wait("Animated card not controlled") { $0.media.contains { $0.tag == "IMG" && $0.visible && $0.controlled } }
        try tap("Next item")
        let last = try ready("carousel-video-3")
        try require(last.muted == false && last.source.contains(".webm"), "Carousel format/mute lost")
        try play("carousel-video-3"); try tap("Open viewer"); try progress("carousel-video-3")
        try tap("Close viewer"); try same(last, ready("carousel-video-3"))
        try tap("Next item"); try same(first, ready("carousel-video-0")); try play("carousel-video-0")
        try require(ready("carousel-video-3").paused == true, "Previous carousel clip still playing")
        try finish()
    }
    func testCommandFeed() throws {
        try open("command-feed")
        let original = try ready(frame: 0), rate = try faster(frame: 0)
        try play(frame: 0, label: "Play first clip"); try tap("Mute or unmute")
        for _ in 0..<3 { try tap("Next entry") }
        try wait("Frame did not recycle latest source") { $0.clip(frame: 0)?.source.contains("asset=4") == true }
        try play(frame: 0, label: "Play first clip"); try same(original, ready(frame: 0))
        let now = try ready(frame: 0)
        try require(now.muted == false && abs((now.rate ?? 0) - rate) < 0.01, "Frame mute/rate intent lost")
        try tap("Pause first clip"); try wait("Frame pause failed") { $0.clip(frame: 0)?.paused == true }
        try tap("Mute or unmute")
        try wait("Frame mute failed") { $0.clip(frame: 0)?.muted == true }
        try require(read().controllers == 0, "Parent acquired frame controller"); try finish()
    }
    func testFloatingFeed() throws {
        try open("floating-feed")
        let original = try ready(), rate = try faster()
        try play()
        for action in ["Expand player", "Float player", "Return inline"] {
            try tap(action); try same(original, ready()); try progress()
            try require(read().controllers == 1, "Reparenting duplicated controller")
        }
        try tap("Hide player"); try wait("Hidden player did not pause") { $0.clip()?.paused == true }
        try tap("Show player"); try same(original, ready())
        try require(ready().paused == true, "Revealing player resumed without input")
        try play(); try require(abs((ready().rate ?? 0) - rate) < 0.01, "Reparenting lost rate"); try finish()
    }
    func testCoordinatedEmbeds() throws {
        try open("coordinated-embeds")
        try ready(frame: 0); try ready(frame: 1)
        try play(frame: 0, label: "Play first clip"); try play(frame: 1, label: "Play second clip")
        try wait("Frame coordination did not pause first clip") { $0.clip(frame: 0)?.paused == true }
        try tap("Toggle concurrent playback"); try play(frame: 0, label: "Play first clip")
        try progress(frame: 1)
        try requireConcurrentPictures()
        let first = try ready(frame: 0), second = try ready(frame: 1)
        try faster(frame: 0)
        try require(ready(frame: 1).rate == second.rate, "Frame rate authority leaked")
        try tap("LOW"); try same(first, ready(frame: 0))
        try play(frame: 0, label: "Play first clip"); try progress(frame: 1)
        try requireConcurrentPictures()
        try require(read().controllers == 0, "Frame controller in parent"); try finish()
    }
    func testAttachmentThread() throws {
        try open("attachment-thread")
        let original = try ready(), rate = try faster()
        try play()
        let reply = safari.textViews["Message"]
        reply.tap(); reply.typeText("sdd message")
        try tap("Read profile state")
        try require(abs((ready().rate ?? 0) - rate) < 0.01, "Typing altered rate")
        try tap("Open attachment"); try same(original, ready()); try progress()
        try tap("Close attachment"); try same(original, ready())
        try tap("Expire attachment")
        try wait("Expired source not observed") { !($0.fixture?.errors.isEmpty ?? true) }
        try tap("Renew attachment"); try same(original, ready()); try play()
        try tap("Open attachment"); try tap("Remove message")
        try wait("Removed message retained owners") { $0.media.isEmpty && $0.controllers == 0 }
        try tap("New message"); try ready(); try play(); try finish()
    }
    func testStagedPlayer() throws {
        try open("staged-player")
        try require(read().media.filter { $0.tag == "VIDEO" }.isEmpty && read().controllers == 0, "Placeholder owns media")
        try tap("Load player"); let preview = try ready(); try play()
        try tap("Continue to content")
        let content = try ready()
        try require(preview.key != content.key, "Preview not replaced")
        try faster(); try play(); try tap("LOW"); try same(content, ready()); try play()
        try tap("Toggle floating player")
        try require(ready().rect.width <= 330, "Stage did not float")
        try tap("Toggle floating player"); try same(content, ready())
        try tap("Next entry")
        try wait("Staged source did not advance") { $0.clip()?.source.contains("asset=2") == true }
        try play(); try same(content, ready()); try finish()
    }
    func testLiveWindow() throws {
        try open("live-window")
        try wait("Native MediaSource/ManagedMediaSource stream unavailable") { $0.detail?.phase == "live-ready" }
        let original = try ready()
        try require(original.live && original.seekable.count == 2, "Live timeline is not native")
        try play()
        try tap("Advance live window")
        try wait("Native live seek window did not move") {
            guard let v = $0.clip(), v.seekable.count == 2 else { return false }
            return v.seekable[0] > original.seekable[0] + 1 && v.seekable[1] > original.seekable[1] + 1
        }
        if try ready().paused == false { try tap("Play or pause") }
        let beforeRewind = try ready()
        try require((beforeRewind.time ?? 0) > beforeRewind.seekable[0] + 1, "Live rewind precondition unavailable")
        let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
        pill.tap(); try tap("Rewind")
        try wait("Live rewind escaped native seek window") {
            guard let v = $0.clip(), let time = v.time, v.seekable.count == 2 else { return false }
            return v.paused == true && time < (beforeRewind.time ?? 0) - 1 &&
                abs(time - max(v.seekable[0], (beforeRewind.time ?? 0) - 10)) < 0.1
        }
        try tap("Use recording"); try same(original, ready()); try play()
        try require(ready().duration != nil && !ready().live, "Recording handoff is not finite")
        try finish()
    }

}
