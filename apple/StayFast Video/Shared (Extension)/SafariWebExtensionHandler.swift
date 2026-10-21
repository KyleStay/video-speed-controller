import SafariServices

// StayFast uses WebExtension storage and messaging only. There is no native
// data channel, account, or server; reject unexpected native requests silently.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }
}
