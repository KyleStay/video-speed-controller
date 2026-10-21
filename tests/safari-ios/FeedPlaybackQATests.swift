import XCTest

/// Diagnostic synthetic feed: frozen installed app, no product API stubs.
@MainActor final class FeedPlaybackQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }
    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Feed status:'")).firstMatch
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let item = status(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pieces.allSatisfy { item.label.contains($0) } }, object: item)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 25), .completed)
    }
    private func capture(_ safari: XCUIApplication, _ name: String) {
        let trace = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Feed trace:'")).firstMatch
        let text = XCTAttachment(string: status(safari).label + "\n" + (trace.exists ? trace.label : "") + "\n" + safari.debugDescription)
        text.name = name + "-state"; text.lifetime = .keepAlways; add(text)
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screen.name = name; screen.lifetime = .keepAlways; add(screen)
    }
    private func run(_ button: String, _ name: String, requiresPlayback: Bool = true) {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        wait(safari, ["older controller: true", "generation: 0", "errors: 0"])
        safari.buttons["Prepare feed baseline"].tap()
        wait(safari, ["page scroll: 0,720", "saved scroll: 0,720"])
        capture(safari, name + "-before")
        if button == "Replace source and play" {
            safari.buttons["Prepare controlled feed"].tap()
            wait(safari, ["feed controller: true", "plays inline: true", "webkit inline: true"])
        }
        safari.buttons[button].tap()
        wait(safari, ["feed controller: true", "controllers: 2"])
        capture(safari, name + "-observed")
        let text = status(safari).label
        XCTAssertTrue(text.contains("native begins: 0"), text)
        XCTAssertTrue(text.contains("native fullscreen: false"), text)
        XCTAssertTrue(text.contains("owner active: false"), text)
        XCTAssertTrue(text.contains("owned hosts: 0"), text)
        XCTAssertTrue(text.contains("page scroll: 0,720"), text)
        XCTAssertTrue(text.contains("errors: 0"), text)
        if requiresPlayback {
            wait(safari, ["paused: false", "request error: none", "media error: 0"])
        }
        capture(safari, name + "-final")
    }
    func testSynchronousFeedInsertion() { run("Load next feed video", "feed-synchronous") }
    func testSourceReuse() { run("Replace source and play", "feed-source-reuse") }
    /// A successful diagnostic checks no unexpected presentation/scroll; inspect
    /// paused/readiness/time separately before claiming autoplay acceptance.
    func testBackgroundAutoplayObservation() { run("Load next autoplay video", "feed-background-autoplay", requiresPlayback: false) }
    func testActiveCustomSourceRecycle() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        wait(safari, ["older controller: true", "generation: 0", "errors: 0"])
        safari.buttons["Prepare feed baseline"].tap()
        safari.buttons["Prepare controlled feed"].tap()
        wait(safari, ["feed controller: true", "feed id: feed-video-1", "controllers: 2", "plays inline: true", "webkit inline: true", "page scroll: 0,720"])
        let pills = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '"))
        guard let pill = pills.allElementsBoundByIndex.last(where: { $0.isHittable }) else {
            XCTFail("No visible feed speed pill"); return
        }
        pill.tap(); safari.buttons["Open StayFast player"].tap()
        wait(safari, ["owner active: true", "paused: false", "ready: 4"])
        capture(safari, "feed-active-before-source-recycle")
        safari.buttons["Recycle active feed source"].tap()
        wait(safari, ["generation: 2", "mode: active-source-recycle", "owner active: false", "owned hosts: 0", "feed id: feed-video-1", "feed controller: true", "controllers: 2", "page scroll: 0,720", "native fullscreen: false", "native begins: 0", "errors: 0"])
        capture(safari, "feed-source-recycled-inline")
        let app = XCUIApplication(bundleIdentifier: "co.staytech.stayfast"); app.activate()
        XCTAssertTrue(app.staticTexts["StayFast Video"].waitForExistence(timeout: 10))
        safari.activate()
        wait(safari, ["generation: 2", "owner active: false", "owned hosts: 0", "feed id: feed-video-1", "feed controller: true", "controllers: 2", "page scroll: 0,720", "native fullscreen: false", "native begins: 0", "errors: 0"])
        capture(safari, "feed-source-recycle-app-return")
    }

}
