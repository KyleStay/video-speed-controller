import XCTest

/// Open a fresh ?mp4&owned&scroll=page|nested or /scroll-frame.html fixture first.
@MainActor final class ScrollQATests: XCTestCase {
    private struct Baseline {
        let page: [Double]
        let nested: [Double]
        let videoTop: Double
        let parentPage: [Double]?
        let parentNested: [Double]?
        let frameTop: Double?
        let entry: Int
    }
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }
    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Playback rate:'")).firstMatch
    }
    private func parentStatus(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Parent scroll state:'")).firstMatch
    }
    private func field(_ text: String, _ name: String) -> String? {
        let prefix = name + ": "
        let text = text.replacingOccurrences(of: "Parent scroll state: ", with: "")
        return text.components(separatedBy: "; ").first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) }
    }
    private func point(_ text: String, _ name: String) -> [Double]? {
        guard let value = field(text, name) else { return nil }
        let values = value.split(separator: ",").compactMap { Double($0) }
        return values.count == 2 ? values : nil
    }
    private func equal(_ actual: [Double]?, _ expected: [Double]) -> Bool {
        guard let actual else { return expected == [0, 0] }
        return zip(actual, expected).allSatisfy { abs($0 - $1) <= 2 }
    }
    private func capture(_ safari: XCUIApplication, _ name: String) {
        let parent = parentStatus(safari)
        let text = XCTAttachment(string: status(safari).label + "\n" + (parent.exists ? parent.label : "") + "\n" + safari.debugDescription)
        text.name = name + "-state"; text.lifetime = .keepAlways; add(text)
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screen.name = name; screen.lifetime = .keepAlways; add(screen)
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let item = status(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pieces.allSatisfy { item.label.contains($0) } }, object: item)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 20), .completed)
    }
    private func checkpoint(_ safari: XCUIApplication) -> Baseline {
        let parent = parentStatus(safari)
        safari.buttons["Play test video"].tap()
        wait(safari, ["ready: 4", "paused: false", "errors: 0"])
        safari.buttons["Pause test video"].tap()
        wait(safari, ["paused: true"])
        if parent.exists {
            safari.buttons["Prepare parent scroll baseline"].tap()
        }
        let prepare = safari.buttons["Prepare scroll baseline"]
        XCTAssertTrue(prepare.waitForExistence(timeout: 20))
        prepare.tap()
        safari.buttons["Remember scroll position"].tap()
        if parent.exists { safari.buttons["Remember parent scroll position"].tap() }
        wait(safari, ["ready: 4", "errors: 0", "saved scroll:", "owner active: false"])
        let baseline = savedBaseline(safari, requiresParent: parent.exists)
        XCTAssertGreaterThan(baseline.page[1], 500)
        if field(status(safari).label, "nested scroll") != "none" {
            XCTAssertGreaterThan(baseline.nested[0], 0)
            XCTAssertGreaterThan(baseline.nested[1], 0)
        }
        if parent.exists {
            XCTAssertGreaterThan(baseline.parentPage?[1] ?? 0, 500)
            XCTAssertGreaterThan(baseline.parentNested?[0] ?? 0, 0)
            XCTAssertGreaterThan(baseline.parentNested?[1] ?? 0, 0)
        }
        return baseline
    }
    // Saved fields are written at the trusted click boundary, before portal/frame expansion.
    private func savedBaseline(_ safari: XCUIApplication, requiresParent: Bool) -> Baseline {
        let text = status(safari).label
        guard let page = point(text, "saved scroll"),
              let nested = point(text, "saved nested"),
              let topText = field(text, "saved video top"), let videoTop = Double(topText) else {
            XCTFail("Missing measured scroll checkpoint: " + text)
            return Baseline(page: [0, 0], nested: [0, 0], videoTop: 0, parentPage: nil, parentNested: nil, frameTop: nil, entry: 0)
        }
        let parent = parentStatus(safari)
        let parentText = parent.exists ? parent.label : ""
        let entry = Int(field(text, "saved entry") ?? "") ?? 0
        let parentPage = point(parentText, "saved page")
        let parentNested = point(parentText, "saved nested")
        let frameTop = Double(field(parentText, "saved frame top") ?? "")
        if requiresParent {
            XCTAssertTrue(parent.exists)
        }
        if parent.exists || requiresParent {
            XCTAssertNotNil(parentPage)
            XCTAssertNotNil(parentNested)
            XCTAssertNotNil(frameTop)
            XCTAssertEqual(Int(field(parentText, "saved entry") ?? ""), entry)
            XCTAssertEqual(field(parentText, "saved entry kind"), field(text, "saved entry kind"))
        }
        return Baseline(page: page, nested: nested, videoTop: videoTop, parentPage: parentPage,
                        parentNested: parentNested, frameTop: frameTop, entry: entry)
    }
    private func entryBaseline(_ safari: XCUIApplication, after previous: Int, kind: String,
                               requiresParent: Bool) -> Baseline {
        let item = status(safari)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let text = item.label
            return (Int(self.field(text, "saved entry") ?? "") ?? 0) > previous &&
                self.field(text, "saved entry kind") == kind
        }, object: item)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed)
        let baseline = savedBaseline(safari, requiresParent: requiresParent)
        print("TRUSTED ENTRY CHECKPOINT " + kind + " CHILD " + status(safari).label)
        if requiresParent { print("TRUSTED ENTRY CHECKPOINT " + kind + " PARENT " + parentStatus(safari).label) }
        return baseline
    }
    private func assertRestored(_ safari: XCUIApplication, _ baseline: Baseline, _ name: String) {
        wait(safari, ["owner active: false", "owned hosts: 0", "original identity: true", "source preserved: true", "controllers: 1", "errors: 0", "native fullscreen: false"])
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let text = self.status(safari).label
            guard self.equal(self.point(text, "page scroll"), baseline.page),
                  self.equal(self.point(text, "nested scroll"), baseline.nested),
                  let top = Double(self.field(text, "video top") ?? ""), abs(top - baseline.videoTop) <= 2 else { return false }
            if let page = baseline.parentPage, let nested = baseline.parentNested, let frameTop = baseline.frameTop {
                let parent = self.parentStatus(safari).label
                guard self.equal(self.point(parent, "page"), page), self.equal(self.point(parent, "nested"), nested),
                      let top = Double(self.field(parent, "frame top") ?? ""), abs(top - frameTop) <= 2,
                      parent.contains("errors: 0") else { return false }
            }
            return true
        }, object: status(safari))
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed)
        capture(safari, name)
    }
    private func openCustomPaused(_ safari: XCUIApplication) {
        let pill = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 10))
        pill.tap()
        let custom = safari.buttons["Open StayFast player"]
        XCTAssertTrue(custom.waitForExistence(timeout: 10))
        custom.tap()
        let pause = safari.buttons["Pause video"]
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        pause.tap()
        wait(safari, ["owner active: true", "paused: true", "native fullscreen: false", "errors: 0"])
        capture(safari, "scroll-custom-presentation")
    }
    private func closeNative(_ safari: XCUIApplication) {
        wait(safari, ["native fullscreen: true", "owner active: false", "owned hosts: 0", "errors: 0"])
        capture(safari, "scroll-native-presentation")
        let close = safari.buttons["Close Button"]
        if !close.isHittable {
            let media = safari.otherElements["Media"]
            XCTAssertTrue(media.waitForExistence(timeout: 10))
            media.tap()
        }
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()
    }
    private func runPreservesScroll(requiresParent: Bool) {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        if requiresParent {
            XCTAssertTrue(parentStatus(safari).waitForExistence(timeout: 20))
        }
        let baseline = checkpoint(safari)
        capture(safari, "scroll-checkpoint")
        assertRestored(safari, baseline, "scroll-before-presentation")
        openCustomPaused(safari)
        let customBaseline = entryBaseline(safari, after: baseline.entry, kind: "custom", requiresParent: requiresParent)
        safari.buttons["Close StayFast video player"].tap()
        assertRestored(safari, customBaseline, "scroll-after-custom-done")
        safari.buttons["Open video fullscreen"].tap()
        // Primary presentation preserves the already-paused original media.
        XCTAssertTrue(safari.buttons["Play video"].waitForExistence(timeout: 10))
        wait(safari, ["paused: true", "owner active: true", "owned hosts: 1", "native fullscreen: false", "original identity: true", "source preserved: true", "errors: 0"])
        let primaryBaseline = entryBaseline(safari, after: customBaseline.entry, kind: "primary", requiresParent: requiresParent)
        safari.buttons["Close StayFast video player"].tap()
        assertRestored(safari, primaryBaseline, "scroll-after-primary-owned-done")
        openCustomPaused(safari)
        let nativeBaseline = entryBaseline(safari, after: primaryBaseline.entry, kind: "custom", requiresParent: requiresParent)
        safari.buttons["More video options"].tap()
        safari.buttons["Open Apple fullscreen player"].tap()
        closeNative(safari)
        assertRestored(safari, nativeBaseline, "scroll-after-custom-to-native")
    }
    func testInspectScrollState() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        print("FINAL CHILD SCROLL " + status(safari).label)
        print("FINAL PARENT SCROLL " + parentStatus(safari).label)
        capture(safari, "inspected-final-scroll-state")
    }
    func testPreservesScroll() { runPreservesScroll(requiresParent: false) }
    func testFramePreservesScroll() { runPreservesScroll(requiresParent: true) }
}
