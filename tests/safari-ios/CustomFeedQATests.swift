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
    private func requireTime(_ safari: XCUIApplication, _ label: String, _ condition: @escaping (Double) -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition(self.time(safari)) }, object: status(safari))
        let result = XCTWaiter.wait(for: [expectation], timeout: 8)
        if result != .completed {
            capture(safari, "custom-feed-time-failure")
            print("CUSTOM FEED TIME " + label + "; " + status(safari).label + "\n" + safari.debugDescription)
        }
        XCTAssertEqual(result, .completed)
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
        wait(safari, ["Clip 1;", "paused true", "metadata true", "source true", "controllers 1;", "attached true", "connected true", "errors 0"])
        let initialTime = time(safari)
        play.tap(); wait(safari, ["paused false", "loaded true"])
        requireTime(safari, "first clip plays") { $0 > initialTime + 0.1 }
        safari.buttons["Pause video"].tap(); wait(safari, ["paused true"])
        let mute = safari.buttons["Unmute video"]; target(mute); mute.tap()
        XCTAssertTrue(safari.buttons["Mute video"].waitForExistence(timeout: 5))
        safari.buttons["Mute video"].tap()
        let seek = safari.sliders["Seek video"]; target(seek)
        // XCTest's slider-adjust API lacks WebKit's min/max coordinates. Use
        // a genuine touch at the observed accessible target instead.
        let timelineStart = time(safari)
        let durationText = status(safari).label.components(separatedBy: "; duration ")
        let duration = durationText.count > 1 ? Double(durationText[1].components(separatedBy: ";")[0]) ?? 0 : 0
        XCTAssertGreaterThan(duration, 0)
        // Choose the opposite half so a successful seek cannot coincide with
        // the position reached during the preceding Play/Pause check.
        let fraction = timelineStart < duration / 2 ? 0.75 : 0.2
        seek.coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.5)).tap()
        requireTime(safari, "timeline moved") { abs($0 - timelineStart) > max(0.1, duration * 0.05) }
        let before = time(safari)
        let y = (play.frame.maxY + seek.frame.minY) / 2
        let origin = safari.coordinate(withNormalizedOffset: .zero)
        let forward = before < duration / 2
        // Keep the swipe away from seek boundaries so this checks gesture
        // movement independently of the clip's looping behavior.
        origin.withOffset(CGVector(dx: forward ? 90 : 220, dy: y)).press(forDuration: 0.05,
            thenDragTo: origin.withOffset(CGVector(dx: forward ? 220 : 90, dy: y)),
            withVelocity: .slow, thenHoldForDuration: 0)
        requireTime(safari, "picture drag moved") { forward ? $0 > before + 0.1 : $0 < before - 0.1 }
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
                safari.sliders["Seek video"].coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).tap()
                requireTime(safari, "frame precondition is away from seek bounds") { $0 > 0.1 && $0 < duration * 0.9 }
                safari.buttons["More video options"].tap()
                let frameStart = time(safari)
                target(safari.buttons["Frame forward"]); safari.buttons["Frame forward"].tap()
                requireTime(safari, "frame forward") { $0 > frameStart + 0.005 }
                safari.buttons["Frame back"].tap()
                requireTime(safari, "frame back") { abs($0 - frameStart) < 0.015 }
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
        wait(safari, ["Clip 2;", "paused true", "metadata true", "source true", "controllers 1;", "attached true", "connected true", "errors 0"])
        target(safari.buttons["Play video"])
        let clipStart = time(safari)
        safari.buttons["Play video"].tap(); wait(safari, ["paused false", "loaded true"])
        requireTime(safari, "next clip plays") { $0 > clipStart + 0.1 }
        safari.buttons["Pause video"].tap(); wait(safari, ["paused true"])
        capture(safari, "custom-feed-next-clip")
    }
}
