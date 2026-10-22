import XCTest

/// Native Safari with real HTML alternatives and public publisher SDKs.
@MainActor final class HLSPlayerQATests: XCTestCase {
    func testPlayerRenditionSwitch() throws {
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        let state = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'HLS player:'")).firstMatch
        func wait(_ phase: String) {
            let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in state.label.contains("\"phase\":\"" + phase + "\"") }, object: state)
            XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 40), .completed, state.label)
        }
        wait("ready"); safari.buttons["Prepare player"].tap(); wait("prepared")
        safari.buttons["Set 4x playback"].tap(); wait("measured")
        let attachment = XCTAttachment(string: state.label + "\n" + safari.debugDescription)
        attachment.name = "hls-player-state"; attachment.lifetime = .keepAlways; add(attachment)
        let image = XCTAttachment(screenshot: safari.screenshot()); image.name = "hls-player-screen"; image.lifetime = .keepAlways; add(image)
        print("HLS PLAYER RESULT " + state.label)
        let report = try JSONSerialization.jsonObject(with: Data(state.label.dropFirst("HLS player: ".count).utf8)) as! [String: Any]
        XCTAssertEqual(report["sameNode"] as? Bool, true)
        XCTAssertEqual(report["controlled"] as? Bool, true)
        XCTAssertEqual(report["nativeHLS"] as? Bool, true)
        XCTAssertEqual(report["mp4"] as? Bool, true)
        XCTAssertEqual(report["metadataPreserved"] as? Bool, true)
        XCTAssertEqual(report["programmaticTrackPreserved"] as? Bool, true)
        XCTAssertEqual(report["selected"] as? String, report["provider"] as? String)
        XCTAssertEqual(report["rate"] as? Double, 4)
        XCTAssertEqual(report["paused"] as? Bool, false)
        XCTAssertEqual(report["native"] as? Bool, false)
        XCTAssertEqual(report["owned"] as? Bool, report["ownedMode"] as? Bool)
        XCTAssertEqual(report["scroll"] as? [Double], report["baseline"] as? [Double])
        XCTAssertEqual((report["errors"] as? [Any])?.count, 0)
        let cadence = report["cadence"] as! [String: Double]
        XCTAssertGreaterThanOrEqual(cadence["hz"]!, 24)
        XCTAssertEqual(cadence["progress"]!, 4, accuracy: 0.2)
        if report["ownedMode"] as? Bool == true {
            let stage = safari.otherElements["Video display"]
            XCTAssertTrue(stage.waitForExistence(timeout: 5))
            let reveal = stage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            reveal.tap()
            if !safari.buttons["Close StayFast video player"].isHittable { reveal.tap() }
            safari.buttons["Close StayFast video player"].tap()
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in state.label.contains("\"owned\":false") }, object: state)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 10), .completed, state.label)
            let after = try JSONSerialization.jsonObject(with: Data(state.label.dropFirst("HLS player: ".count).utf8)) as! [String: Any]
            XCTAssertEqual(after["scroll"] as? [Double], report["baseline"] as? [Double])
            XCTAssertEqual(after["mp4"] as? Bool, true)
            XCTAssertEqual(after["paused"] as? Bool, false)
            XCTAssertEqual((after["errors"] as? [Any])?.count, 0)
        }

    }
}
