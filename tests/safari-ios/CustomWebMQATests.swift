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
    /// Fresh /media-patterns.html?attachment-link; the file link remains over the expanded video.
    func testThumbnailExpandedAttachmentScrubbing() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let status = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Attachment:'")).firstMatch
        func report() -> [String: Any] {
            let raw = status.label.replacingOccurrences(of: "Attachment: ", with: "")
            guard let data = raw.data(using: .utf8), let row = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
            return row
        }
        func wait(_ test: @escaping ([String: Any]) -> Bool) {
            let done = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in test(report()) }, object: status)
            let result = XCTWaiter.wait(for: [done], timeout: 15)
            if result != .completed {
                let trace = XCTAttachment(string: status.label + "\n" + safari.debugDescription)
                trace.name = "attachment-scrub-failure"; trace.lifetime = .keepAlways; add(trace)
                let shot = XCTAttachment(screenshot: safari.screenshot())
                shot.name = "attachment-scrub-failure"; shot.lifetime = .keepAlways; add(shot)
            }
            XCTAssertEqual(result, .completed, status.label)
        }
        let open = safari.buttons["Open attachment 1"]
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        for iteration in 1...2 {
            open.tap()
            wait { ($0["controlled"] as? Bool) == true && ($0["duration"] as? Double ?? 0) > 10 }
            let picture = safari.links["Expanded attachment 1"]
            XCTAssertTrue(picture.waitForExistence(timeout: 10))
            XCTAssertGreaterThan(picture.frame.width, 100)
            let start = picture.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5))
            start.tap()
            wait { ($0["taps"] as? Int) == iteration }
            let before = try XCTUnwrap(report()["time"] as? Double)
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 60, dy: 0)))
            wait {
                ($0["time"] as? Double ?? 0) > before + 3 &&
                ($0["paused"] as? Bool) == true &&
                ($0["scrubbing"] as? Bool) == false &&
                ($0["taps"] as? Int) == iteration
            }
            let shot = XCTAttachment(screenshot: safari.screenshot())
            shot.name = "expanded-webm-scrub-\(iteration)"; shot.lifetime = .keepAlways; add(shot)
            safari.buttons["Collapse attachment 1"].tap()
            wait { ($0["controllers"] as? Int) == 0 }
        }
        print("NATIVE_ATTACHMENT_SCRUB_PASS thumbnail expansion, file-link drag, paused state, taps, collapse and reopen")
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
        // WebKit can report a fading target hittable just before rejecting a
        // semantic tap. Genuine touches at its observed bounds first reveal
        // idle controls, then pause; require native state after those touches.
        for _ in 0..<3 {
            if status(safari).label.contains("\"paused\":true") { break }
            let frame = safari.buttons["Pause video"].frame
            XCTAssertGreaterThanOrEqual(frame.width, 44)
            safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
        }
        wait(safari,["\"paused\":true"])
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
