import XCTest

/// Open /feed-position.html?native&margin[&nested] with the installed extension.
@MainActor final class FeedPositionQATests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }
    func testNearEndFeedPosition() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let prepare = safari.buttons["Prepare feed baseline"]
        XCTAssertTrue(prepare.waitForExistence(timeout: 20))
        prepare.tap()
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Feed position:'")).firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            status.label.contains("ready: 4; controller: true") && status.label.contains("errors: 0")
        }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        for entry in 1...2 {
            let fullscreen = safari.buttons["Open video fullscreen"]
            XCTAssertTrue(fullscreen.waitForExistence(timeout: 10))
            // WebKit can union an SVG descendant's old offscreen frame into
            // this button's AX rectangle in a nested scroller. The visible
            // 44px button remains at its bottom, as the captured DOM/UI show.
            if fullscreen.frame.height > 100 {
                fullscreen.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1))
                    .withOffset(CGVector(dx: 0, dy: -22)).tap()
            } else {
                fullscreen.tap()
            }
            let close = safari.buttons["Close StayFast video player"]
            XCTAssertTrue(close.waitForExistence(timeout: 10))
            let opened = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            opened.name = "feed-open-\(entry)"; opened.lifetime = .keepAlways; add(opened)
            close.tap()
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                status.exists && status.label.contains("entry: \(entry); active: false; errors: 0")
            }, object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 15), .completed)
        }
        let raw = safari.textViews["Feed position trace"].value as? String ?? ""
        let trace = XCTAttachment(string: raw + "\n" + safari.debugDescription)
        trace.name = "feed-position-trace"; trace.lifetime = .keepAlways; add(trace)
        let returned = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        returned.name = "feed-return"; returned.lifetime = .keepAlways; add(returned)
        guard let data = raw.data(using: .utf8), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            XCTFail("Missing feed position measurements: " + raw); return
        }
        for entry in 1...2 {
            let samples = rows.filter { ($0["entry"] as? Int) == entry }
            guard let before = samples.first(where: { $0["phase"] as? String == "before" }) else {
                XCTFail("Missing entry boundary: " + raw); return
            }
            let nested = before["nestedFeed"] as? Bool == true
            let offset = before[nested ? "nested" : "page"] as? Double ?? -1
            let maximum = before[nested ? "maxNested" : "maxPage"] as? Double ?? -1
            XCTAssertGreaterThan(maximum, 100, "Fixture must have a meaningful scroll range")
            XCTAssertEqual(offset, maximum, accuracy: 2, "Entry must start at the scroll-range end: " + raw)
            for phase in ["open", "closed"] {
                guard let after = samples.first(where: { $0["phase"] as? String == phase }) else {
                    XCTFail("Missing \(phase) measurements: " + raw); return
                }
                XCTAssertEqual(after["post"] as? String, before["post"] as? String)
                XCTAssertEqual(after["sameVideo"] as? Bool, true)
                XCTAssertEqual(after["active"] as? Bool, phase == "open")
                for key in ["page", "nested", "top", "height", "nextTop"] {
                    guard let first = before[key] as? Double, let last = after[key] as? Double else {
                        XCTFail("Missing \(key): " + raw); return
                    }
                    XCTAssertEqual(last, first, accuracy: 2, "\(phase) \(key): " + raw)
                }
            }
        }
    }
}
