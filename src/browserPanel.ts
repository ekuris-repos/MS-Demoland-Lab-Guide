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

  /** Show course slides: fetch HTML + JS, inject detection, display directly. */
  async showSlides(url: string) {
    this.log.info(`[BrowserPanel] showSlides(${url})`);
    this.currentUrl = url;
    this.ensurePanel();
    const parts = url.replace(/\/+$/, '').split('/');
    const name = parts[parts.length - 1]?.replace(/-/g, ' ') || 'Course';
    this.panel!.title = name;

    this.log.info(`[BrowserPanel] Fetching slides HTML from ${url}`);
    const html = await this.fetchText(url);
    if (!html) {
      this.log.error(`[BrowserPanel] Failed to fetch slides from ${url}`);
      this.panel!.webview.html = `<!DOCTYPE html><html><body style="color:#ccc;padding:2em;">
        <h2>Could not load slides</h2>
        <p>Failed to fetch <code>${escapeHtml(url)}</code></p>
      </body></html>`;
      return;
    }

    this.log.info(`[BrowserPanel] Slides HTML fetched (${html.length} bytes), injecting handler`);
    this.panel!.webview.html = await this.injectSlidesHandler(html, url);
  }

  /** Reload the current content. */
  async refresh() {
    if (!this.currentUrl) { return; }
    this.log.info(`[BrowserPanel] Refreshing: ${this.currentUrl}`);
    // Determine mode from panel title
    if (this.panel?.title === 'Course Catalog') {
      await this.showCatalog(this.currentUrl);
    } else {
      await this.showSlides(this.currentUrl);
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

    this.panel.webview.onDidReceiveMessage(msg => {
      this.log.info(`[BrowserPanel] Received message: ${JSON.stringify(msg)}`);
      if (msg.type === 'iframeNavigated' && this.catalogUrl) {
        this.log.info('[BrowserPanel] Iframe navigated away from slides, returning to catalog');
        this.showCatalog(this.catalogUrl);
        // Forward to controller so it can clean up
        if (this.messageHandler) { this.messageHandler(msg); }
        return;
      }
      if (this.messageHandler) { this.messageHandler(msg); }
    }, undefined, this.context.subscriptions);

    this.panel.onDidDispose(() => { this.panel = undefined; });
  }

  /** Inject <base> tag, inline external scripts, and slide-change detection into fetched slides HTML. */
  private async injectSlidesHandler(html: string, slidesUrl: string): Promise<string> {
    const base = slidesUrl.replace(/\/?$/, '/');
    const nonce = getNonce();

    let modified = html;

    // Inject <base> after <head> so relative URLs (CSS, images) resolve to the remote server
    modified = modified.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${escapeHtml(base)}">`);

    // Remove any existing CSP meta tags
    modified = modified.replace(/<meta[^>]*Content-Security-Policy[^>]*>/gi, '');

    // Webview-compatible CSP: nonce-only for scripts, remote origin for styles/images
    let origin: string;
    try { origin = new URL(base).origin; } catch { origin = 'https://ekuris-repos.github.io'; }
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; `
      + `script-src 'nonce-${nonce}'; `
      + `style-src 'unsafe-inline' ${origin}; `
      + `img-src https: data:; `
      + `font-src https: data:;">`;
    modified = modified.replace(/<base[^>]*>/, match => match + '\n' + csp);

    // Fetch and inline all external <script> tags so they run under the nonce
    const scriptTagRe = /<script[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi;
    let match: RegExpExecArray | null;
    const replacements: { original: string; src: string }[] = [];
    while ((match = scriptTagRe.exec(modified)) !== null) {
      replacements.push({ original: match[0], src: match[1] });
    }

    for (const rep of replacements) {
      // Resolve relative src against the base URL
      let scriptUrl: string;
      try { scriptUrl = new URL(rep.src, base).href; } catch { continue; }
      this.log.info(`[BrowserPanel] Fetching script: ${scriptUrl}`);
      const scriptContent = await this.fetchText(scriptUrl);
      if (scriptContent) {
        modified = modified.replace(rep.original, `<script nonce="${nonce}">\n${scriptContent}\n</script>`);
        this.log.info(`[BrowserPanel] Inlined script: ${scriptUrl} (${scriptContent.length} bytes)`);
      } else {
        this.log.warn(`[BrowserPanel] Failed to fetch script: ${scriptUrl}`);
      }
    }

    // Our slide detection handler — intercepts replaceState, home button, and extension banner
    const handler = /*html*/ `
<script nonce="${nonce}">
(function() {
  var vscode = acquireVsCodeApi();

  // Intercept history.replaceState to detect slide changes
  var origReplace = history.replaceState.bind(history);
  history.replaceState = function(state, title, url) {
    origReplace(state, title, url);
    var m = String(url || '').match(/#slide-(\\d+)/);
    if (m) {
      var slide = parseInt(m[1], 10);
      vscode.postMessage({ type: 'slideChanged', slide: slide });
    }
  };

  // Intercept home button click and keyboard 'h'/'H'
  document.addEventListener('click', function(e) {
    var btn = e.target.closest && e.target.closest('.slide-nav button:first-child');
    if (btn) {
      e.preventDefault();
      e.stopImmediatePropagation();
      vscode.postMessage({ type: 'iframeNavigated' });
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      vscode.postMessage({ type: 'iframeNavigated' });
    }
  }, true);

  // Remove extension banner if slides.js injects one
  var observer = new MutationObserver(function() {
    var banner = document.querySelector('.extension-banner');
    if (banner) { banner.remove(); observer.disconnect(); }
  });
  document.addEventListener('DOMContentLoaded', function() {
    observer.observe(document.body, { childList: true });
    // Send initial slide
    var m = location.hash.match(/#slide-(\\d+)/);
    var slide = m ? parseInt(m[1], 10) : 1;
    vscode.postMessage({ type: 'slideChanged', slide: slide });
  });
})();
</script>`;

    // Inject our detection handler into <head> — BEFORE slides.js so replaceState is patched first
    modified = modified.replace(/<\/head>/i, handler + '\n</head>');

    return modified;
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
