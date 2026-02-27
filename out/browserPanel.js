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
    /** Show course slides in an iframe with an external nav bar. */
    showSlides(url) {
        this.log.info(`[BrowserPanel] showSlides(${url})`);
        this.currentUrl = url;
        this.ensurePanel();
        const parts = url.replace(/\/+$/, '').split('/');
        const name = parts[parts.length - 1]?.replace(/-/g, ' ') || 'Course';
        this.panel.title = name;
        this.log.info(`[BrowserPanel] Showing slides with nav bar: ${url}`);
        const nonce = getNonce();
        const config = vscode.workspace.getConfiguration('labGuide');
        const showNotes = config.get('showNotes', true);
        const enforceSteps = config.get('enforceStepCompletion', true);
        const followMotion = config.get('followVSCodeMotion', true);
        this.panel.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src https:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; display: flex; flex-direction: column; background: #0d1117; }
    iframe { flex: 1; width: 100%; border: none; }
    .nav-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 12px; background: #161b22; border-top: 1px solid #30363d;
      color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px; user-select: none;
    }
    .nav-bar button {
      background: #21262d; color: #e6edf3; border: 1px solid #30363d;
      border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 13px;
      transition: background 0.15s;
    }
    .nav-bar button:hover:not(:disabled) { background: #30363d; }
    .nav-bar button:disabled { opacity: 0.4; cursor: default; }
    .nav-bar .nav-center { display: flex; align-items: center; gap: 8px; }
    .nav-bar .home-btn { font-size: 16px; padding: 4px 8px; }
    .settings-btn { padding: 4px 8px; font-size: 15px; }
    .float-hint {
      position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%);
      background: #388bfd; color: #fff; font-size: 12px; font-weight: 600;
      padding: 5px 14px; border-radius: 6px; white-space: nowrap;
      pointer-events: none; animation: floatUp 2s ease-out forwards;
      box-shadow: 0 2px 12px rgba(56,139,253,0.5);
    }
    @keyframes floatUp {
      0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
      100% { opacity: 0; transform: translateX(-50%) translateY(-60px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .float-hint {
        animation: none !important;
        opacity: 1;
      }
    }
  </style>
</head>
<body>
  <iframe id="slides" src="${escapeHtml(url)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  <div class="nav-bar">
    <button class="home-btn" id="homeBtn" title="Course Navigator">&#8962;</button>
    <div class="nav-center">
      <button id="prevBtn" title="Previous slide" disabled>&#8592; Prev</button>
      <span id="counter">1 / ?</span>
      <button id="nextBtn" title="Next slide">Next &#8594;</button>
    </div>
    <button class="settings-btn" id="settingsBtn" title="Lab Guide Settings">&#9881;</button>
  </div>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      var iframe = document.getElementById('slides');
      var prevBtn = document.getElementById('prevBtn');
      var nextBtn = document.getElementById('nextBtn');
      var homeBtn = document.getElementById('homeBtn');
      var settingsBtn = document.getElementById('settingsBtn');
      var counterEl = document.getElementById('counter');
      var currentSlide = 1;
      var totalSlides = 0;
      var notesOn = ${showNotes};
      var hasExtraSteps = false;
      var ENFORCE_STEPS = ${enforceSteps};
      var FOLLOW_MOTION = ${followMotion};

      function updateUI() {
        prevBtn.disabled = currentSlide <= 1;
        nextBtn.disabled = totalSlides > 0 && currentSlide >= totalSlides;
        counterEl.textContent = currentSlide + ' / ' + (totalSlides || '?');
      }

      function showFloatHint() {
        var hint = document.createElement('div');
        hint.className = 'float-hint';
        hint.textContent = 'Extra steps available!';
        if (!FOLLOW_MOTION) {
          hint.style.animation = 'floatUp 2s ease-out forwards';
        }
        document.body.appendChild(hint);
        hint.addEventListener('animationend', function() { hint.remove(); });
      }

      // Apply initial notes setting on iframe load
      iframe.addEventListener('load', function() {
        iframe.contentWindow.postMessage({ type: 'setNotes', visible: notesOn }, '*');
      });

      // Listen for init message from slides.js (total count)
      window.addEventListener('message', function(e) {
        if (!e.data || !e.data.type) return;
        if (e.data.type === 'init' && typeof e.data.total === 'number') {
          totalSlides = e.data.total;
          updateUI();
        } else if (e.data.type === 'goHome') {
          vscode.postMessage({ type: 'iframeNavigated' });
        } else if (e.data.type === 'setExtraSteps') {
          hasExtraSteps = !!e.data.hasExtra;
        }
      });

      prevBtn.addEventListener('click', function() {
        if (currentSlide > 1) {
          currentSlide--;
          iframe.contentWindow.postMessage({ type: 'navigate', direction: 'prev' }, '*');
          updateUI();
          vscode.postMessage({ type: 'slideChanged', slide: currentSlide });
        }
      });

      nextBtn.addEventListener('click', function() {
        if (hasExtraSteps && ENFORCE_STEPS) {
          showFloatHint();
          vscode.postMessage({ type: 'extraStepsBlocked' });
          return;
        }
        if (totalSlides === 0 || currentSlide < totalSlides) {
          currentSlide++;
          iframe.contentWindow.postMessage({ type: 'navigate', direction: 'next' }, '*');
          updateUI();
          vscode.postMessage({ type: 'slideChanged', slide: currentSlide });
        }
      });

      homeBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'iframeNavigated' });
      });

      settingsBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'openSettings' });
      });

      // Keyboard nav in the parent webview
      document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight' || e.key === ' ') {
          e.preventDefault();
          nextBtn.click();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          prevBtn.click();
        } else if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) {
          notesOn = !notesOn;
          iframe.contentWindow.postMessage({ type: 'toggleNotes' }, '*');
        }
      });

      // Initial state
      vscode.postMessage({ type: 'slideChanged', slide: 1 });
      updateUI();
    })();
  </script>
