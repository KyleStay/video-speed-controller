import XCTest

/// Neutral real-MSE/same-content MP4 fixture; host routing is explicitly emulated.
@MainActor final class TwitterMP4QATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'MP4 playback: '")).firstMatch
    }
    private func state(_ safari: XCUIApplication) -> [String: Any] {
        guard status(safari).exists else { return [:] }
        let raw = status(safari).label.replacingOccurrences(of: "MP4 playback: ", with: "")
        guard let data = raw.data(using: .utf8),
              let row = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return row
    }
    private func wait(_ safari: XCUIApplication, _ condition: @escaping ([String: Any]) -> Bool) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition(self.state(safari)) }, object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed, status(safari).label)
    }
    private func capture(_ safari: XCUIApplication, _ name: String) {
        let raw = status(safari).exists ? status(safari).label : "Fixture state is outside the active modal."
        let text = XCTAttachment(string: raw + "\n" + safari.debugDescription)
        text.name = name; text.lifetime = .keepAlways; add(text)
        let screenshot = XCTAttachment(screenshot: safari.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    private func retained(_ safari: XCUIApplication) {
        let row = state(safari)
        for key in ["originalConnected", "originalParentUnchanged", "originalSourceUnchanged", "sameMediaSource", "sameSourceBuffer"] {
            XCTAssertEqual(row[key] as? Bool, true, "\(key): \(row)")
        }
        XCTAssertEqual(row["controllers"] as? Int, 1)
        XCTAssertEqual(row["errors"] as? Int, 0)
    }
    private func openMore(_ safari: XCUIApplication) {
        let stage = safari.otherElements["Video display"]
        XCTAssertTrue(stage.waitForExistence(timeout: 10))
        let point = stage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        point.tap()
        if !safari.buttons["More video options"].isHittable { point.tap() }
        XCTAssertTrue(safari.buttons["More video options"].waitForExistence(timeout: 5))
        safari.buttons["More video options"].tap()
        XCTAssertTrue(safari.buttons["Use site player"].waitForExistence(timeout: 5))
    }
    private func measure(_ safari: XCUIApplication, _ rate: Double) {
        safari.buttons["Measure current playback"].tap()
        wait(safari) { ($0["measurement"] as? [String: Any])?["done"] as? Bool == true }
        let row = state(safari)
        let sample = row["measurement"] as? [String: Any] ?? [:]
        let ratio = sample["ratio"] as? Double ?? 0
        XCTAssertGreaterThan(ratio, rate * 0.9, "\(sample)")
        XCTAssertLessThan(ratio, rate * 1.1, "\(sample)")
        XCTAssertGreaterThanOrEqual(sample["frames"] as? Int ?? 0, 60, "\(sample)")
        XCTAssertLessThan(sample["maxGapMs"] as? Double ?? .infinity, 500, "\(sample)")
        retained(safari)
        capture(safari, "retained-mse-\(rate)x")
    }
    private func ownedPlayback(_ safari: XCUIApplication, speed expected: String) {
        XCTAssertTrue(safari.buttons["Close StayFast video player"].waitForExistence(timeout: 10))
        openMore(safari)
        let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
        XCTAssertEqual(speed.value as? String, expected)
        XCTAssertTrue(safari.buttons["Pause video"].exists)
        let seek = safari.sliders["Seek video"]
        XCTAssertTrue(seek.exists)
        let before = seek.value as? String
        XCTAssertNotNil(before)
        let advancing = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            seek.exists && (seek.value as? String) != before
        }, object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [advancing], timeout: 10), .completed,
                       "The visible owned playback clock did not advance")
        safari.buttons["More video options"].tap()
    }

    func testDecodedFastPlaybackAndHandback() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        wait(safari) { $0["ready"] as? Bool == true && $0["canResolve"] as? Bool == true }
        safari.buttons["Reset current to 1×"].tap()
        safari.buttons["Play original"].tap()
        wait(safari) { $0["originalPaused"] as? Bool == false }
        safari.buttons["Set 4×"].tap()
        wait(safari) { $0["nativeReady"] as? Bool == true && $0["rate"] as? Double == 4 }
        measure(safari, 4)
        safari.buttons["Pause current"].tap()
        wait(safari) { $0["paused"] as? Bool == true }
        safari.buttons["Set 2.1×"].tap()
        wait(safari) { $0["rate"] as? Double == 2.1 && $0["paused"] as? Bool == true }
        safari.buttons["Play original"].tap()
        wait(safari) { $0["paused"] as? Bool == false }
        measure(safari, 2.1)
        safari.buttons["Open owned fullscreen"].tap()
        XCTAssertTrue(safari.buttons["Close StayFast video player"].waitForExistence(timeout: 10))
        openMore(safari)
        safari.buttons["Use site player"].tap()
        wait(safari) { $0["native"] as? Bool == false && $0["originalPaused"] as? Bool == false }
        retained(safari)
        let before = state(safari)["originalTime"] as? Double ?? 0
        wait(safari) {
            let time = $0["originalTime"] as? Double ?? before
            return time > before + 0.2 || time < before - 0.2
        }
        capture(safari, "retained-mse-site-handback")
    }

    func testStartFromOwnedFullscreen() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        wait(safari) { $0["ready"] as? Bool == true && $0["canResolve"] as? Bool == true }
        safari.buttons["Reset current to 1×"].tap()
        safari.buttons["Play original"].tap()
        wait(safari) { $0["originalPaused"] as? Bool == false }
        safari.buttons["Open owned fullscreen"].tap()
        // A modal makes the fixture's page state inaccessible to native AX.
        // Observe its actual controls and clock, then read identity after return.
        ownedPlayback(safari, speed: "1×")
        let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
        XCTAssertTrue(speed.waitForExistence(timeout: 10)); speed.tap()
        XCTAssertTrue(safari.buttons["4×"].waitForExistence(timeout: 10)); safari.buttons["4×"].tap()
        ownedPlayback(safari, speed: "4×")
        XCUIDevice.shared.press(.home)
        safari.activate()
        ownedPlayback(safari, speed: "4×")
        capture(safari, "retained-mse-fullscreen-entry")
        openMore(safari)
        safari.buttons["Use site player"].tap()
        wait(safari) { $0["native"] as? Bool == false }
        retained(safari)
    }
}
