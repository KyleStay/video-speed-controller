import XCTest

/// Synthetic geometry probe. It records intermediate layout; it does not invent a site scroll-to-top handler.
@MainActor final class LayoutFeedQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }
    private func capture(_ safari: XCUIApplication, _ name: String) {
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Layout status:'")).firstMatch
        let trace = safari.textViews["Layout event trace"]
        let state = XCTAttachment(string: status.label + "\n" + String(describing: trace.value ?? "") + "\n" + safari.debugDescription)
        state.name = name + "-state"; state.lifetime = .keepAlways; add(state)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    func testTransformedOffscreenInsertion() { runGeometry(requireStableInsertion: false) }
    func testTransformedOffscreenStableInsertion() { runGeometry(requireStableInsertion: true) }
    private func runGeometry(requireStableInsertion: Bool) {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        XCTAssertTrue(safari.buttons["Prepare layout baseline"].waitForExistence(timeout: 20))
        safari.buttons["Prepare layout baseline"].tap()
        capture(safari, "layout-prepared")
        safari.buttons["Load offscreen video"].tap()
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Layout status:'")).firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in status.label.contains("inserted: true") && status.label.contains("ready: 4") }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
        capture(safari, "layout-inserted")
        let trace = safari.textViews["Layout event trace"].value as? String ?? ""
        XCTAssertTrue(trace.contains("controller-inserted"), trace)
        XCTAssertTrue(trace.contains("second-frame"), trace)
        if requireStableInsertion {
            guard let data = trace.data(using: .utf8), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
                  let initial = rows.first(where: { $0["event"] as? String == "controller-inserted" }),
                  let settled = rows.first(where: { $0["event"] as? String == "second-frame" }),
                  let initialTop = initial["controllerTop"] as? Double,
                  let settledTop = settled["controllerTop"] as? Double,
                  let initialHeight = initial["scrollHeight"] as? Double,
                  let settledHeight = settled["scrollHeight"] as? Double else { XCTFail("Missing mandatory geometry samples"); return }
            XCTAssertEqual(initialTop, settledTop, accuracy: 1, "Insertion must already use final viewport coordinates")
            XCTAssertEqual(initialHeight, settledHeight, accuracy: 1, "Controller insertion must not inflate scroll extent")
            for row in rows where ["prepared", "controller-inserted", "first-frame", "second-frame"].contains(row["event"] as? String ?? "") {
                XCTAssertEqual(row["page"] as? [Int], [0,720]); XCTAssertEqual(row["nested"] as? [Int], [70,650])
            }
        }
        XCTAssertTrue(status.label.contains("errors: 0"), status.label)
        XCTAssertTrue(status.label.contains("native begins: 0"), status.label)
    }
    func testResponsiveInlineControls() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Responsive status:'")).firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !status.label.contains("ready: 0") && status.label.contains("controllers: 1") }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
        for (name, label, expected) in [("wide","360 by 203",2),("medium","180 by 102",2),("small","120 by 68",1),("tiny","80 by 60",1),("unavailable","80 by 45",0),("cropped","Cropped wrapper",1)] {
            safari.buttons[label].tap()
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in status.label.contains("case: " + name + "; settled: true") }, object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed)
            let raw = safari.textViews["Responsive geometry"].value as? String ?? ""
            let state = XCTAttachment(string: status.label + "\n" + raw + "\n" + safari.debugDescription); state.name = "responsive-" + name + "-state"; state.lifetime = .keepAlways; add(state)
            let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); screen.name = "responsive-" + name; screen.lifetime = .keepAlways; add(screen)
            guard let data = raw.data(using: .utf8), let result = try? JSONSerialization.jsonObject(with: data) as? [String:Any],
                  let bounds = result["bounds"] as? [String:Double], let controls = result["controls"] as? [[String:Any]] else { XCTFail("Missing mandatory responsive geometry"); return }
            XCTAssertEqual(controls.count, expected, name + ": " + raw)
            for control in controls {
                guard let rect = control["rect"] as? [String:Double] else { XCTFail("Missing control rectangle"); return }
                XCTAssertGreaterThanOrEqual(rect["width"] ?? 0, 44); XCTAssertGreaterThanOrEqual(rect["height"] ?? 0, 44)
                XCTAssertGreaterThanOrEqual(rect["left"] ?? -1, (bounds["left"] ?? 0)-1)
                XCTAssertGreaterThanOrEqual(rect["top"] ?? -1, (bounds["top"] ?? 0)-1)
                XCTAssertLessThanOrEqual(rect["right"] ?? 9999, (bounds["right"] ?? 0)+1)
                XCTAssertLessThanOrEqual(rect["bottom"] ?? 9999, (bounds["bottom"] ?? 0)+1)
            }
            XCTAssertTrue(status.label.contains("errors: 0"), status.label)
            XCTAssertTrue(status.label.contains("native begins: 0"), status.label)
        }
        safari.buttons["360 by 203"].tap()
        for rate in ["1","1.8","16","64"] {
            safari.buttons["Fixture rate " + rate].tap()
            let applied = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in status.label.contains("; rate: " + rate + "; label: " + rate + ";") }, object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [applied], timeout: 10), .completed)
        }
        let final = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); final.name = "responsive-compact-64"; final.lifetime = .keepAlways; add(final)
        safari.buttons["Fixture rate 1"].tap()
        let reset = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in status.label.contains("; rate: 1; label: 1;") }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [reset], timeout: 10), .completed)
    }
    func testPublicNASAInspection() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"); safari.activate()
        let page = safari.webViews.firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30))
        if safari.buttons["Dismiss"].exists { safari.buttons["Dismiss"].tap() }
        for index in 0...3 {
            if index > 0 { page.swipeUp() }
            let state = XCTAttachment(string: safari.debugDescription); state.name = "public-nasa-\(index)-state"; state.lifetime = .keepAlways; add(state)
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = "public-nasa-\(index)"; image.lifetime = .keepAlways; add(image)
        }
    }
}
