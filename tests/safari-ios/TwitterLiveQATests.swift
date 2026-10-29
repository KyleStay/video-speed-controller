import XCTest
import UIKit

/// Actual reported public post in Safari with the installed extension.
/// The bookmarklet only reports DOM/media state and observes presented frames;
/// every playback, speed and presentation action is a genuine XCUI tap.
@MainActor final class TwitterLiveQATests: XCTestCase {
    private let postURL = "https://x.com/davis7/status/2115566875904237717"
    private let prefix = "Live X QA: "
    private var safari: XCUIApplication!
    private var diagnosticBookmarkName: String?
    private var diagnosticBookmarkMayBeSaved = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
    }

    override func tearDownWithError() throws {
        if let safari { capture(safari, "live-x-final") }
        // XCTest calls teardown after failed setup/test assertions as well.
        // A random exact name is the only bookmark this test may remove.
        let prior = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = prior }
        removeDiagnosticBookmark()
    }

    private func reportElement(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func report(_ app: XCUIApplication) -> [String: Any] {
        let item = reportElement(app)
        guard item.exists, item.label.hasPrefix(prefix),
              let data = String(item.label.dropFirst(prefix.count)).data(using: .utf8),
              let row = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return row
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let text = XCTAttachment(string: (reportElement(app).exists ? reportElement(app).label : "Live diagnostic unavailable") + "\n" + app.debugDescription)
        text.name = name + "-state"; text.lifetime = .keepAlways; add(text)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        print("LIVE X QA " + name + " " + (reportElement(app).exists ? reportElement(app).label : "no diagnostic"))
    }

    private func wait(_ name: String, timeout: TimeInterval = 25, _ condition: @escaping ([String: Any]) -> Bool) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition(self.report(self.safari)) }, object: safari)
        let result = XCTWaiter.wait(for: [ready], timeout: timeout)
        if result != .completed { capture(safari, "live-x-timeout-" + name) }
        XCTAssertEqual(result, .completed, "\(name): \(report(safari))")
    }

    private func addressField() -> XCUIElement {
        let address = safari.textFields["Address"].firstMatch
        if !address.isHittable {
            let title = safari.descendants(matching: .any).matching(identifier: "TabBarItemTitle").firstMatch
            if title.exists && title.isHittable { title.tap() }
        }
        XCTAssertTrue(address.waitForExistence(timeout: 10), "Safari address field unavailable")
        return address
    }

    private func enterAddress(_ value: String) {
        let address = addressField()
        address.tap()
        // Safari selects its address on entry. One Delete clears that selection;
        // never issue thousands of Deletes after an interrupted bookmarklet.
        address.typeText(XCUIKeyboardKey.delete.rawValue)
        if let text = address.value as? String, !text.isEmpty, text != address.placeholderValue {
            let clear = safari.buttons.matching(NSPredicate(format: "label EQUALS[c] 'Clear text'")).firstMatch
            XCTAssertTrue(clear.exists && clear.isHittable, "Address was not selected and native Clear text is unavailable")
            clear.tap()
        }
        address.typeText(value + "\n")
    }

    private func installSavedDiagnosticBookmarklet() {
        let name = "StayFast Live QA " + UUID().uuidString
        diagnosticBookmarkName = name
        func item(_ label: String) -> XCUIElement {
            let matches = safari.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
            return matches.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? matches.firstMatch
        }
        func tap(_ label: String) {
            let target = item(label)
            XCTAssertTrue(target.waitForExistence(timeout: 10), "Native Safari \(label) unavailable")
            target.tap()
        }
        func openMore(_ purpose: String) {
            // iOS 26's compact toolbar exposes Share and Bookmarks through More.
            // Scope this to Safari's observed native capsule, excluding X's More.
            let more = safari.otherElements["CapsuleViewController"].buttons["More"].firstMatch
            XCTAssertTrue(more.waitForExistence(timeout: 8), "Safari native More control unavailable")
            more.tap()
            capture(safari, "live-x-safari-more-" + purpose)
        }
        func openBookmarks() {
            let identified = safari.buttons["BookmarksButton"].firstMatch
            let labeled = safari.toolbars.buttons["Bookmarks"].firstMatch
            if identified.exists && identified.isHittable { identified.tap() }
            else if labeled.exists && labeled.isHittable { labeled.tap() }
            else { openMore("bookmarks"); tap("Bookmarks") }
            if !item(name).exists {
                tap("Favorites")
            }
            XCTAssertTrue(item(name).waitForExistence(timeout: 8), "Saved diagnostic bookmark missing from its folder")
        }

        // Save the actual post normally, then edit that saved bookmark's URL.
        // Smart Search is deliberately never used to execute JavaScript.
        let share = safari.buttons["ShareButton"].firstMatch
        let shareLabel = safari.toolbars.buttons["Share"].firstMatch
        if share.exists && share.isHittable { share.tap() }
        else if shareLabel.exists && shareLabel.isHittable { shareLabel.tap() }
        else {
            openMore("add-bookmark")
            if !item("Add Bookmark").exists { tap("Share") }
        }
        capture(safari, "live-x-safari-add-bookmark-menu")
        tap("Add Bookmark")
        let titles = safari.textFields.allElementsBoundByIndex.filter { $0.isHittable && $0.identifier != "Address" }
        guard let title = titles.first else { capture(safari, "live-x-bookmark-title-missing"); XCTFail("Add Bookmark has no native title field"); return }
        title.tap()
        title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: min((title.value as? String ?? "").count + 4, 300)) + name)
        XCTAssertEqual(title.value as? String, name, "Only the exact tracked diagnostic bookmark may be saved")
        diagnosticBookmarkMayBeSaved = true
        tap("Save")
        openBookmarks()
        tap("Edit")
        item(name).tap()
        let fields = safari.textFields.allElementsBoundByIndex.filter {
            $0.isHittable && $0.identifier != "Address" && ($0.value as? String ?? "").contains("/status/2115566875904237717")
        }
        XCTAssertEqual(fields.count, 1, "Edit Bookmark must expose the exact post URL field")
        guard let url = fields.first else { capture(safari, "live-x-bookmark-url-missing"); return }
        url.tap()
        url.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: min((url.value as? String ?? "").count + 4, 512)))
        UIPasteboard.general.string = "javascript:" + diagnostics
        url.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).press(forDuration: 1.1)
        let paste = safari.menuItems["Paste"].firstMatch
        let pasteButton = safari.buttons["Paste"].firstMatch
        let menu = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in paste.exists || pasteButton.exists }, object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [menu], timeout: 6), .completed, "Native bookmark URL Paste unavailable")
        if paste.exists { paste.tap() } else { pasteButton.tap() }
        let allowPaste = safari.alerts.buttons["Allow Paste"].firstMatch
        if allowPaste.waitForExistence(timeout: 2) { allowPaste.tap() }
        let pasted = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let value = url.value as? String ?? ""
            return value.hasPrefix("javascript:") && value.contains("__stayfastLiveQA")
        }, object: url)
        XCTAssertEqual(XCTWaiter.wait(for: [pasted], timeout: 8), .completed, "Bookmark URL did not preserve the diagnostic script")
        UIPasteboard.general.string = ""
        let done = safari.navigationBars.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 8), "Edit Bookmark Done unavailable"); done.tap()
        // Leave list editing before invoking the saved bookmark. The bottommost
        // Done is Safari's list-edit control when a separate dismiss Done exists.
        let listDone = safari.buttons.matching(NSPredicate(format: "label == 'Done'")).allElementsBoundByIndex.filter { $0.isHittable }.max { $0.frame.minY < $1.frame.minY }
        if let listDone { listDone.tap() }
        if !item(name).exists { openBookmarks() }
        item(name).tap()
    }

    private func removeDiagnosticBookmark() {
        guard let name = diagnosticBookmarkName, let safari else { return }
        func item(_ label: String) -> XCUIElement {
            safari.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        }
        // Finish/dismiss an interrupted native bookmark editor first. If Save is
        // still present, the new bookmark has not been saved; Cancel discards it.
        if safari.textFields.allElementsBoundByIndex.contains(where: { ($0.value as? String) == name }) {
            let cancel = safari.buttons["Cancel"].firstMatch
            let done = safari.navigationBars.buttons["Done"].firstMatch
            if cancel.exists && cancel.isHittable { cancel.tap() }
            else if done.exists && done.isHittable { done.tap() }
        }
        let row = safari.cells.containing(.any, identifier: name).firstMatch
        if !row.exists {
            let identified = safari.buttons["BookmarksButton"].firstMatch
            let labeled = safari.toolbars.buttons["Bookmarks"].firstMatch
            if identified.exists && identified.isHittable { identified.tap() }
            else if labeled.exists && labeled.isHittable { labeled.tap() }
            else {
                let more = safari.otherElements["CapsuleViewController"].buttons["More"].firstMatch
                guard more.exists && more.isHittable else {
                    XCTFail("Could not reach native bookmarks to remove only \(name)"); return
                }
                more.tap()
                let bookmarks = item("Bookmarks")
                guard bookmarks.waitForExistence(timeout: 5), bookmarks.isHittable else {
                    XCTFail("Native Bookmarks unavailable during diagnostic cleanup: \(name)"); return
                }
                bookmarks.tap()
            }
        }
        if !row.exists {
            let favorites = item("Favorites")
            if favorites.exists && favorites.isHittable { favorites.tap() }
        }
        // Never swipe/delete an arbitrary row or a global Delete button.
        // An absent exact row means failed setup did not save this bookmark.
        guard row.waitForExistence(timeout: 5) else {
            if diagnosticBookmarkMayBeSaved {
                XCTFail("Saved diagnostic bookmark could not be located for cleanup: \(name)")
            } else { diagnosticBookmarkName = nil }
            return
        }
        let done = safari.buttons.matching(NSPredicate(format: "label == 'Done'"))
            .allElementsBoundByIndex.filter { $0.isHittable }.max { $0.frame.minY < $1.frame.minY }
        let edit = safari.buttons["Edit"].firstMatch
        if !edit.exists, let done { done.tap() }
        row.swipeLeft()
        let delete = row.buttons["Delete"].firstMatch
        guard delete.waitForExistence(timeout: 5), delete.isHittable else {
            XCTFail("Exact diagnostic bookmark row has no native Delete action: \(name)"); return
        }
        delete.tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 5), "Test-created diagnostic bookmark was not removed: \(name)")
        if !row.exists { diagnosticBookmarkName = nil }
    }

    private func dismissObservedAppModal() {
        let title = safari.staticTexts["See this post in the app"].firstMatch
        guard title.waitForExistence(timeout: 3) else { return }
        for name in ["Close", "Dismiss", "Close dialog"] {
            let close = safari.webViews.buttons[name].firstMatch
            if close.exists && close.isHittable { close.tap(); return }
        }
        capture(safari, "live-x-app-modal-no-semantic-close")
        // Exact modal and close affordance were inspected on the selected
        // simulator: x=867,y=220 in its 942x2048 screenshot. This fallback is
        // conditional on that observed modal, never a blind page tap.
        safari.coordinate(withNormalizedOffset: CGVector(dx: 867.0 / 942.0, dy: 220.0 / 2048.0)).tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 8), "Observed app modal did not close")
    }

    private var diagnostics: String {
        #"""
        (()=>{
          const key='__stayfastLiveQA';window[key]?.stop?.();
          const id='2115566875904237717',end=performance.now()+300000,rows=new Map(),failures=[];
          let original=null,origin=null,interval,panel=document.getElementById('stayfast-live-qa');
          if(!panel){panel=document.createElement('pre');panel.id='stayfast-live-qa';panel.setAttribute('role','status');panel.style.cssText='position:fixed;left:0;bottom:0;max-width:100%;max-height:22px;overflow:hidden;font:8px monospace;background:white;color:black;z-index:2147483647;pointer-events:none;margin:0';document.documentElement.append(panel)}
          const errors=e=>{if(failures.length<8)failures.push(String(e.message||e.reason||'page error').slice(0,300))};
          addEventListener('error',errors);addEventListener('unhandledrejection',errors);
          const locate=()=>{
            const articles=[...document.querySelectorAll('article')].filter(article=>[...article.querySelectorAll('a[href]')].some(a=>{
              if(a.closest('article')!==article||!a.querySelector('time'))return false;
              try{const u=new URL(a.href);return /^(?:www\.)?(?:x|twitter)\.com$/.test(u.hostname)&&/^\/davis7\/status\/2115566875904237717\/?$/i.test(u.pathname)}catch{return false}
            })||[...article.querySelectorAll('video')].some(v=>{
              if(v.closest('article')!==article)return false;
              try{return window.VSC?.TwitterPlayer?.resolve(v)?.api.getState().content.sourceId===id}catch{return false}
            }));
            const videos=articles.length===1?[...articles[0].querySelectorAll('video')].filter(v=>v.closest('article')===articles[0]&&!window.VSC?.TwitterMP4Playback?.get(v)):[];
            return videos.length===1?videos[0]:null;
          };
          const frames=v=>{
            if(!rows.has(v)&&rows.size<8){
              const row={id:rows.size+1,frames:0,played:0,last:null,lastWall:performance.now(),gaps:[],handle:null};rows.set(v,row);
              if(typeof v.requestVideoFrameCallback==='function'){
                const tick=(_,meta)=>{
                  const now=performance.now();row.handle=null;row.frames++;
                  if(row.lastWall!==null){
                    const gap=now-row.lastWall,bucket=Math.floor(now/100),last=row.gaps.at(-1);
                    if(last?.bucket===bucket){if(gap>last.gap){last.at=now;last.gap=gap}}
                    else{row.gaps.push({bucket,at:now,gap});if(row.gaps.length>80)row.gaps.shift()}
                  }
                  row.lastWall=now;
                  if(row.last!==null){let delta=meta.mediaTime-row.last;if(delta<-.25&&v.loop&&Number.isFinite(v.duration))delta+=v.duration;if(delta>=0&&delta<Math.max(1,v.duration||1))row.played+=delta}
                  row.last=meta.mediaTime;
                  if(performance.now()<end&&v.isConnected)row.handle=v.requestVideoFrameCallback(tick);
                };row.handle=v.requestVideoFrameCallback(tick);
              }
            }
            return rows.get(v)||{id:0,frames:0,played:0,gaps:[],lastWall:null};
          };
          const media=v=>{
            if(!v)return null;const f=frames(v),r=v.getBoundingClientRect();let quality=null;
            try{quality=v.getVideoPlaybackQuality?.().totalVideoFrames??v.webkitDecodedFrameCount??null}catch{}
            return{id:f.id,src:v.src,currentSrc:v.currentSrc,rate:v.playbackRate,paused:v.paused,ended:v.ended,time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,ready:v.readyState,frames:f.frames,played:f.played,lastFrameAt:f.lastWall,frameGaps:f.gaps.map(g=>[g.at,g.gap]),nativeFrames:quality,controlled:!!v.vsc,owned:!!v.vsc?.iosPlayer?.active,rect:{x:r.x,y:r.y,width:r.width,height:r.height},error:v.error?{code:v.error.code,message:v.error.message}:null};
          };
          const snapshot=()=>{try{
            // Capture once: replacement/removal must fail identity assertions,
            // rather than silently rebinding the diagnostic to a newer video.
            if(!original){
              original=locate();
              if(original){
                let candidate=null;try{candidate=window.VSC?.TwitterPlayer?.resolve(original)||window.VSC?.ProgressiveMediaSource?.findCandidate(original)}catch{}
                origin={parent:original.parentElement,attribute:original.getAttribute('src'),source:original.currentSrc||original.src,object:original.srcObject,id:frames(original).id,progressive:candidate?.originalUrl===(original.currentSrc||original.src)?candidate.progressiveUrl:null};
              }
            }
            const controlled=(window.VSC?.stateManager?.getControlledElements?.()||[]).filter(v=>v?.isConnected);
            const active=window.VSC?.IOSPlayer?.activePlayers?.get(document)?.video;
            const companion=controlled.find(v=>window.VSC?.TwitterMP4Playback?.get(v)?.original===original);
            const current=companion||(active===original?active:null)||original;
            let resolved=null,resolverError=null;
            try{const c=original&&window.VSC?.TwitterPlayer?.resolve(original);resolved=c?{sourceUrl:c.sourceUrl,progressiveUrl:c.progressiveUrl,contentId:c.contentId,sessionId:c.sessionId}:null}catch(e){resolverError=String(e)}
            const source=original&&(original.currentSrc||original.src),blob=!!origin?.source.startsWith('blob:');
            const sameSource=!!origin&&source===origin.source&&original.getAttribute('src')===origin.attribute&&original.srcObject===origin.object;
            const suppliedMP4=!!origin?.progressive&&source===origin.progressive&&original.srcObject===origin.object;
            const invariants=origin?{originalId:origin.id,initialSource:origin.source,suppliedMP4:origin.progressive,blob,originalConnected:original.isConnected,originalParentUnchanged:original.parentElement===origin.parent,originalSourceUnchanged:sameSource,sameSourceObject:original.srcObject===origin.object,allowedOriginalSource:sameSource||(!blob&&suppliedMP4),currentIsOriginal:current===original,companionSourceMatches:!!companion&&!!origin.progressive&&companion.currentSrc===origin.progressive&&companion.currentSrc===window.VSC.TwitterMP4Playback.get(companion)?.candidate.progressiveUrl}:null;
            const text=document.body?.innerText||'';
            const report={url:location.href,post:id,now:performance.now(),extension:!!window.VSC_controller?.initialized,pageFailure:original?null:(/unavailable|doesn.t exist|something went wrong/i.test(text)?'unavailable':/log in|sign in/i.test(text)?'login-or-media-missing':'media-missing'),resolver:resolved,resolverError,invariants,retained:!!(original&&window.VSC?.TwitterMP4Playback?.isRetained(original)),controllers:controlled.length,original:media(original),current:media(current),failures:[...failures]};
            const value='Live X QA: '+JSON.stringify(report);panel.textContent=value;panel.setAttribute('aria-label',value);
          }catch(e){panel.textContent='Live X QA: '+JSON.stringify({diagnosticError:String(e),failures})}};
          const stop=()=>{clearInterval(interval);removeEventListener('error',errors);removeEventListener('unhandledrejection',errors);for(const[v,r]of rows)if(r.handle!==null)try{v.cancelVideoFrameCallback(r.handle)}catch{};rows.clear()};
          window[key]={stop};snapshot();interval=setInterval(()=>{if(performance.now()>=end){stop();return}snapshot()},250);addEventListener('pagehide',stop,{once:true});
        })();void(0)
        """#.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
    }

    private func prepare() {
        enterAddress(postURL)
        dismissObservedAppModal()
        installSavedDiagnosticBookmarklet()
        wait("installed-live-media", timeout: 45) { row in
            guard row["extension"] as? Bool == true,
                  let video = row["current"] as? [String: Any] else { return false }
            return video["controlled"] as? Bool == true && (video["ready"] as? Int ?? 0) >= 2
        }
        XCTAssertTrue((report(safari)["url"] as? String ?? "").contains("/status/2115566875904237717"))
        XCTAssertNil(report(safari)["pageFailure"] as? String, "Login, unavailable or missing media is a failure")
        capture(safari, "live-x-initial")
    }

    private func current() -> [String: Any] { report(safari)["current"] as? [String: Any] ?? [:] }

    private func reveal() {
        let speed = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).allElementsBoundByIndex
        if speed.contains(where: { $0.isHittable }) || safari.buttons["More video options"].isHittable { return }
        let stage = safari.otherElements["Video display"].firstMatch
        if stage.exists && stage.isHittable { stage.tap(); return }
        guard let rect = current()["rect"] as? [String: Double], let web = safari.webViews.allElementsBoundByIndex.first(where: { $0.isHittable }) else {
            capture(safari, "live-x-reveal-unavailable"); XCTFail("No inspected media rectangle or web view"); return
        }
        web.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: (rect["x"] ?? 0) + (rect["width"] ?? 0) / 2, dy: (rect["y"] ?? 0) + (rect["height"] ?? 0) / 2)).tap()
    }

    private func playIfPaused() {
        guard current()["paused"] as? Bool != false else { return }
        reveal()
        let play = safari.buttons["Play video"].firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 8), "Installed extension Play video control unavailable")
        play.tap()
        wait("playing") { ($0["current"] as? [String: Any])?["paused"] as? Bool == false }
    }

    private func inlineRate(_ rate: Double) {
        reveal()
        let pills = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).allElementsBoundByIndex.filter { $0.isHittable }
        XCTAssertEqual(pills.count, 1, "Ambiguous or missing inline speed control")
        guard let pill = pills.first else { return }
        pill.tap()
        let two = safari.switches["Set playback speed to 2 times"].firstMatch
        XCTAssertTrue(two.waitForExistence(timeout: 8)); two.tap()
        let count = Int(((rate - 2) * 10).rounded())
        for _ in 0..<count {
            let increase = safari.buttons["Increase speed"].firstMatch
            if !increase.exists || !increase.isHittable {
                reveal()
                let next = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed '")).allElementsBoundByIndex.first(where: { $0.isHittable })
                XCTAssertNotNil(next); next?.tap()
            }
            XCTAssertTrue(increase.waitForExistence(timeout: 8)); increase.tap()
        }
        let close = safari.buttons["Close speed controls"].firstMatch
        if close.exists && close.isHittable { close.tap() }
        wait("inline-rate-\(rate)") { abs((($0["current"] as? [String: Any])?["rate"] as? Double ?? -1) - rate) < 0.01 }
    }

    private func ownedRate(_ rate: Double) {
        reveal()
        let speed = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Playback speed'")).firstMatch
        XCTAssertTrue(speed.waitForExistence(timeout: 8)); speed.tap()
        if rate == 4 {
            XCTAssertTrue(safari.buttons["4×"].waitForExistence(timeout: 8)); safari.buttons["4×"].tap()
        } else {
            XCTAssertTrue(safari.buttons["Custom…"].waitForExistence(timeout: 8)); safari.buttons["Custom…"].tap()
            let input = safari.textFields["Custom playback speed"].firstMatch
            XCTAssertTrue(input.waitForExistence(timeout: 8)); input.tap()
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 24) + String(rate))
            XCTAssertTrue(safari.buttons["Set speed"].waitForExistence(timeout: 8)); safari.buttons["Set speed"].tap()
        }
        wait("owned-rate-\(rate)") { abs((($0["current"] as? [String: Any])?["rate"] as? Double ?? -1) - rate) < 0.01 }
    }

    private func assertOriginalOwnership(_ row: [String: Any], companionExpected: Bool) {
        guard let state = row["invariants"] as? [String: Any],
              let original = row["original"] as? [String: Any],
              let current = row["current"] as? [String: Any] else {
            XCTFail("Missing captured original identity/source invariants: \(row)"); return
        }
        XCTAssertEqual(original["id"] as? Int, state["originalId"] as? Int, "Original node identity changed")
        XCTAssertEqual(state["originalConnected"] as? Bool, true)
        XCTAssertEqual(state["sameSourceObject"] as? Bool, true, "Original MediaSource/srcObject changed")
        XCTAssertEqual(state["allowedOriginalSource"] as? Bool, true,
                       "Only a supplied same-asset native-HLS MP4 transition may change the original URL")
        if state["blob"] as? Bool == true && companionExpected {
            XCTAssertEqual(row["retained"] as? Bool, true)
            XCTAssertEqual(state["originalParentUnchanged"] as? Bool, true, "Original MSE node was portaled")
            XCTAssertEqual(state["originalSourceUnchanged"] as? Bool, true, "Original MSE source changed")
            XCTAssertEqual(original["paused"] as? Bool, true)
            XCTAssertEqual(state["currentIsOriginal"] as? Bool, false)
            XCTAssertNotEqual(current["id"] as? Int, original["id"] as? Int)
            XCTAssertEqual(state["companionSourceMatches"] as? Bool, true, "Companion does not use its supplied MP4")
        } else {
            XCTAssertEqual(state["currentIsOriginal"] as? Bool, true, "Native-HLS/direct playback must retain the original node")
        }
    }

    private func handBackToSite() {
        // Inline playback has no More menu. Enter owned presentation through the
        // same genuine fullscreen control before selecting Use site player.
        if current()["owned"] as? Bool != true {
            reveal()
            let fullscreen = safari.buttons["Open video fullscreen"].firstMatch
            XCTAssertTrue(fullscreen.waitForExistence(timeout: 8)); fullscreen.tap()
            wait("handback-owned-entry") { ($0["current"] as? [String: Any])?["owned"] as? Bool == true }
        }
        reveal()
        let more = safari.buttons["More video options"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 8)); more.tap()
        let site = safari.buttons["Use site player"].firstMatch
        XCTAssertTrue(site.waitForExistence(timeout: 8)); site.tap()
        wait("site-handback") { row in
            guard let state = row["invariants"] as? [String: Any],
                  let original = row["original"] as? [String: Any],
                  let current = row["current"] as? [String: Any] else { return false }
            return row["retained"] as? Bool == false && state["currentIsOriginal"] as? Bool == true &&
                original["id"] as? Int == state["originalId"] as? Int &&
                current["id"] as? Int == original["id"] as? Int &&
                current["owned"] as? Bool == false && current["paused"] as? Bool == false &&
                state["originalParentUnchanged"] as? Bool == true && state["allowedOriginalSource"] as? Bool == true
        }
        let before = current()
        guard let id = before["id"] as? Int, let frames = before["frames"] as? Int,
              let played = before["played"] as? Double else { XCTFail("No original decoder observation after handback"); return }
        wait("site-original-decoded-progress", timeout: 12) { row in
            guard let state = row["invariants"] as? [String: Any],
                  let video = row["current"] as? [String: Any] else { return false }
            return state["currentIsOriginal"] as? Bool == true && video["id"] as? Int == id &&
                (video["frames"] as? Int ?? 0) - frames >= 10 &&
                (video["played"] as? Double ?? 0) - played > 0.5 && video["paused"] as? Bool == false
        }
        assertOriginalOwnership(report(safari), companionExpected: false)
        XCTAssertEqual((report(safari)["invariants"] as? [String: Any])?["originalParentUnchanged"] as? Bool, true)
        capture(safari, "live-x-site-decoded-handback")
    }

    private func measure(_ rate: Double, owned: Bool) {
        playIfPaused()
        assertOriginalOwnership(report(safari), companionExpected: true)
        let before = current(), start = report(safari)["now"] as? Double ?? -1
        guard let id = before["id"] as? Int, let first = before["played"] as? Double, let frames = before["frames"] as? Int else { XCTFail("Missing real presented-frame observations"); return }
        wait("decoded-\(rate)", timeout: 15) { row in
            guard let video = row["current"] as? [String: Any] else { return false }
            return video["id"] as? Int == id && (row["now"] as? Double ?? 0) - start >= 3000 && (video["frames"] as? Int ?? 0) > frames
        }
        let after = current(), end = report(safari)["now"] as? Double ?? start
        let ratio = ((after["played"] as? Double ?? first) - first) / ((end - start) / 1000)
        XCTAssertEqual(after["id"] as? Int, id, "Media changed during measurement")
        XCTAssertEqual(after["paused"] as? Bool, false)
        XCTAssertEqual(after["owned"] as? Bool, owned)
        XCTAssertEqual(after["rate"] as? Double ?? -1, rate, accuracy: 0.01)
        XCTAssertGreaterThanOrEqual((after["frames"] as? Int ?? 0) - frames, 45)
        XCTAssertEqual(ratio, rate, accuracy: rate * 0.15, "Actual presented-media progress: \(ratio)")
        // Per-100ms buckets retain the largest actual callback gap, with its
        // timestamp. Clip boundary gaps to this measurement and include any
        // trailing stall since the last callback; averages cannot hide freezes.
        let gaps = after["frameGaps"] as? [[Double]] ?? []
        XCTAssertTrue(gaps.contains { $0.count == 2 && $0[0] - $0[1] <= start }, "Frame-gap history does not cover the measurement")
        let callbackGap = gaps.filter { $0.count == 2 && $0[0] >= start && $0[0] <= end }
            .map { min($0[1], $0[0] - start) }.max() ?? 0
        let maxGapMs = max(callbackGap, end - (after["lastFrameAt"] as? Double ?? start))
        XCTAssertLessThan(maxGapMs, 1000, "Actual maximum callback gap during measurement: \(maxGapMs)ms")
        let gapReport = XCTAttachment(string: "rate=\(rate) start=\(start) end=\(end) maxWallClockCallbackGapMs=\(maxGapMs)")
        gapReport.name = "live-x-frame-gap"; gapReport.lifetime = .keepAlways; add(gapReport)
        assertOriginalOwnership(report(safari), companionExpected: true)
        XCTAssertTrue((report(safari)["failures"] as? [String] ?? []).isEmpty, "\(report(safari))")
        capture(safari, "live-x-\(owned ? "owned" : "inline")-\(rate)x")
    }

    private func run(rate: Double, owned: Bool) {
        prepare()
        playIfPaused()
        if owned {
            reveal()
            let fullscreen = safari.buttons["Open video fullscreen"].firstMatch
            XCTAssertTrue(fullscreen.waitForExistence(timeout: 8)); fullscreen.tap()
            wait("owned-entry") { ($0["current"] as? [String: Any])?["owned"] as? Bool == true }
            ownedRate(rate)
        } else { inlineRate(rate) }
        measure(rate, owned: owned)
        handBackToSite()
    }

    /// Harness-only smoke check; passing this is NOT fast-playback acceptance.
    func testReportedPostDiagnosticTransportOnly() {
        prepare()
        XCTAssertFalse((current()["currentSrc"] as? String ?? "").isEmpty)
        XCTAssertNotNil(current()["rate"] as? Double)
        capture(safari, "live-x-diagnostic-transport-only")
    }

    func testReportedPostInlineJustAboveTwo() { run(rate: 2.1, owned: false) }
    func testReportedPostInlineFourTimes() { run(rate: 4, owned: false) }
    func testReportedPostOwnedJustAboveTwo() { run(rate: 2.1, owned: true) }
    func testReportedPostOwnedFourTimes() { run(rate: 4, owned: true) }
}
