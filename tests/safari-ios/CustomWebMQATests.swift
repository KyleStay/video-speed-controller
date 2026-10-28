import XCTest

/// Neutral local decoder surface; all tested playback uses a real WebM video.
@MainActor final class CustomWebMQATests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    private func status(_ safari: XCUIApplication) -> XCUIElement {
        safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Custom WebM:'")).firstMatch
    }
    private func wait(_ safari: XCUIApplication, _ pieces: [String]) {
        let text = status(safari)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pieces.allSatisfy { text.label.contains($0) } }, object: text)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed, text.label)
    }
    private func capture(_ safari: XCUIApplication, _ name: String) {
        let text = XCTAttachment(string: status(safari).label + "\n" + safari.debugDescription)
        text.name=name; text.lifetime = .keepAlways; add(text)
        let image = XCTAttachment(screenshot:safari.screenshot()); image.name=name; image.lifetime = .keepAlways; add(image)
    }
    func testNativeTakeoverAndReturn() {
        let safari=XCUIApplication(bundleIdentifier:"com.apple.mobilesafari"); safari.activate()
        let open=safari.buttons["Open WebM clip"]
        XCTAssertTrue(open.waitForExistence(timeout:20));open.tap()
        wait(safari,["\"native\":true","\"controlled\":true","\"sameSource\":true","\"paused\":false","\"originalPaused\":true","\"originalVisible\":false","\"chromeVisible\":false","\"errors\":0"])
        let progressing = XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in
            let raw=self.status(safari).label.components(separatedBy:"Custom WebM: ").last ?? ""
            guard let data=raw.data(using:.utf8),let row=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else{return false}
            return (row["frames"] as? Int ?? 0)>2 && (row["time"] as? Double ?? 0)>0.2
        },object:status(safari))
        XCTAssertEqual(XCTWaiter.wait(for:[progressing],timeout:15),.completed)
        if !safari.buttons["Pause video"].isHittable {
            // WebKit exposes the video without a stable picture element. The
            // inspected fixture places its center below/right of this control.
            let frame = safari.buttons["Pause video"].frame
            safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.minX + 170, dy: frame.minY + 75)).tap()
        }
        safari.buttons["Pause video"].tap();wait(safari,["\"paused\":true"])
        capture(safari,"custom-webm-inline")
        let pill=safari.buttons.matching(NSPredicate(format:"label BEGINSWITH 'Playback speed '")).firstMatch
        pill.tap();safari.switches["Set playback speed to 2 times"].tap()
        wait(safari,["\"rate\":2","\"paused\":true"])
        safari.buttons["Close speed controls"].tap()
        safari.buttons["Open video fullscreen"].tap()
        XCTAssertTrue(safari.buttons["Close StayFast video player"].waitForExistence(timeout:10))
        safari.buttons["More video options"].tap()
        safari.buttons["Use site player"].tap()
        wait(safari,["\"native\":false","\"originalVisible\":true","\"chromeVisible\":true","\"originalPaused\":true","\"controllers\":0","\"errors\":0"])
        capture(safari,"custom-webm-site-return")
        safari.buttons["Close clip"].tap();open.tap()
        wait(safari,["\"controlled\":true"])
        safari.buttons["Close clip"].tap()
        wait(safari,["\"native\":false","\"controllers\":0","\"closedPaused\":true","\"errors\":0"])
        capture(safari,"custom-webm-close")
    }
}
