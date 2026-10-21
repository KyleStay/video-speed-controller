import XCTest

/// Use /mobile.html?mp4&owned&scroll=page&no-playsinline on the dedicated simulator.
@MainActor final class InlinePlaybackQATests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }
    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Playback rate:'")).firstMatch
    }
    private func field(_ text: String, _ name: String) -> String? {
        let prefix = name + ": "
        return text.components(separatedBy: "; ").first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) }
    }
    private func capture(_ safari: XCUIApplication, _ name: String) {
        let text = XCTAttachment(string: status(safari).label + "\n" + safari.debugDescription)
        text.name = name + "-state"; text.lifetime = .keepAlways; add(text)
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screen.name = name; screen.lifetime = .keepAlways; add(screen)
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let item = status(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pieces.allSatisfy { item.label.contains($0) } }, object: item)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 20), .completed)
    }
    private func inline(_ safari: XCUIApplication, playing: Bool? = nil) {
        var pieces = ["plays inline: true", "webkit inline: true", "inline property: true", "original inline flags: [null,null]", "controllers: 1", "errors: 0", "media error: 0", "owner active: false", "owned hosts: 0", "native fullscreen: false", "native controls: true", "original identity: true", "source preserved: true"]
        if let playing { pieces.append("paused: " + String(!playing)) }
        wait(safari, pieces)
    }
    private func progress(_ safari: XCUIApplication) {
        let before = Double(field(status(safari).label, "time") ?? "") ?? -1
        XCTAssertGreaterThanOrEqual(before, 0)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let text = self.status(safari).label
            let now = Double(self.field(text, "time") ?? "") ?? -1
            return text.contains("paused: false") && (now > before + 0.3 || now < before - 1)
        }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 8), .completed)
    }
    private func assertScroll(_ safari: XCUIApplication, _ baseline: [Double], _ name: String) {
        inline(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let text = self.status(safari).label
            guard let value = self.field(text, "page scroll"), let top = Double(self.field(text, "video top") ?? "") else { return false }
            let point = value.split(separator: ",").compactMap { Double($0) }
            return point.count == 2 && abs(point[0] - baseline[0]) <= 2 && abs(point[1] - baseline[1]) <= 2 && abs(top - baseline[2]) <= 2
        }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed)
        capture(safari, name)
    }
    private func openCustomPaused(_ safari: XCUIApplication) {
        safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch.tap()
        let custom = safari.buttons["Open StayFast player"]
        XCTAssertTrue(custom.waitForExistence(timeout: 10)); custom.tap()
        let pause = safari.buttons["Pause video"]
        XCTAssertTrue(pause.waitForExistence(timeout: 10)); pause.tap()
        wait(safari, ["owner active: true", "paused: true", "native fullscreen: false", "plays inline: true", "webkit inline: true", "errors: 0"])
    }
    private func closeNative(_ safari: XCUIApplication, _ name: String) {
        wait(safari, ["native fullscreen: true", "owner active: false", "owned hosts: 0", "errors: 0"])
        capture(safari, name)
        let close = safari.buttons["Close Button"]
        if !close.isHittable { safari.otherElements["Media"].tap() }
        XCTAssertTrue(close.waitForExistence(timeout: 10)); close.tap()
    }
    func testInlineUntilExplicitFullscreen() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        inline(safari, playing: false)
        capture(safari, "source-without-inline-flags-attached")
        // A genuine ordinary play() gesture must remain inline even though the
        // response's video tag omitted both inline attributes before parsing.
        safari.buttons["Play test video"].tap()
        inline(safari, playing: true); wait(safari, ["ready: 4"]); progress(safari)
        capture(safari, "ordinary-play-stays-inline")
        safari.buttons["Pause test video"].tap(); inline(safari, playing: false)
        safari.buttons["Prepare scroll baseline"].tap()
        safari.buttons["Remember scroll position"].tap()
        let text = status(safari).label
        let point = (field(text, "saved scroll") ?? "").split(separator: ",").compactMap { Double($0) }
        guard point.count == 2, let top = Double(field(text, "saved video top") ?? "") else {
            XCTFail("Missing measured scroll baseline: " + text)
            return
        }
        let baseline = [point[0], point[1], top]
        XCTAssertGreaterThan(baseline[1], 500)
        capture(safari, "native-inline-play-control-before-tap")
        // iPhone exposes its inline native video controls as one media element,
        // not individual AX Play buttons. Tap the observed media center where
        // the native paused Play glyph is shown in the preceding screenshot.
        let media = safari.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'Test video'")).firstMatch
        XCTAssertTrue(media.waitForExistence(timeout: 10)); XCTAssertTrue(media.isHittable)
        XCTAssertGreaterThan(media.frame.width, 100); XCTAssertGreaterThan(media.frame.height, 100)
        media.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        inline(safari, playing: true); progress(safari)
        capture(safari, "native-controls-play-stays-inline")
        safari.buttons["Pause test video"].tap(); inline(safari, playing: false)
        safari.buttons["Open video fullscreen"].tap()
        closeNative(safari, "explicit-native-fullscreen")
        assertScroll(safari, baseline, "native-return-keeps-inline-flags")
        openCustomPaused(safari)
        safari.buttons["Close StayFast video player"].tap()
        assertScroll(safari, baseline, "custom-done-keeps-inline-flags")
        safari.buttons["Play test video"].tap(); inline(safari, playing: true); progress(safari)
        capture(safari, "play-after-custom-done-stays-inline")
        safari.buttons["Pause test video"].tap(); inline(safari, playing: false)
        openCustomPaused(safari)
        safari.buttons["Enter full screen"].tap()
        closeNative(safari, "custom-to-native-fullscreen")
        assertScroll(safari, baseline, "custom-native-return-keeps-inline-flags")
        openCustomPaused(safari)
        safari.buttons["More video options"].tap()
        safari.buttons["Use site player"].tap()
        wait(safari, ["plays inline: false", "webkit inline: false", "inline property: false", "inline values: [null,null]", "original inline flags: [null,null]", "owner active: false", "owned hosts: 0", "native controls: true", "original identity: true", "source preserved: true", "errors: 0"])
        capture(safari, "explicit-site-handback-restores-original-flags")
    }
}
