import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

export class BrowserPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentUrl: string | undefined;
  private catalogUrl: string | undefined;
  private messageHandler: ((msg: any) => void) | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private log: vscode.LogOutputChannel
  ) {}

  onMessage(handler: (msg: any) => void) {
    this.messageHandler = handler;
  }

  /** Show catalog: fetch HTML from server, inject our click handler, display directly. */
  async showCatalog(url: string) {
    this.log.info(`[BrowserPanel] showCatalog(${url})`);
    this.currentUrl = url;
    this.catalogUrl = url;

    this.ensurePanel();
    this.panel!.title = 'Course Catalog';

    this.log.info(`[BrowserPanel] Fetching catalog HTML from ${url}`);
    const html = await this.fetchText(url);
    if (!html) {
      this.log.error(`[BrowserPanel] Failed to fetch catalog from ${url}`);
      this.panel!.webview.html = `<!DOCTYPE html><html><body style="color:#ccc;padding:2em;">
        <h2>Could not load catalog</h2>
        <p>Failed to fetch <code>${escapeHtml(url)}</code></p>
      </body></html>`;
      return;
    }

    this.log.info(`[BrowserPanel] Catalog HTML fetched (${html.length} bytes), injecting handler`);
    this.panel!.webview.html = this.injectCatalogHandler(html, url);
  }

  /** Show course slides in an iframe with an external nav bar. */
  showSlides(url: string) {
    this.log.info(`[BrowserPanel] showSlides(${url})`);
    this.currentUrl = url;
    this.ensurePanel();
    const parts = url.replace(/\/+$/, '').split('/');
    const name = parts[parts.length - 1]?.replace(/-/g, ' ') || 'Course';
    this.panel!.title = name;
    this.log.info(`[BrowserPanel] Showing slides with nav bar: ${url}`);
    const nonce = getNonce();
    this.panel!.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src https: http:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
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
    .nav-bar .notes-btn { padding: 4px 8px; }
    .nav-bar .notes-btn.active { background: #388bfd; border-color: #388bfd; color: #fff; }
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
    <button class="notes-btn" id="notesBtn" title="Toggle speaker notes (N)">&#9998; Notes</button>
  </div>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      var iframe = document.getElementById('slides');
      var prevBtn = document.getElementById('prevBtn');
      var nextBtn = document.getElementById('nextBtn');
      var homeBtn = document.getElementById('homeBtn');
      var notesBtn = document.getElementById('notesBtn');
      var counterEl = document.getElementById('counter');
      var currentSlide = 1;
      var totalSlides = 0;
      var notesOn = false;

      function updateUI() {
        prevBtn.disabled = currentSlide <= 1;
        nextBtn.disabled = totalSlides > 0 && currentSlide >= totalSlides;
        counterEl.textContent = currentSlide + ' / ' + (totalSlides || '?');
      }

      // Listen for init message from slides.js (total count)
      window.addEventListener('message', function(e) {
        if (!e.data || !e.data.type) return;
        if (e.data.type === 'init' && typeof e.data.total === 'number') {
          totalSlides = e.data.total;
          updateUI();
        } else if (e.data.type === 'goHome') {
          vscode.postMessage({ type: 'iframeNavigated' });
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

      notesBtn.addEventListener('click', function() {
        notesOn = !notesOn;
        notesBtn.classList.toggle('active', notesOn);
        iframe.contentWindow.postMessage({ type: 'toggleNotes' }, '*');
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
          notesBtn.click();
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

  /** Reload the current content. */
  async refresh() {
    if (!this.currentUrl) { return; }
    this.log.info(`[BrowserPanel] Refreshing: ${this.currentUrl}`);
    if (this.panel?.title === 'Course Catalog') {
      await this.showCatalog(this.currentUrl);
    } else {
      this.showSlides(this.currentUrl);
    }
  }

  dispose() {
    this.panel?.dispose();
  }

  // ── Private helpers ───────────────────────────────────────────

  private ensurePanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'labGuide.browser',
      'Course Catalog',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.onDidReceiveMessage(async msg => {
      this.log.info(`[BrowserPanel] Received message: ${JSON.stringify(msg)}`);
      if (msg.type === 'iframeNavigated' && this.catalogUrl) {
        this.log.info('[BrowserPanel] Home requested, forwarding to controller for cleanup');
        // Forward to controller FIRST so it can clean up guide panel, editors, etc.
        if (this.messageHandler) { this.messageHandler(msg); }
        // Then navigate back to catalog
        this.log.info('[BrowserPanel] Returning to catalog');
        this.showCatalog(this.catalogUrl);
        // Reveal this panel and close any lingering editors in all groups
        this.panel!.reveal(vscode.ViewColumn.One);
        await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
        await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
        return;
      }
      if (this.messageHandler) { this.messageHandler(msg); }
    }, undefined, this.context.subscriptions);

    this.panel.onDidDispose(() => { this.panel = undefined; });
  }

  /** Inject <base> tag and click handler into fetched catalog HTML. */
  private injectCatalogHandler(html: string, catalogUrl: string): string {
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
    // Rewrite relative fetch() calls to absolute URLs (fetch doesn't use <base> in webviews)
    modified = modified.replace(/fetch\(\s*['"]api\//g, `fetch('${base}/api/`);
    // Remove the original catalog script that fires vscode:// URIs into the system browser.
    // It conflicts with our injected handler since the webview is not an iframe.
    modified = modified.replace(
      /\/\/\s*──\s*Lab Guide integration[\s\S]*?<\/script>/i,
      '</script>'
    );
    // Inject our handler before </body>
    modified = modified.replace(/<\/body>/i, handler + '\n</body>');

    return modified;
  }

  private fetchText(url: string): Promise<string | null> {
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
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', (e: Error) => { this.log.error(`[BrowserPanel] fetchText error: ${e.message}`); resolve(null); });
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
