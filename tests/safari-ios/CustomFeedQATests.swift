import XCTest

/// Local synthetic custom-player flow; open /custom-feed.html?mp4 first.
@MainActor final class CustomFeedQATests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Clip ' OR label BEGINSWITH 'Owned clip ' OR label BEGINSWITH 'Viewer clip '")).firstMatch
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let element = status(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            pieces.allSatisfy { element.label.contains($0) }
        }, object: element)
        let result = XCTWaiter.wait(for: [expectation], timeout: 15)
        if result != .completed {
            capture(safari, "custom-feed-wait-failure")
            print("CUSTOM FEED EXPECTED " + pieces.joined(separator: ", ") + "\n" + safari.debugDescription)
        }
        XCTAssertEqual(result, .completed)
    }
    private func time(_ safari: XCUIApplication) -> Double {
        let parts = status(safari).label.components(separatedBy: "; time ")
        return parts.count > 1 ? Double(parts[1].components(separatedBy: ";")[0]) ?? -1 : -1
    }
    private func target(_ element: XCUIElement) {
        XCTAssertTrue(element.isHittable)
        XCTAssertGreaterThanOrEqual(element.frame.width, 44)
        XCTAssertGreaterThanOrEqual(element.frame.height, 44)
    }
    func testCustomFeedControlsAndReturn() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        XCTAssertTrue(status(safari).waitForExistence(timeout: 20))
        let delayed = safari.buttons["Show clip controls"]
        if delayed.exists && delayed.isHittable { delayed.tap() }
        let play = safari.buttons["Play video"]
        XCTAssertTrue(play.waitForExistence(timeout: 20)); target(play)
        wait(safari, ["Clip 1;", "paused true", "errors 0"])
        play.tap(); wait(safari, ["paused false"])
        safari.buttons["Pause video"].tap(); wait(safari, ["paused true"])
        let mute = safari.buttons["Unmute video"]; target(mute); mute.tap()
        XCTAssertTrue(safari.buttons["Mute video"].waitForExistence(timeout: 5))
        safari.buttons["Mute video"].tap()
        let seek = safari.sliders["Seek video"]; target(seek)
        // XCTest's slider-adjust API lacks WebKit's min/max coordinates. Use
        // a genuine touch at the observed accessible target instead.
        let timelineStart = time(safari)
        seek.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        let timelineMoved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(self.time(safari) - timelineStart) > 0.1 }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [timelineMoved], timeout: 8), .completed)
        let before = time(safari)
        let y = (play.frame.maxY + seek.frame.minY) / 2
        let origin = safari.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: 90, dy: y)).press(forDuration: 0.05,
            thenDragTo: origin.withOffset(CGVector(dx: 220, dy: y)),
            withVelocity: .slow, thenHoldForDuration: 0)
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.time(safari) > before + 0.1 }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 8), .completed)
        wait(safari, ["paused true", "owned false", "errors 0"])
        capture(safari, "custom-feed-inline")
        let fullscreen = safari.buttons["Open video fullscreen"]
        let feedY = fullscreen.frame.minY
        safari.buttons["Open site viewer"].tap()
        XCTAssertTrue(safari.buttons["Close site viewer"].waitForExistence(timeout: 10))
        for repeatIndex in 0..<2 {
            target(fullscreen); let entryY = fullscreen.frame.minY
            fullscreen.tap()
            let done = safari.buttons["Close StayFast video player"]
            XCTAssertTrue(done.waitForExistence(timeout: 10)); target(done)
            if repeatIndex == 0 {
                safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch.tap()
                XCTAssertTrue(safari.buttons["4×"].waitForExistence(timeout: 5)); safari.buttons["4×"].tap()
                wait(safari, ["rate 4;", "paused true"])
                safari.buttons["More video options"].tap()
                let frameStart = time(safari)
                target(safari.buttons["Frame forward"]); safari.buttons["Frame forward"].tap()
                let frameMoved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.time(safari) > frameStart + 0.005 }, object: status(safari))
                XCTAssertEqual(XCTWaiter.wait(for: [frameMoved], timeout: 8), .completed)
                safari.buttons["Frame back"].tap()
                let frameRestored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(self.time(safari) - frameStart) < 0.015 }, object: status(safari))
                XCTAssertEqual(XCTWaiter.wait(for: [frameRestored], timeout: 8), .completed)
                safari.buttons["More video options"].tap()
                safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Lock playback controls'")).firstMatch.tap()
                XCTAssertTrue(safari.buttons["Unlock playback controls"].waitForExistence(timeout: 5))
                safari.buttons["Unlock playback controls"].tap()
                capture(safari, "custom-feed-owned")
            }
            done.tap(); XCTAssertTrue(fullscreen.waitForExistence(timeout: 10))
            XCTAssertEqual(fullscreen.frame.minY, entryY, accuracy: 2)
        }
        safari.buttons["Close site viewer"].tap()
        XCTAssertEqual(fullscreen.frame.minY, feedY, accuracy: 2)
        safari.buttons["Next clip"].tap()
        wait(safari, ["Clip 2;", "paused true", "loaded true", "controllers 1;", "attached true", "connected true", "errors 0"])
        target(safari.buttons["Play video"])
        let clipStart = time(safari)
        safari.buttons["Play video"].tap(); wait(safari, ["paused false"])
        let clipProgress = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.time(safari) > clipStart + 0.1 }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [clipProgress], timeout: 8), .completed)
        safari.buttons["Pause video"].tap(); wait(safari, ["paused true"])
        capture(safari, "custom-feed-next-clip")
    }
}
