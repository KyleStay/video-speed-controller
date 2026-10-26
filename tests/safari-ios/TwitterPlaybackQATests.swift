import XCTest

/// Built-extension fixture using the production iOS matcher and X source resolver.
@MainActor final class TwitterPlaybackQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    private func state(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'X playback:'")).firstMatch
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let item = state(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            pieces.allSatisfy { item.label.contains($0) }
        }, object: item)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 45), .completed, item.label)
    }
    private func report(_ safari: XCUIApplication) throws -> [String: Any] {
        let label = state(safari).label
        let attachment = XCTAttachment(string: label + "\n" + safari.debugDescription)
        attachment.name = "twitter-playback-state"; attachment.lifetime = .keepAlways; add(attachment)
        let image = XCTAttachment(screenshot: safari.screenshot())
        image.name = "twitter-playback-screen"; image.lifetime = .keepAlways; add(image)
        print("TWITTER PLAYBACK RESULT " + label)
        return try JSONSerialization.jsonObject(with: Data(label.dropFirst("X playback: ".count).utf8)) as! [String: Any]
    }
    private func prepare() -> XCUIApplication {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        wait(safari, ["\"phase\":\"ready\""])
        safari.buttons["Prepare X clip"].tap()
        wait(safari, ["\"phase\":\"prepared\"", "\"controlled\":true", "\"errors\":[]"])
        return safari
    }
    private func assertPlayback(_ data: [String: Any], owned: Bool) {
        XCTAssertEqual(data["sameNode"] as? Bool, true)
        XCTAssertEqual(data["mp4"] as? Bool, true)
        XCTAssertEqual(data["rate"] as? Double, 4)
        XCTAssertEqual(data["paused"] as? Bool, false)
        XCTAssertEqual(data["active"] as? Bool, owned)
        XCTAssertEqual(data["native"] as? Bool, false)
        XCTAssertEqual(data["scroll"] as? [Double], data["baseline"] as? [Double])
        XCTAssertEqual((data["errors"] as? [Any])?.count, 0)
        let cadence = data["cadence"] as! [String: Double]
        XCTAssertGreaterThanOrEqual(cadence["hz"]!, 24)
        XCTAssertEqual(cadence["progress"]!, 4, accuracy: 0.2)
    }
    func testInlineRenditionChange() throws {
        let safari = prepare(); safari.buttons["Set 4x inline"].tap()
        wait(safari, ["\"phase\":\"measured\""])
        assertPlayback(try report(safari), owned: false)
    }
    func testFastCommandBeforeMetadataSelectsRendition() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        wait(safari, ["\"phase\":\"ready\""])
        safari.buttons["Set 4x while loading"].tap()
        wait(safari, ["\"phase\":\"measured\"", "\"initialPlay\":\"resolved\""])
        assertPlayback(try report(safari), owned: false)
    }
    func testOwnedRenditionChangeAndReturn() throws {
        let safari = prepare(); safari.buttons["Set 4x owned"].tap()
        wait(safari, ["\"phase\":\"measured\""])
        assertPlayback(try report(safari), owned: true)
        let stage = safari.otherElements["Video display"]
        XCTAssertTrue(stage.waitForExistence(timeout: 5))
        let reveal = stage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        reveal.tap()
        if !safari.buttons["Close StayFast video player"].isHittable { reveal.tap() }
        safari.buttons["Close StayFast video player"].tap()
        wait(safari, ["\"active\":false", "\"mp4\":true", "\"paused\":false"])
        let data = try report(safari)
        XCTAssertEqual(data["scroll"] as? [Double], data["baseline"] as? [Double])
    }
    func testPausedRenditionChange() throws {
        let safari = prepare(); safari.buttons["Set 4x paused"].tap()
        wait(safari, ["\"phase\":\"paused-ready\""])
        let data = try report(safari)
        XCTAssertEqual(data["mp4"] as? Bool, true)
        XCTAssertEqual(data["paused"] as? Bool, true)
        XCTAssertEqual(data["rate"] as? Double, 4)
        XCTAssertEqual(data["time"] as! Double, data["commandPosition"] as! Double, accuracy: 0.05)
        XCTAssertEqual(data["scroll"] as? [Double], data["baseline"] as? [Double])
        XCTAssertEqual((data["errors"] as? [Any])?.count, 0)
    }
    func testRememberedSpeedNextClipPreservesSitePlayPromise() throws {
        let safari = prepare(); safari.buttons["Set 4x inline"].tap()
        wait(safari, ["\"phase\":\"measured\""])
        safari.buttons["Add remembered-speed clip"].tap()
        wait(safari, ["\"phase\":\"measured\"", "\"initialPlay\":\"resolved\""])
        assertPlayback(try report(safari), owned: false)
    }
}