</body>
</html>`;
    }
    /** Send a message to the browser webview (e.g. setExtraSteps). */
    postMessage(message) {
        this.panel?.webview.postMessage(message);
    }
    /** Reload the current content. */
    async refresh() {
        if (!this.currentUrl) {
            return;
        }
        this.log.info(`[BrowserPanel] Refreshing: ${this.currentUrl}`);
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
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            this.log.info(`[BrowserPanel] Received message: ${JSON.stringify(msg)}`);
            if (msg.type === 'openSettings') {
                vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms-demoland.lab-guide');
                return;
            }
            if (msg.type === 'iframeNavigated' && this.catalogUrl) {
                this.log.info('[BrowserPanel] Home requested, forwarding to controller for cleanup');
                // Forward to controller FIRST so it can clean up guide panel, editors, etc.
                if (this.messageHandler) {
                    await this.messageHandler(msg);
                }
                // Then navigate back to catalog
                this.log.info('[BrowserPanel] Returning to catalog');
                this.showCatalog(this.catalogUrl);
                // Reveal this panel and close any lingering editors in all groups
                this.panel.reveal(vscode.ViewColumn.One);
                await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
                await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
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
        const nonce = getNonce();
        const handler = /*html*/ `
<script nonce="${nonce}">
(function() {
  var vscode = acquireVsCodeApi();
  console.log('[Catalog] Handler injected, base=' + ${JSON.stringify(base)});

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
        // Inject <base> and CSP — nonce-gate scripts instead of 'unsafe-inline'
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapeHtml(base)}/ data:; style-src ${escapeHtml(base)}/ 'unsafe-inline'; font-src ${escapeHtml(base)}/; script-src 'nonce-${nonce}';">`;
        modified = modified.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${escapeHtml(base)}/">\n${csp}`);
        // Remove the original catalog script that fires vscode:// URIs into the system browser.
        // It conflicts with our injected handler since the webview is not an iframe.
        modified = modified.replace(/\/\/\s*──\s*Lab Guide integration[\s\S]*?<\/script>/i, '</script>');
        // Add nonce to surviving inline <script> tags (e.g. tab switching)
        modified = modified.replace(/<script(?![^>]*\bnonce\b)(?![^>]*\bsrc\b)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);
        // Inject our handler before </body>
        modified = modified.replace(/<\/body>/i, handler + '\n</body>');
        return modified;
    }
    fetchText(url, allowedOrigin) {
        return new Promise((resolve) => {
            const client = url.startsWith('https') ? https : http;
            const origin = allowedOrigin ?? new URL(url).origin;
            const req = client.get(url, { timeout: 10000 }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    try {
                        const redirectOrigin = new URL(res.headers.location).origin;
                        if (redirectOrigin !== origin) {
                            this.log.warn(`[BrowserPanel] Blocked cross-origin redirect → ${res.headers.location}`);
                            resolve(null);
                            return;
                        }
                    }
                    catch {
                        this.log.warn(`[BrowserPanel] Blocked invalid redirect URL`);
                        resolve(null);
                        return;
                    }
                    this.log.info(`[BrowserPanel] Following redirect → ${res.headers.location}`);
                    this.fetchText(res.headers.location, origin).then(resolve);
                    return;
                }
                if (res.statusCode !== 200) {
                    this.log.error(`[BrowserPanel] fetchText ${url} → HTTP ${res.statusCode}`);
                    res.resume();
                    resolve(null);
                    return;
                }
                const maxSize = 2 * 1024 * 1024; // 2 MB
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > maxSize) {
                        this.log.warn('[BrowserPanel] Response exceeded 2 MB limit');
                        res.destroy();
                        resolve(null);
                    }
                });
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