import XCTest

/// Run only on an explicitly selected, disposable simulator (see README).
/// The two phases let simctl open the fixture after granting website access.
@MainActor
final class SafariQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @discardableResult
    private func waitForStatus(_ safari: XCUIApplication, _ fragments: [String]) -> XCUIElement {
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Playback rate:'")).firstMatch
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            fragments.allSatisfy { status.label.contains($0) }
        }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 20), .completed)
        return status
    }

    func testContainingAppLinks() {
        let app = XCUIApplication(bundleIdentifier: "co.staytech.stayfast")
        app.launch()
        XCTAssertTrue(app.staticTexts["StayFast Video"].waitForExistence(timeout: 15))
        let privacy = app.links["Privacy policy"]
        for _ in 0..<5 {
            if privacy.isHittable { break }
            app.swipeUp()
        }
        capture(app, "main-privacy-support-links")
        privacy.tap()
        XCTAssertTrue(app.staticTexts["Playback stays on your device"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Support and TestFlight"].exists)
        capture(app, "local-privacy-policy")
        app.links["Back to StayFast Video"].tap()
        XCTAssertTrue(app.staticTexts["StayFast Video"].waitForExistence(timeout: 15))
        capture(app, "privacy-back-to-main")

        let support = app.links["Support"]
        for _ in 0..<5 {
            if support.isHittable { break }
            app.swipeUp()
        }
        support.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15))
        capture(safari, "support-in-system-safari")
        let address = safari.textFields["Address"]
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        XCTAssertTrue((address.value as? String ?? "").contains("github.com"))
    }

    func testActivation() {
        let app = XCUIApplication(bundleIdentifier: "co.staytech.stayfast")
        app.launch()
        XCTAssertTrue(app.staticTexts["StayFast Video"].waitForExistence(timeout: 15))
        capture(app, "containing-app")

        // Restart Settings: a detail page retained across ad hoc app replacement
        // can refer to the old plugin and show a disabled, blank extension.
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        for _ in 0..<5 {
            if settings.buttons["Apps"].isHittable { break }
            settings.swipeUp()
        }
        settings.buttons["Apps"].tap()
        for _ in 0..<5 {
            if settings.buttons["Safari"].isHittable { break }
            settings.swipeUp()
        }
        settings.buttons["Safari"].tap()
        let extensions = settings.cells["WEB_EXTENSIONS"]
        for _ in 0..<4 {
            if extensions.isHittable { break }
            settings.swipeUp()
        }
        extensions.tap()
        let entry = settings.cells["co.staytech.stayfast.Extension"]
        XCTAssertTrue(entry.waitForExistence(timeout: 15))
        entry.tap()
        capture(settings, "extension-before-activation")

        // The named Switch wraps a native Switch. Tap the observed inner
        // control; tapping the wrapper's text area does not toggle it on iOS26.
        let allow = settings.cells["Allow Extension"].switches.element(boundBy: 1)
        XCTAssertTrue(allow.waitForExistence(timeout: 10))
        XCTAssertTrue(allow.isEnabled)
        if allow.value as? String == "0" { allow.tap() }
        let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: allow)
        XCTAssertEqual(XCTWaiter.wait(for: [on], timeout: 10), .completed)
        capture(settings, "extension-enabled")
        let sites = settings.cells["All Websites"]
        for _ in 0..<3 {
            if sites.isHittable { break }
            settings.swipeUp()
        }
        sites.tap()
        settings.cells["1"].tap()
        XCTAssertTrue(settings.cells["1"].isSelected)
        capture(settings, "all-websites-allowed")
    }

    /// Diagnostic, not a universal speed guarantee. Open /rate-probe.html first.
    func testNativeRateProbe() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let start = safari.buttons["Start rate probe"]
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        start.tap()
        let result = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Rate probe complete:'")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 120))
        print("NATIVE RATE RESULT " + result.label)
        let text = XCTAttachment(string: result.label)
        text.name = "native-rate-result"; text.lifetime = .keepAlways; add(text)
        capture(safari, "native-rate-probe")
        let prefix = "Rate probe complete: "
        guard let data = String(result.label.dropFirst(prefix.count)).data(using: .utf8),
              let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let validation = report["validation"] as? [String: Any],
              let cadence = validation["cadence"] as? [String: Any],
              let cadencePassed = cadence["passed"] as? Bool else {
            XCTFail("Missing parsed functional/cadence validation in native probe report")
            return
        }
        XCTAssertEqual(validation["passed"] as? Bool, true, "Functional playback failed: \(validation)")
        // Cadence is reported independently for paired baseline/control review;
        // functional success does not promise smooth playback on other devices.
        print("NATIVE RATE CADENCE TARGET PASSED \(cadencePassed): \(cadence)")
    }

    func testRuntime() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        XCTAssertTrue(safari.buttons["Play test video"].waitForExistence(timeout: 20))
        // Normal playback remains inline; the primary fullscreen target must
        // enter the native video presentation without an owned-player portal.
        safari.buttons["Play test video"].tap()
        waitForStatus(safari, ["ready: 4; errors: 0;", "native fullscreen: false", "owner active: false", "owned hosts: 0", "native controls: true"])
        XCTAssertFalse(safari.buttons["Close StayFast video player"].exists)
        capture(safari, "inline-before-direct-native-fullscreen")
        safari.buttons["Pause test video"].tap()
        waitForStatus(safari, ["paused: true"])
        let pills = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '"))
        XCTAssertTrue(pills.firstMatch.waitForExistence(timeout: 20))
        XCTAssertEqual(pills.count, 1)
        pills.firstMatch.tap()
        // WebKit exposes aria-pressed buttons as native Switches.
        let preset = safari.switches["Set playback speed to 1.5 times"]
        XCTAssertTrue(preset.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(preset.frame.width, 44)
        XCTAssertGreaterThanOrEqual(preset.frame.height, 44)
        // Default-size compact panel rows must not stretch to viewport height.
        XCTAssertLessThanOrEqual(preset.frame.height, 64)
        XCTAssertLessThanOrEqual(safari.buttons["Close speed controls"].frame.height, 64)
        capture(safari, "touch-panel")
        preset.tap()
        safari.buttons["Close speed controls"].tap()
        safari.buttons["Play test video"].tap()
        let playing = ["Playback rate: 1.5; controllers: 1; ready: 4; errors: 0;", "paused: false", "media error: 0"]
        let status = waitForStatus(safari, playing)
        let progress = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let parts = status.label.components(separatedBy: "; time: ")
            guard parts.count == 2,
                  let time = Double(parts[1].components(separatedBy: ";")[0]) else { return false }
            return time >= 0.5
        }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [progress], timeout: 15), .completed)
        capture(safari, "verified-inline-playback")
        pills.firstMatch.tap()
        XCTAssertTrue(safari.buttons["Close speed controls"].waitForExistence(timeout: 5))
        let idleClosed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: safari.buttons["Close speed controls"])
        XCTAssertEqual(XCTWaiter.wait(for: [idleClosed], timeout: 10), .completed)
        waitForStatus(safari, ["paused: false", "owner active: false", "owned hosts: 0"])
        capture(safari, "playing-compact-after-idle")

        let fullscreen = safari.buttons["Open video fullscreen"]
        XCTAssertGreaterThanOrEqual(fullscreen.frame.width, 44)
        XCTAssertGreaterThanOrEqual(fullscreen.frame.height, 44)
        XCTAssertTrue(fullscreen.isEnabled)
        fullscreen.tap()
        waitForStatus(safari, ["native fullscreen: true", "Playback rate: 1.5; controllers: 1;"])
        XCTAssertEqual(pills.count, 0)
        capture(safari, "native-fullscreen")
        let close = safari.buttons["Close Button"]
        if !close.isHittable {
            let media = safari.otherElements["Media"]
            XCTAssertTrue(media.waitForExistence(timeout: 10))
            media.tap()
        }
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()
        waitForStatus(safari, ["native fullscreen: false", "Playback rate: 1.5; controllers: 1; ready: 4; errors: 0;", "owner active: false", "owned hosts: 0"])
        safari.buttons["Play test video"].tap()
        waitForStatus(safari, playing)
        XCTAssertEqual(pills.count, 1)
        XCTAssertTrue(pills.firstMatch.isHittable)
        capture(safari, "inline-return")

        let app = XCUIApplication(bundleIdentifier: "co.staytech.stayfast")
        app.activate()
        XCTAssertTrue(app.staticTexts["StayFast Video"].waitForExistence(timeout: 10))
        safari.activate()
        waitForStatus(safari, ["Playback rate: 1.5; controllers: 1; ready: 4; errors: 0;"])
        XCTAssertEqual(pills.count, 1)
        XCTAssertTrue(pills.firstMatch.isHittable)
        capture(safari, "app-switch-restored")
    }
}
