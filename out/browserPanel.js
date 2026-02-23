"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserPanel = void 0;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
class BrowserPanel {
    constructor(context, log) {
        this.context = context;
        this.log = log;
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    /** Show catalog: fetch HTML from server, inject our click handler, display directly. */
    async showCatalog(url) {
        this.log.info(`[BrowserPanel] showCatalog(${url})`);
        this.currentUrl = url;
        this.catalogUrl = url;
        this.ensurePanel();
        this.panel.title = 'Course Catalog';
        this.log.info(`[BrowserPanel] Fetching catalog HTML from ${url}`);
        const html = await this.fetchText(url);
        if (!html) {
            this.log.error(`[BrowserPanel] Failed to fetch catalog from ${url}`);
            this.panel.webview.html = `<!DOCTYPE html><html><body style="color:#ccc;padding:2em;">
        <h2>Could not load catalog</h2>
        <p>Failed to fetch <code>${escapeHtml(url)}</code></p>
      </body></html>`;
            return;
        }
        this.log.info(`[BrowserPanel] Catalog HTML fetched (${html.length} bytes), injecting handler`);
        this.panel.webview.html = this.injectCatalogHandler(html, url);
    }
    /** Show course slides in an iframe (no interception needed). */
    showSlides(url) {
        this.log.info(`[BrowserPanel] showSlides(${url})`);
        this.currentUrl = url;
        this.ensurePanel();
        const parts = url.replace(/\/+$/, '').split('/');
        const name = parts[parts.length - 1]?.replace(/-/g, ' ') || 'Course';
        this.panel.title = name;
        this.log.info(`[BrowserPanel] Showing slides iframe: ${url}, title=${name}`);
        const nonce = getNonce();
        this.panel.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src https: http:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe src="${escapeHtml(url)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      var iframe = document.querySelector('iframe');
      var firstLoad = true;
      iframe.addEventListener('load', function() {
        if (firstLoad) { firstLoad = false; return; }
        vscode.postMessage({ type: 'iframeNavigated' });
      });
    })();
  </script>
</body>
</html>`;
    }
    /** Reload the current content. */
    async refresh() {
        if (!this.currentUrl) {
            return;
        }
        this.log.info(`[BrowserPanel] Refreshing: ${this.currentUrl}`);
        // Determine mode from panel title
        if (this.panel?.title === 'Course Catalog') {
            await this.showCatalog(this.currentUrl);
        }
        else {
            this.showSlides(this.currentUrl);
        }
    }
    dispose() {
        this.panel?.dispose();
    }
    // ── Private helpers ───────────────────────────────────────────
    ensurePanel() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }
        this.panel = vscode.window.createWebviewPanel('labGuide.browser', 'Course Catalog', { viewColumn: vscode.ViewColumn.One, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.onDidReceiveMessage(msg => {
            this.log.info(`[BrowserPanel] Received message: ${JSON.stringify(msg)}`);
            if (msg.type === 'iframeNavigated' && this.catalogUrl) {
                this.log.info('[BrowserPanel] Iframe navigated away from slides, returning to catalog');
                this.showCatalog(this.catalogUrl);
                return;
            }
            if (this.messageHandler) {
                this.messageHandler(msg);
            }
        }, undefined, this.context.subscriptions);
        this.panel.onDidDispose(() => { this.panel = undefined; });
    }
    /** Inject <base> tag and click handler into fetched catalog HTML. */
    injectCatalogHandler(html, catalogUrl) {
        const base = catalogUrl.replace(/\/index\.html$/i, '').replace(/\/+$/, '');
        const handler = /*html*/ `
<script>
(function() {
  var vscode = acquireVsCodeApi();
  console.log('[Catalog] Handler injected, base=${base}');

  // Replace setup button — we're already in VS Code
  var setupBtn = document.getElementById('setupBtn');
  if (setupBtn) {
    setupBtn.textContent = '\\u2713 Lab Guide Extension Active';
    setupBtn.classList.add('install-extension-btn--active');
    setupBtn.removeAttribute('href');
    setupBtn.addEventListener('click', function(e) { e.preventDefault(); });
  }

  // Hide the profile link — not needed inside VS Code
  var profileLink = document.getElementById('profileLink');
  if (profileLink) { profileLink.style.display = 'none'; }

  // Update subtitle
  var subtitle = document.querySelector('.nav-header p');
  if (subtitle) {
    subtitle.textContent = 'Click a course card below to start the hands-on lab';
  }

  // Intercept course card clicks.
  document.querySelectorAll('.course-card[href]').forEach(function(card) {
    card.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var href = card.getAttribute('href') || '';
      var coursePath = href.replace(/^\\.?\\.?\\//, '').replace(/\\/index\\.html$/, '');
      console.log('[Catalog] Card clicked: ' + coursePath);
      if (!coursePath) return;
      vscode.postMessage({
        type: 'labGuide.startCourse',
        server: '${base}',
        course: coursePath
      });
    }, true);
  });
})();
</script>`;
        let modified = html;
        // Inject <base> after <head> so relative URLs resolve to the remote server
        modified = modified.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${escapeHtml(base)}/">`);
        // Remove the original catalog script that fires vscode:// URIs into the system browser.
        // It conflicts with our injected handler since the webview is not an iframe.
        modified = modified.replace(/\/\/\s*──\s*Lab Guide integration[\s\S]*?<\/script>/i, '</script>');
        // Inject our handler before </body>
        modified = modified.replace(/<\/body>/i, handler + '\n</body>');
        return modified;
    }
    fetchText(url) {
        return new Promise((resolve) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, { timeout: 10000 }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.log.info(`[BrowserPanel] Following redirect → ${res.headers.location}`);
                    this.fetchText(res.headers.location).then(resolve);
                    return;
                }
                if (res.statusCode !== 200) {
                    this.log.error(`[BrowserPanel] fetchText ${url} → HTTP ${res.statusCode}`);
                    resolve(null);
                    return;
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve(data));
            });
            req.on('error', (e) => { this.log.error(`[BrowserPanel] fetchText error: ${e.message}`); resolve(null); });
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }
}
exports.BrowserPanel = BrowserPanel;
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
//# sourceMappingURL=browserPanel.js.map