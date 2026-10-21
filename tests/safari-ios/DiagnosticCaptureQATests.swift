import XCTest

/// Synthetic capture/export acceptance. Intentional fixture scrolling is not a live-site reproduction.
@MainActor final class DiagnosticCaptureQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }
    private func fixtureStatus(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Diagnostic fixture:'")).firstMatch
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let status = fixtureStatus(safari)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pieces.allSatisfy { status.label.contains($0) } }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
    }
    private func progress(_ safari: XCUIApplication) {
        let status = fixtureStatus(safari)
        let time = { () -> Double in
            let value = status.label.components(separatedBy: "; ").first(where: { $0.hasPrefix("time: ") }) ?? ""
            return Double(value.replacingOccurrences(of: "time: ", with: "")) ?? -1
        }
        let before = time(); XCTAssertGreaterThanOrEqual(before, 0)
        let advancing = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in status.label.contains("paused: false") && (time() > before + 0.15 || time() < before - 1) }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [advancing], timeout: 8), .completed)
    }
    private func capture(_ safari: XCUIApplication, _ name: String, report: String = "") {
        let state = XCTAttachment(string: report + "\n" + safari.debugDescription); state.name = name + "-state"; state.lifetime = .keepAlways; add(state)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func openPopup(_ safari: XCUIApplication) {
        let menu = safari.buttons["PageFormatMenuButton"]
        if !menu.exists {
            // A genuine feed swipe collapses Safari's toolbar into this observed AX element.
            let address = safari.descendants(matching: .any).matching(identifier: "TabBarItemTitle").firstMatch
            XCTAssertTrue(address.exists); address.tap()
            let cancel = safari.buttons["Cancel"].firstMatch
            if cancel.exists && cancel.isHittable { cancel.tap() }
            XCTAssertTrue(menu.waitForExistence(timeout: 10))
        }
        menu.tap()
        capture(safari, "diagnostic-page-menu")
        let actions = safari.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'StayFast'"))
        guard let entry = actions.allElementsBoundByIndex.first(where: { $0.isHittable && ($0.elementType == .button || $0.elementType == .cell) }) else {
            XCTFail("StayFast extension action unavailable in observed Safari Page Menu"); return
        }
        entry.tap()
        XCTAssertTrue(safari.buttons["Start new capture"].waitForExistence(timeout: 15))
        let start = safari.buttons["Start new capture"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in start.isEnabled }, object: start)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 15), .completed)
        capture(safari, "diagnostic-popup-open")
    }
    private func closePopup(_ safari: XCUIApplication) {
        // Native extension sheet controls are inspected in the preceding attachment.
        for name in ["Done", "Close"] {
            let button = safari.buttons[name].firstMatch
            if button.exists && button.isHittable { button.tap(); return }
        }
        capture(safari, "diagnostic-popup-dismiss-unavailable")
        XCTFail("No semantic dismissal control in the observed Safari extension popup")
    }
    private func dismissShare(_ safari: XCUIApplication) {
        let regions = safari.otherElements.matching(identifier: "PopoverDismissRegion").allElementsBoundByIndex
        guard let region = regions.last(where: { $0.isHittable }) else {
            capture(safari, "diagnostic-share-dismiss-unavailable"); XCTFail("No hittable observed native share dismissal region"); return
        }
        region.tap()
    }
    private func exported(_ safari: XCUIApplication) -> String {
        let output = safari.textViews["Prepared diagnostic report"]
        XCTAssertTrue(output.waitForExistence(timeout: 15))
        return output.value as? String ?? ""
    }
    private func events(_ report: String) -> [[String:Any]] {
        guard let data = report.data(using: .utf8), let envelope = try? JSONSerialization.jsonObject(with: data) as? [String:Any],
              envelope["schema"] as? Int == 1, let frames = envelope["frames"] as? [[String:Any]], !frames.isEmpty else {
            XCTFail("Missing exported frame envelope"); return []
        }
        XCTAssertEqual(envelope["browser"] as? String, "safari")
        return frames.flatMap { frame -> [[String:Any]] in
            guard let report = frame["report"] as? [String:Any], let entries = report["events"] as? [[String:Any]] else { XCTFail("Missing frame report"); return [] }
            XCTAssertEqual(report["active"] as? Bool, false)
            XCTAssertEqual(report["reason"] as? String, "suspected-top-jump")
            return entries
        }
    }
    func testDiagnosticCaptureAndExport() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        wait(safari, ["older controller: true", "generation: 0", "errors: 0"])
        openPopup(safari)
        let initial = exported(safari)
        if let data = initial.data(using: .utf8), let envelope = try? JSONSerialization.jsonObject(with: data) as? [String:Any], let frames = envelope["frames"] as? [[String:Any]] {
            XCTAssertFalse(frames.isEmpty)
            for frame in frames { XCTAssertEqual((frame["report"] as? [String:Any])?["active"] as? Bool, false, "Opening the popup must not start non-X capture") }
        } else { XCTFail("Missing initial inactive diagnostic report") }
        safari.buttons["Start new capture"].tap()
        let capturing = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Capturing'")).firstMatch
        XCTAssertTrue(capturing.waitForExistence(timeout: 15))
        capture(safari, "diagnostic-capture-started", report: exported(safari))
        closePopup(safari)
        safari.buttons["Prepare diagnostic baseline"].tap()
        wait(safari, ["recorder: true", "page: 0,720", "nested: 70,220"])
        safari.buttons["Load next diagnostic video"].tap()
        wait(safari, ["generation: 1", "ready: 4", "paused: false", "controllers: 2", "native begins: 0", "request error: none", "errors: 0"])
        progress(safari)
        safari.buttons["Reuse diagnostic source"].tap()
        wait(safari, ["generation: 2", "ready: 4", "paused: false", "controllers: 2", "native begins: 0", "request error: none", "errors: 0"])
        progress(safari)
        safari.buttons["Jump diagnostic feed to top"].tap()
        wait(safari, ["intent: intentional synthetic jump", "page: 0,0", "nested: 0,0", "errors: 0"])
        safari.buttons["Inspect recorder snapshot"].tap()
        let raw = safari.textViews["Diagnostic recorder snapshot"].value as? String ?? ""
        capture(safari, "diagnostic-fixture-jump", report: raw)
        openPopup(safari)
        safari.buttons["Stop & prepare report"].tap()
        let stopped = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Capture stopped'")).firstMatch
        XCTAssertTrue(stopped.waitForExistence(timeout: 15))
        let report = exported(safari), entries = events(report)
        capture(safari, "diagnostic-prepared-report", report: report)
        XCTAssertFalse(entries.isEmpty)
        XCTAssertTrue(entries.contains { $0["event"] as? String == "scroll-before-jump" })
        XCTAssertTrue(entries.contains { $0["event"] as? String == "suspected-top-jump" })
        XCTAssertTrue(entries.contains { ($0["page"] as? [String:Double])?["y"] == 720 })
        XCTAssertTrue(entries.contains { $0["event"] as? String == "suspected-top-jump" && ($0["page"] as? [String:Double])?["y"] == 0 })
        guard let incident = entries.first(where: { $0["event"] as? String == "suspected-top-jump" }), let incidentSeq = incident["seq"] as? Double,
              let before = entries.last(where: { ($0["seq"] as? Double ?? .infinity) < incidentSeq && ($0["scrollers"] as? [[String:Double]])?.contains(where: { $0["x"] == 70 && $0["y"] == 220 }) == true }),
              let nested = (before["scrollers"] as? [[String:Double]])?.first(where: { $0["x"] == 70 && $0["y"] == 220 }), let nestedID = nested["id"] else { XCTFail("Missing mandatory pre-incident nested identity"); return }
        for phase in [1.0,2.0] {
            XCTAssertTrue(entries.contains { event in
                event["event"] as? String == "frame" && event["trigger"] as? String == "suspected-top-jump" && event["phase"] as? Double == phase && (event["seq"] as? Double ?? 0) > incidentSeq &&
                (event["scrollers"] as? [[String:Double]])?.contains(where: { $0["id"] == nestedID && $0["x"] == 0 && $0["y"] == 0 }) == true
            }, "Each incident frame must retain the same nested scroller identity at 0,0")
        }
        XCTAssertGreaterThanOrEqual(entries.filter { $0["event"] as? String == "loadstart" }.count, 2)
        XCTAssertFalse(report.contains("sample.mp4")); XCTAssertFalse(report.contains("new-video")); XCTAssertFalse(report.contains("Synthetic Safari capture/export check"))
        safari.buttons["Copy report"].tap()
        XCTAssertTrue(safari.staticTexts["Report copied."].waitForExistence(timeout: 10))
        capture(safari, "diagnostic-report-copied", report: report)
        safari.buttons["Share / save report"].tap()
        let sheet = safari.otherElements["ActivityListView"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 30))
        let save = safari.cells["Save to Files"]
        XCTAssertTrue(save.waitForExistence(timeout: 45))
        capture(safari, "diagnostic-native-share-sheet")
        dismissShare(safari)
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !sheet.exists }, object: sheet)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 10), .completed)
    }
    func testAutomaticPublicXCapture() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        XCTAssertTrue(safari.webViews.firstMatch.waitForExistence(timeout: 30))
        if safari.buttons["Dismiss"].exists { safari.buttons["Dismiss"].tap() }
        safari.webViews.firstMatch.swipeUp()
        capture(safari, "diagnostic-public-x-before-popup")
        openPopup(safari)
        // This flow deliberately never invokes Start new capture.
        safari.buttons["Stop & prepare report"].tap()
        let stopped = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Capture stopped'")).firstMatch
        XCTAssertTrue(stopped.waitForExistence(timeout: 15))
        let report = exported(safari)
        capture(safari, "diagnostic-public-x-auto-report", report: report)
        guard let data = report.data(using: .utf8), let envelope = try? JSONSerialization.jsonObject(with: data) as? [String:Any],
              let frames = envelope["frames"] as? [[String:Any]] else { XCTFail("Missing public X frame report"); return }
        let reports = frames.compactMap { $0["report"] as? [String:Any] }
        XCTAssertTrue(reports.contains { ["diagnostic-build","suspected-top-jump"].contains($0["reason"] as? String ?? "") })
        XCTAssertTrue(reports.contains { ($0["events"] as? [[String:Any]])?.contains(where: { $0["event"] as? String == "capture-start" }) == true })
        XCTAssertFalse(report.contains("x.com/")); XCTAssertFalse(report.contains("NASA"))
    }


}
