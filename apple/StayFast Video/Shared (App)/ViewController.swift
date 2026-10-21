import WebKit
import SafariServices

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "co.staytech.stayfast.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        guard let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
              let resources = Bundle.main.resourceURL else { return }
        webView.loadFileURL(page, allowingReadAccessTo: resources)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.lastPathComponent == "Main.html" else { return }
#if os(iOS)
        if #available(iOS 26.2, *) {
            webView.evaluateJavaScript("show('ios', null, true)")
        } else {
            webView.evaluateJavaScript("show('ios')")
        }
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac')")
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            guard let state = state, error == nil else { return }
            DispatchQueue.main.async {
                webView.evaluateJavaScript("show('mac', \(state.isEnabled))")
            }
        }
#endif
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.isFileURL {
            decisionHandler(.allow)
            return
        }
        // Keep the app's web view local. A deliberate Support tap opens only
        // the public project tracker in the system browser.
        decisionHandler(.cancel)
        guard navigationAction.navigationType == .linkActivated,
              navigationAction.sourceFrame.isMainFrame,
              navigationAction.sourceFrame.request.url?.isFileURL == true,
              url.absoluteString == "https://github.com/KyleStay/video-speed-controller/issues" else { return }
#if os(iOS)
        UIApplication.shared.open(url) { opened in
            if !opened {
                DispatchQueue.main.async {
                    webView.evaluateJavaScript("document.getElementById('support-error')?.removeAttribute('hidden')")
                }
            }
        }
#elseif os(macOS)
        if !NSWorkspace.shared.open(url) {
            webView.evaluateJavaScript("document.getElementById('support-error')?.removeAttribute('hidden')")
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.isFileURL == true,
              message.body as? String == "open-preferences" else { return }
#if os(iOS)
        if #available(iOS 26.2, *) {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) { error in
                if error != nil {
                    self.webView.evaluateJavaScript("showSettingsError()")
                }
            }
        }
#elseif os(macOS)
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            if error != nil {
                DispatchQueue.main.async { self.webView.evaluateJavaScript("showSettingsError()") }
            }
        }
#endif
    }
}
