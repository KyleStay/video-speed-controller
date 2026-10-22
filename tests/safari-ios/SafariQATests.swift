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
        settings.terminate()
        settings.launch()
        // Settings restores its navigation stack across launches. Return through
        // observed back controls before looking for the root Apps row.
        for _ in 0..<6 {
            let back = settings.buttons["BackButton"]
            if !back.exists { break }
            back.tap()
        }
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
        if !settings.navigationBars["Safari"].waitForExistence(timeout: 5),
           settings.navigationBars["Apps"].exists {
            settings.buttons["Safari"].tap()
        }
        XCTAssertTrue(settings.navigationBars["Safari"].waitForExistence(timeout: 10))
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

    func testTouchDelivery() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let probe = safari.buttons["Touch delivery probe"]
        XCTAssertTrue(probe.waitForExistence(timeout: 15))
        probe.tap(withNumberOfTaps: 2, numberOfTouches: 1)
        let count = safari.staticTexts["Touch deliveries: 2"]
        XCTAssertTrue(count.waitForExistence(timeout: 5))
        capture(safari, "native-double-tap-delivery")
    }

    func testTouchSeekAndLock() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        XCTAssertTrue(safari.buttons["Play test video"].waitForExistence(timeout: 20))
        safari.buttons["Play test video"].tap()
        waitForStatus(safari, ["ready: 4", "paused: false", "owner active: false"])
        safari.buttons["Pause test video"].tap()
        waitForStatus(safari, ["paused: true"])
        safari.buttons["Open video fullscreen"].tap()
        waitForStatus(safari, ["owner active: true", "native fullscreen: false", "paused: true"])
        func position() -> Double {
            let value = waitForStatus(safari, ["owner active: true"]).label
            let parts = value.components(separatedBy: "; time: ")
            return parts.count > 1 ? Double(parts[1].components(separatedBy: ";")[0]) ?? -1 : -1
        }
        safari.buttons["Forward 10 seconds"].tap()
        let before = position()
        XCTAssertGreaterThanOrEqual(before, 9)
        let stage = safari.otherElements["Video display"]
        XCTAssertTrue(stage.waitForExistence(timeout: 10))
        stage.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.45)).doubleTap()
        waitForStatus(safari, ["seek feedback: −", "paused: true", "owner active: true"])
        XCTAssertLessThan(position(), before - 5)
        capture(safari, "owned-touch-seek-feedback")
        safari.switches["Lock playback controls"].tap()
        waitForStatus(safari, ["controls locked: true", "paused: true"])
        let lockedPosition = position()
        stage.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45)).doubleTap()
        XCTAssertEqual(position(), lockedPosition, accuracy: 0.15)
        XCTAssertFalse(safari.buttons["Forward 10 seconds"].exists)
        XCTAssertFalse(safari.buttons["Close StayFast video player"].exists)
        XCTAssertGreaterThanOrEqual(safari.buttons["Unlock playback controls"].frame.height, 44)
        capture(safari, "locked-touch-does-not-seek")
        safari.buttons["Unlock playback controls"].tap()
        waitForStatus(safari, ["controls locked: false", "paused: true"])
        safari.buttons["Forward 10 seconds"].tap()
        waitForStatus(safari, ["seek feedback: +", "owner active: true"])
        safari.buttons["Close StayFast video player"].tap()
        waitForStatus(safari, ["owner active: false", "owned hosts: 0", "original identity: true", "source preserved: true", "native controls: false"])
        capture(safari, "enhanced-controls-inline-return")
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
        // open StayFast with its controls; Apple player remains an explicit choice.
        safari.buttons["Play test video"].tap()
        waitForStatus(safari, ["ready: 4; errors: 0;", "native fullscreen: false", "owner active: false", "owned hosts: 0", "native controls: false"])
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
        waitForStatus(safari, ["native fullscreen: false", "owner active: true", "owned hosts: 1", "source preserved: true", "original identity: true"])
        XCTAssertTrue(safari.buttons["Close StayFast video player"].exists)
        capture(safari, "primary-owned-fullscreen")
        let lock = safari.switches["Lock playback controls"]
        if !lock.isHittable {
            safari.otherElements["Video display"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        }
        XCTAssertTrue(lock.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(lock.frame.height, 44)
        lock.tap()
        waitForStatus(safari, ["controls locked: true", "paused: false", "Playback rate: 1.5;"])
        let unlock = safari.buttons["Unlock playback controls"]
        XCTAssertTrue(unlock.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(unlock.frame.height, 44)
        XCTAssertFalse(safari.buttons["Close StayFast video player"].exists)
        capture(safari, "owned-controls-locked")
        unlock.tap()
        waitForStatus(safari, ["controls locked: false", "paused: false", "owner active: true"])
        safari.buttons["More video options"].tap()
        let apple = safari.buttons["Open Apple fullscreen player"]
        XCTAssertTrue(apple.waitForExistence(timeout: 10))
        apple.tap()
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
    /// Open a fresh /mobile.html?mp4 fixture without the owned diagnostic mirror.
    func testPlayerAppearance() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        XCTAssertTrue(safari.buttons["Play test video"].waitForExistence(timeout: 20))
        safari.buttons["Play test video"].tap()
        waitForStatus(safari, ["ready: 4", "paused: false", "errors: 0", "native fullscreen: false"])
        safari.buttons["Pause test video"].tap()
        waitForStatus(safari, ["paused: true", "errors: 0"])
        safari.buttons["Open video fullscreen"].tap()

        let done = safari.buttons["Close StayFast video player"]
        let lock = safari.switches["Lock playback controls"]
        let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        for control in [done, lock] {
            XCTAssertTrue(control.isHittable)
            XCTAssertGreaterThanOrEqual(control.frame.width, 44)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44)
        }
        // WebKit's native select AX proxy can be 42px. The owned-runtime
        // diagnostics separately require its actual DOM target to be at least 44px.
        XCTAssertTrue(speed.isHittable)
        XCTAssertTrue(safari.buttons["Play video"].isHittable)
        capture(safari, "clean-owned-player-portrait")

        lock.tap()
        let unlock = safari.buttons["Unlock playback controls"]
        XCTAssertTrue(unlock.waitForExistence(timeout: 10))
        XCTAssertTrue(unlock.isHittable)
        XCTAssertGreaterThanOrEqual(unlock.frame.width, 44)
        XCTAssertGreaterThanOrEqual(unlock.frame.height, 44)
        XCTAssertFalse(done.exists)
        XCTAssertFalse(lock.exists)
        XCTAssertFalse(speed.exists)
        for label in ["Play video", "Rewind 10 seconds", "Forward 10 seconds", "More video options"] {
            XCTAssertFalse(safari.buttons[label].exists)
        }
        XCTAssertFalse(safari.sliders["Seek video"].exists)
        capture(safari, "clean-owned-player-locked")

        unlock.tap()
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        XCTAssertTrue(done.isHittable)
        XCTAssertTrue(lock.isHittable)
        XCTAssertTrue(speed.isHittable)
        done.tap()
        waitForStatus(safari, ["controllers: 1", "ready: 4", "paused: true", "errors: 0", "native fullscreen: false"])
        XCTAssertFalse(done.exists)
        XCTAssertTrue(safari.buttons["Open video fullscreen"].isHittable)
        capture(safari, "clean-owned-player-inline-return")
    }

    /// Fresh /mobile.html?mp4&owned&takeover&standard-fullscreen&onload-fullscreen.
    func testInlineTakeoverAndSiteFullscreen() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        waitForStatus(safari, ["errors: 0", "paused: true", "native controls: false", "owner active: false", "owned hosts: 0", "takeover native begins: 0", "takeover native DOM: 0", "takeover inserts: 0", "takeover site controls hidden: true", "takeover unrelated visible: true", "takeover onload complete: true", "page scroll: 0,0"])
        func position() -> Double {
            let text = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Playback rate:'")).firstMatch.label
            let fields = text.components(separatedBy: "; time: ")
            return fields.count == 2 ? Double(fields[1].components(separatedBy: ";")[0]) ?? -1 : -1
        }
        let play = safari.buttons["Play video"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        XCTAssertTrue(play.isHittable)
        XCTAssertGreaterThanOrEqual(play.frame.width, 44)
        XCTAssertGreaterThanOrEqual(play.frame.height, 44)
        play.tap()
        waitForStatus(safari, ["ready: 4", "paused: false", "native controls: false", "owner active: false", "takeover inserts: 0", "takeover native begins: 0"])
        let starting = position()
        let progress = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in position() > starting + 0.3 }, object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [progress], timeout: 8), .completed)
        safari.buttons["Pause video"].tap()
        waitForStatus(safari, ["paused: true"])
        let unmute = safari.buttons["Unmute video"]
        XCTAssertTrue(unmute.isHittable); unmute.tap()
        XCTAssertTrue(safari.buttons["Mute video"].waitForExistence(timeout: 5))
        waitForStatus(safari, ["muted: false"])
        let beforeSeek = position()
        let timeline = safari.sliders["Seek video"]
        XCTAssertTrue(timeline.isHittable)
        timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)).tap()
        let sought = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(position() - beforeSeek) > 1 }, object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [sought], timeout: 8), .completed)
        waitForStatus(safari, ["native controls: false", "owner active: false", "owned hosts: 0", "takeover native begins: 0", "takeover inserts: 0", "original identity: true", "source preserved: true"])
        capture(safari, "takeover-owned-inline-controls")

        let site = safari.buttons["Site Apple fullscreen"]
        XCTAssertTrue(site.isHittable); site.tap()
        waitForStatus(safari, ["owner active: true", "owned hosts: 1", "native fullscreen: false", "takeover last request: webkit", "takeover native begins: 0", "takeover native DOM: 0", "original identity: true", "source preserved: true"])
        XCTAssertTrue(safari.buttons["Close StayFast video player"].isHittable)
        capture(safari, "takeover-site-api-owned-player")
        safari.buttons["More video options"].tap()
        safari.buttons["Use site player"].tap()
        waitForStatus(safari, ["owner active: false", "owned hosts: 0", "native controls: true", "takeover APIs restored: true", "takeover site controls hidden: false", "takeover unrelated visible: true", "original identity: true", "source preserved: true"])
        site.tap()
        waitForStatus(safari, ["native fullscreen: true", "owner active: false", "owned hosts: 0", "takeover native begins: 1"])
        capture(safari, "takeover-explicit-site-handback")
        let close = safari.buttons["Close Button"]
        if !close.isHittable { safari.otherElements["Media"].tap() }
        XCTAssertTrue(close.waitForExistence(timeout: 10)); close.tap()
        waitForStatus(safari, ["native fullscreen: false", "native controls: true", "owner active: false", "owned hosts: 0", "errors: 0"])
    }

}
