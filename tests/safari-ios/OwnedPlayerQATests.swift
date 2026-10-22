import XCTest

/// Genuine Safari regression flow. Use a fresh ?mp4&owned fixture and explicit disposable UDID.
@MainActor final class OwnedPlayerQATests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let description = app.debugDescription
        print("OWNED " + name + "\n" + description)
        let hierarchy = XCTAttachment(string: description)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Playback rate:'")).firstMatch
    }
    @discardableResult private func wait(_ safari: XCUIApplication, _ pieces: [String], _ timeout: TimeInterval = 20) -> String {
        let element = status(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pieces.allSatisfy { element.label.contains($0) } }, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
        print("OWNED STATUS " + element.label)
        return element.label
    }
    private func time(_ safari: XCUIApplication) -> Double {
        let component = status(safari).label.components(separatedBy: "; time: ")
        guard component.count == 2 else { return -1 }
        return Double(component[1].components(separatedBy: ";")[0]) ?? -1
    }
    private func requireProgress(_ safari: XCUIApplication) {
        let before = time(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let after = self.time(safari)
            return self.status(safari).label.contains("paused: false") && (after > before + 0.3 || after < before - 1)
        }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 8), .completed)
        print("OWNED PROGRESS before=" + String(before) + "; " + status(safari).label)
    }
    private func target(_ control: XCUIElement) {
        XCTAssertTrue(control.isHittable)
        let frame = control.frame
        XCTAssertGreaterThanOrEqual(frame.width, 44)
        XCTAssertGreaterThanOrEqual(frame.height, 44)
    }
    private func reveal(_ safari: XCUIApplication) {
        let done = safari.buttons["Close StayFast video player"]
        let stage = safari.otherElements["Video display"]
        XCTAssertTrue(stage.waitForExistence(timeout: 10))
        // Start with genuine stage input so a previously visible HUD cannot
        // expire between an old hit-test and a delayed predicate's first poll.
        // This blank center point avoids transport and the edge seek zones.
        let point = stage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        point.tap()
        if !done.isHittable { point.tap() }
        XCTAssertTrue(done.isHittable)
    }
    private func openAndVerifyPlayback() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        XCTAssertTrue(safari.buttons["Play test video"].waitForExistence(timeout: 20))
        capture(safari, "before-owned-play")
        safari.buttons["Play test video"].tap()
        wait(safari, ["paused: false", "owner active: false", "owned hosts: 0", "native controls: false"])
        let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 10))
        pill.tap()
        let custom = safari.buttons["Open StayFast player"]
        XCTAssertTrue(custom.waitForExistence(timeout: 10))
        custom.tap()
        XCTAssertTrue(safari.buttons["Close StayFast video player"].waitForExistence(timeout: 20))
        wait(safari, ["ready: 4", "errors: 0", "paused: false", "media error: 0", "native fullscreen: false", "original identity: true", "source preserved: true", "owner active: true"])
        requireProgress(safari)
        capture(safari, "explicit-custom-original-playing")
    }
    private func checkTransportAndMute() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        reveal(safari)
        if safari.buttons["Pause video"].exists {
            target(safari.buttons["Pause video"])
            safari.buttons["Pause video"].tap()
        }
        for label in ["Close StayFast video player", "Play video", "Rewind 10 seconds", "Forward 10 seconds", "Unmute video", "More video options"] { target(safari.buttons[label]) }
        wait(safari, ["paused: true", "owner active: true", "native fullscreen: false"])
        let paused = time(safari)
        capture(safari, "paused-owned-controls")
        let seek = safari.sliders["Seek video"]
        target(seek)
        seek.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let sought = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(self.time(safari) - 7.5) < 1.5 }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [sought], timeout: 10), .completed)
        XCTAssertNotEqual(time(safari), paused)
        safari.buttons["Rewind 10 seconds"].tap()
        let rewound = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.time(safari) < 1 }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [rewound], timeout: 10), .completed)
        safari.buttons["Forward 10 seconds"].tap()
        let advanced = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(self.time(safari) - 10) < 1 }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [advanced], timeout: 10), .completed)
        safari.buttons["Unmute video"].tap()
        XCTAssertTrue(safari.buttons["Mute video"].waitForExistence(timeout: 5))
        capture(safari, "seek-and-unmuted")
        safari.buttons["Mute video"].tap()
        XCTAssertTrue(safari.buttons["Unmute video"].waitForExistence(timeout: 5))
    }
    private func showMore(_ safari: XCUIApplication) {
        reveal(safari)
        if !safari.buttons["Use site player"].isHittable {
            let more = safari.buttons["More video options"]
            target(more)
            more.tap()
        }
        XCTAssertTrue(safari.buttons["Use site player"].waitForExistence(timeout: 5))
    }
    private func checkPresentation() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let fill = safari.switches["Fill screen (crop edges)"]
        target(fill)
        fill.tap()
        wait(safari, ["fit mode: cover", "video fit: cover", "original identity: true", "source preserved: true", "errors: 0"])
        let fit = safari.switches["Fit entire video"]
        target(fit)
        fit.tap()
        wait(safari, ["fit mode: contain", "video fit: contain"])
        let remaining = safari.buttons["Show remaining time"]
        target(remaining)
        remaining.tap()
        wait(safari, ["remaining mode: true", "duration text: −"])
        safari.buttons["Show total duration"].tap()
        wait(safari, ["remaining mode: false", "duration text: 0:15"])
        let stage = safari.otherElements["Video display"]
        XCTAssertTrue(stage.waitForExistence(timeout: 5))
        // This observed upper media point avoids the HUD transport controls.
        stage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let hidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == false"), object: safari.buttons["Close StayFast video player"])
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed)
        stage.pinch(withScale: 1.6, velocity: 1)
        wait(safari, ["fit mode: cover", "video fit: cover", "native fullscreen: false", "errors: 0"])
        stage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let hiddenAgain = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == false"), object: safari.buttons["Close StayFast video player"])
        XCTAssertEqual(XCTWaiter.wait(for: [hiddenAgain], timeout: 5), .completed)
        stage.pinch(withScale: 0.6, velocity: -1)
        wait(safari, ["fit mode: contain", "video fit: contain", "original identity: true", "source preserved: true", "errors: 0"])
        capture(safari, "fit-fill-pinch-and-remaining-time")
    }
    private func checkPrecisionScrubbing() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let seek = safari.sliders["Seek video"]
        target(seek)
        func midpoint() {
            seek.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let centered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                abs(self.time(safari) - 7.5) < 0.6
            }, object: status(safari))
            XCTAssertEqual(XCTWaiter.wait(for: [centered], timeout: 10), .completed)
        }
        func drag(_ verticalDistance: CGFloat) -> Double {
            midpoint()
            let before = time(safari)
            let start = seek.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let end = start.withOffset(CGVector(dx: 80, dy: verticalDistance))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
            let moved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                self.time(safari) > before + 0.1
            }, object: status(safari))
            XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 10), .completed)
            wait(safari, ["paused: true", "owner active: true", "original identity: true", "source preserved: true", "native fullscreen: false", "errors: 0"])
            return time(safari) - before
        }
        let nearDelta = drag(0)
        capture(safari, "normal-scrubbing-near-bar")
        let farDelta = drag(-170)
        capture(safari, "fine-scrubbing-away-from-bar")
        print("OWNED PRECISION near=" + String(nearDelta) + "; far=" + String(farDelta))
        XCTAssertGreaterThan(nearDelta, 1)
        XCTAssertGreaterThan(farDelta, 0.1)
        // Native XCTest follows a continuous diagonal path through several
        // precision bands. Compare actual seek distances, not an exact band ratio.
        XCTAssertLessThan(farDelta, nearDelta * 0.8)
    }
    private func checkSpeedSelect() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        if !safari.buttons["1.5×"].isHittable {
            reveal(safari)
            let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
            XCTAssertTrue(speed.isHittable)
            // WebKit's native select AX proxy can be 42px even when its
            // actual DOM touch target is 46px. Assert the fixture's DOM rect.
            let parts = status(safari).label.components(separatedBy: "; speed select height: ")
            XCTAssertEqual(parts.count, 2)
            let outerHeight = parts.count == 2 ? Double(parts[1].components(separatedBy: ";")[0]) ?? 0 : 0
            XCTAssertGreaterThanOrEqual(outerHeight, 44)
            speed.tap()
        }
        XCTAssertTrue(safari.buttons["16×"].waitForExistence(timeout: 10))
        safari.buttons["16×"].tap()
        wait(safari, ["Playback rate: 16;", "owner active: true", "paused: true", "errors: 0"])
        capture(safari, "owned-native-menu-16")
        let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
        speed.tap()
        let custom = safari.buttons["Custom…"]
        XCTAssertTrue(custom.waitForExistence(timeout: 10))
        custom.tap()
        let input = safari.textFields["Custom playback speed"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        target(input)
        input.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 16) + "32")
        capture(safari, "owned-custom-speed-keyboard")
        let apply = safari.buttons["Set speed"]
        target(apply)
        apply.tap()
        XCTAssertTrue(safari.staticTexts["Enter a speed between 0.07× and 16×."].waitForExistence(timeout: 10))
        wait(safari, ["Playback rate: 16;", "owner active: true", "paused: true", "errors: 0"])
        capture(safari, "owned-custom-speed-rejected-32")
        input.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 16) + "12")
        apply.tap()
        wait(safari, ["Playback rate: 12;", "owner active: true", "paused: true", "errors: 0"])
        capture(safari, "owned-custom-speed-12")
        safari.switches["Normal speed"].tap()
        wait(safari, ["Playback rate: 1;"])
        speed.tap()
        XCTAssertTrue(safari.buttons["1.5×"].waitForExistence(timeout: 10))
        safari.buttons["1.5×"].tap()
        wait(safari, ["Playback rate: 1.5;", "original identity: true", "source preserved: true", "owner active: true", "native fullscreen: false", "errors: 0"])
        capture(safari, "owned-speed-selected-1-5")
    }
    private func checkOrientationAndAppSwitch() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        reveal(safari)
        if safari.buttons["Play video"].isHittable { safari.buttons["Play video"].tap() }
        wait(safari, ["ready: 4", "paused: false", "owner active: true", "errors: 0", "native fullscreen: false"])
        requireProgress(safari)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        wait(safari, ["owner active: true", "source preserved: true", "original identity: true", "native fullscreen: false", "errors: 0"])
        reveal(safari)
        safari.buttons["Pause video"].tap()
        wait(safari, ["paused: true", "owner active: true", "Playback rate: 1.5;"])
        for label in ["Close StayFast video player", "Play video", "Rewind 10 seconds", "Forward 10 seconds", "Normal speed", "Preferred speed", "Unmute video", "More video options"] {
            let button = ["Normal speed", "Preferred speed"].contains(label) ? safari.switches[label] : safari.buttons[label]
            target(button)
            let frame = button.frame
            let screen = safari.frame
            XCTAssertGreaterThanOrEqual(frame.minX, screen.minX - 1)
            XCTAssertLessThanOrEqual(frame.maxX, screen.maxX + 1)
            XCTAssertGreaterThanOrEqual(frame.minY, screen.minY - 1)
            XCTAssertLessThanOrEqual(frame.maxY, screen.maxY + 1)
        }
        target(safari.sliders["Seek video"])
        capture(safari, "owned-landscape")
        safari.buttons["Play video"].tap()
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication(bundleIdentifier: "co.staytech.stayfast")
        app.activate()
        XCTAssertTrue(app.staticTexts["StayFast Video"].waitForExistence(timeout: 10))
        safari.activate()
        wait(safari, ["owner active: true", "source preserved: true", "original identity: true", "native fullscreen: false", "errors: 0"])
        if status(safari).label.contains("paused: true") { safari.buttons["Play video"].tap() }
        requireProgress(safari)
        capture(safari, "owned-portrait-app-restored")
    }
    private func checkQuickSpeeds() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        for label in ["Normal speed", "Preferred speed"] { target(safari.switches[label]) }
        for _ in 0..<2 {
            safari.switches["Normal speed"].tap()
            wait(safari, ["Playback rate: 1;", "owner active: true", "original identity: true", "errors: 0"])
        }
        safari.switches["Preferred speed"].tap()
        wait(safari, ["Playback rate: 1.8;", "owner active: true", "original identity: true", "errors: 0"])
        safari.switches["Normal speed"].tap()
        wait(safari, ["Playback rate: 1;", "owner active: true"])
        capture(safari, "owned-normal-preferred-quick-actions")
    }
    private func checkDoneReopenAndSiteHandback() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        reveal(safari)
        safari.buttons["Close StayFast video player"].tap()
        wait(safari, ["owner active: false", "owned hosts: 0", "inline restored: true", "source preserved: true", "original identity: true", "native controls: false", "native fullscreen: false", "errors: 0"])
        capture(safari, "done-inline-original-restored")
        let open = safari.buttons["Open StayFast player"]
        if !open.isHittable {
            let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
            XCTAssertTrue(pill.waitForExistence(timeout: 10))
            pill.tap()
        }
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        wait(safari, ["owner active: true", "owned hosts: 1", "original identity: true", "source preserved: true", "ready: 4", "paused: false", "native fullscreen: false", "errors: 0"])
        requireProgress(safari)
        reveal(safari)
        safari.buttons["Pause video"].tap()
        wait(safari, ["paused: true", "owner active: true"])
        capture(safari, "reopened-original-owned-player")
        showMore(safari)
        target(safari.buttons["Use site player"])
        safari.buttons["Use site player"].tap()
        wait(safari, ["owner active: false", "owned hosts: 0", "inline restored: true", "native controls: true", "source preserved: true", "original identity: true", "native fullscreen: false", "errors: 0"])
        safari.buttons["Play test video"].tap()
        wait(safari, ["paused: false", "ready: 4", "owner active: false", "owned hosts: 0", "native controls: true", "errors: 0"])
        requireProgress(safari)
        capture(safari, "explicit-site-player-handback")
        let fullscreen = safari.buttons["Open video fullscreen"]
        target(fullscreen)
        fullscreen.tap()
        wait(safari, ["owner active: true", "owned hosts: 1", "native fullscreen: false", "original identity: true", "source preserved: true", "errors: 0"])
        showMore(safari)
        target(safari.buttons["Open Apple fullscreen player"])
        safari.buttons["Open Apple fullscreen player"].tap()
        wait(safari, ["native fullscreen: true", "owner active: false", "owned hosts: 0", "errors: 0"])
        capture(safari, "native-fullscreen-after-site-handback")
        let close = safari.buttons["Close Button"]
        if !close.isHittable { safari.otherElements["Media"].tap() }
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()
        wait(safari, ["native fullscreen: false", "owner active: false", "owned hosts: 0", "errors: 0"])
        safari.buttons["Pause test video"].tap()
        let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
        pill.tap()
        let custom = safari.buttons["Open StayFast player"]
        XCTAssertTrue(custom.waitForExistence(timeout: 10))
        custom.tap()
        // Pause promptly before reading the long status, so the playing HUD's
        // deliberate idle timer cannot race this final cleanup interaction.
        let pause = safari.buttons["Pause video"]
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        pause.tap()
        wait(safari, ["paused: true", "owner active: true", "owned hosts: 1", "source preserved: true", "original identity: true", "errors: 0"])
        safari.buttons["Close StayFast video player"].tap()
        wait(safari, ["owner active: false", "owned hosts: 0", "native controls: false", "errors: 0"])
        capture(safari, "custom-reopen-after-site-handback")
    }
    private struct PrecisionReport: Decodable {
        let gesture, samples: Int
        let bands: [Double]
        let maxError, verticalDrift, finalError, delta: Double
        let active, paused, truncated: Bool
    }

    private func precisionReport(_ safari: XCUIApplication) -> PrecisionReport? {
        let pieces = status(safari).label.components(separatedBy: "; precision: ")
        guard pieces.count == 2, let data = pieces[1].data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(PrecisionReport.self, from: data)
    }

    func testPrecisionScrubbingPaths() throws {
        try checkPrecisionScrubbingPaths(false)
    }

    func testPrecisionScrubbingPathsLandscape() throws {
        try checkPrecisionScrubbingPaths(true)
    }

    private func checkPrecisionScrubbingPaths(_ landscape: Bool) throws {
        openAndVerifyPlayback()
        checkTransportAndMute()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        if landscape { XCUIDevice.shared.orientation = .landscapeLeft }
        defer { if landscape { XCUIDevice.shared.orientation = .portrait } }
        let seek = safari.sliders["Seek video"]
        func drag(_ name: String, _ dx: CGFloat, _ dy: CGFloat, _ velocity: XCUIGestureVelocity) throws -> PrecisionReport {
            target(seek)
            seek.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let centered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(self.time(safari) - 7.5) < 0.6 }, object: status(safari))
            XCTAssertEqual(XCTWaiter.wait(for: [centered], timeout: 10), .completed)
            let prior = precisionReport(safari)?.gesture ?? 0
            let start = seek.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: dx, dy: dy)), withVelocity: velocity, thenHoldForDuration: 0.1)
            let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard let report = self.precisionReport(safari) else { return false }
                return report.gesture > prior && !report.active && report.samples > 2
            }, object: status(safari))
            XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: 10), .completed)
            capture(safari, "precision-path-" + name)
            let report = try XCTUnwrap(precisionReport(safari))
            print("PRECISION PATH " + name + ": " + (status(safari).label.components(separatedBy: "; precision: ").last ?? "missing"))
            XCTAssertFalse(report.truncated)
            XCTAssertTrue(report.paused)
            XCTAssertLessThan(report.maxError, 0.00001)
            XCTAssertLessThan(report.verticalDrift, 0.00001)
            XCTAssertLessThan(report.finalError, 0.02)
            return report
        }
        let near = try drag("normal", 80, 0, .slow)
        XCTAssertEqual(near.bands, [1])
        XCTAssertGreaterThan(near.delta, 0.5)
        let vertical = try drag("vertical-only", 0, -170, .slow)
        XCTAssertEqual(vertical.bands, [1, 0.5, 0.25, 0.1])
        XCTAssertLessThan(abs(vertical.delta), 0.00001)
        let slow = try drag("diagonal-slow", 80, -170, .slow)
        XCTAssertEqual(slow.bands, [1, 0.5, 0.25, 0.1])
        XCTAssertGreaterThan(slow.delta, 0.1)
        XCTAssertLessThan(slow.delta, near.delta * 0.8)
        let fast = try drag("diagonal-fast", 80, -170, .fast)
        XCTAssertGreaterThan(fast.delta, 0.1)
        XCTAssertLessThan(abs(fast.delta - slow.delta), near.delta * 0.15)
        wait(safari, ["owner active: true", "original identity: true", "source preserved: true", "errors: 0"])
        safari.buttons["Close StayFast video player"].tap()
        wait(safari, ["owner active: false", "owned hosts: 0", "errors: 0"])
    }

    func testThinBottomTimeline() {
        openAndVerifyPlayback()
        checkTransportAndMute()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        wait(safari, ["timeline height: 44", "seek direction: ltr", "timeline last: true", "timeline after options: true", "timeline bottom gap: 0", "errors: 0"])
        target(safari.sliders["Seek video"])
        checkBottomMorePanel(safari, "portrait")
        checkBottomCustomSpeed(safari)
        capture(safari, "thin-bottom-timeline-portrait")
        checkPrecisionScrubbing()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        wait(safari, ["timeline height: 44", "seek direction: ltr", "timeline last: true", "timeline after options: true", "timeline bottom gap: 0", "errors: 0"])
        target(safari.sliders["Seek video"])
        checkBottomMorePanel(safari, "landscape")
        capture(safari, "thin-bottom-timeline-landscape")
        safari.buttons["Close StayFast video player"].tap()
        wait(safari, ["owner active: false", "owned hosts: 0", "original identity: true", "source preserved: true", "errors: 0"])
    }

    private func checkBottomMorePanel(_ safari: XCUIApplication, _ orientation: String) {
        let more = safari.buttons["More video options"]
        target(more)
        more.tap()
        let site = safari.buttons["Use site player"]
        XCTAssertTrue(site.waitForExistence(timeout: 5))
        target(site)
        target(more)
        XCTAssertLessThan(site.frame.maxY, more.frame.minY)
        capture(safari, "bottom-timeline-more-" + orientation)
        more.tap()
        XCTAssertTrue(site.waitForNonExistence(timeout: 5))
        target(safari.sliders["Seek video"])
    }

    private func checkBottomCustomSpeed(_ safari: XCUIApplication) {
        let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
        speed.tap()
        let custom = safari.buttons["Custom…"]
        XCTAssertTrue(custom.waitForExistence(timeout: 10))
        custom.tap()
        let input = safari.textFields["Custom playback speed"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        target(input)
        input.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 16) + "1.5")
        let apply = safari.buttons["Set speed"]
        target(apply)
        capture(safari, "bottom-timeline-custom-speed-keyboard")
        apply.tap()
        wait(safari, ["Playback rate: 1.5;", "owner active: true", "paused: true", "errors: 0"])
        safari.switches["Normal speed"].tap()
        wait(safari, ["Playback rate: 1;"])
    }

    func testOwnedPlayerRuntime() {
        print("OWNED CHECK explicit custom original-video playback")
        openAndVerifyPlayback()
        print("OWNED CHECK transport and mute")
        checkTransportAndMute()
        print("OWNED CHECK distance-based precision scrubbing")
        checkPrecisionScrubbing()
        print("OWNED CHECK fit, pinch and remaining time")
        checkPresentation()
        print("OWNED CHECK absolute normal and preferred speed")
        checkQuickSpeeds()
        print("OWNED CHECK native speed menu")
        checkSpeedSelect()
        print("OWNED CHECK rotation and app switching")
        checkOrientationAndAppSwitch()
        print("OWNED CHECK Done, reopen and site-player handback")
        checkDoneReopenAndSiteHandback()
    }
}
