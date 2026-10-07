/** The OS the app runs on, read from the webview (WebView2, WKWebView, WebKitGTK). */
const ua = typeof navigator !== "undefined" ? `${navigator.platform} ${navigator.userAgent}` : "";

export const isMac = /Mac/.test(ua);
export const isWindows = /Win/.test(ua);
export const isLinux = !isMac && !isWindows && /Linux|X11/.test(ua);

/** What the system file manager is called here. */
export const FILE_MANAGER = isMac ? "Finder" : isWindows ? "File Explorer" : "File Manager";
export const REVEAL_LABEL = `Reveal in ${FILE_MANAGER}`;
