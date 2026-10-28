import XCTest

/// Open /gif-images.html after extension activation on the dedicated simulator.
@MainActor
final class GifImageQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func capture(_ safari: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: safari.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
        let tree = XCTAttachment(string: safari.debugDescription)
        tree.name = name + "-hierarchy"
        tree.lifetime = .keepAlways
        add(tree)
    }

    private func state(_ safari: XCUIApplication, _ fragments: [String]) {
        safari.buttons["Read GIF state"].tap()
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'GIF state:'")).firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        for fragment in fragments {
            XCTAssertTrue(status.label.contains(fragment), status.label)
        }
    }

    private func action(_ safari: XCUIApplication, _ name: String) {
        // WebKit exposes aria-pressed speed presets as native Switches.
        let button = name.hasPrefix("Set playback speed to ") ? safari.switches[name] : safari.buttons[name]
        // Reading the fixture status clicks outside the popover and closes it.
        let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 15))
        pill.tap()
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
    }

    func testAnimationControlsAndFrames() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 20))
        state(safari, ["controlled=true", "same=true", "still=false", "blob=true", "errors=0"])
        action(safari, "Pause animation")
        state(safari, ["paused=true", "errors=0"])
        action(safari, "Frame back")
        state(safari, ["paused=true", "time=0.000", "frame=0", "errors=0"])
        capture(safari, "gif-red-paused")
        action(safari, "Frame forward")
        state(safari, ["paused=true", "time=0.200", "frame=1", "errors=0"])
        capture(safari, "gif-blue-paused")
        action(safari, "Set playback speed to 2 times")
        state(safari, ["rate=2", "paused=true", "errors=0"])
        action(safari, "Play animation")
        state(safari, ["paused=false", "rate=2", "same=true", "errors=0"])
        capture(safari, "gif-playing-2x")
    }
}
