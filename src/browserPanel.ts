import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

export class BrowserPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentUrl: string | undefined;
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

  /** Show course slides in an iframe (no interception needed). */
  showSlides(url: string) {
    this.log.info(`[BrowserPanel] showSlides(${url})`);
    this.currentUrl = url;
    this.ensurePanel();
    const parts = url.replace(/\/+$/, '').split('/');
    const name = parts[parts.length - 1]?.replace(/-/g, ' ') || 'Course';
    this.panel!.title = name;
    this.log.info(`[BrowserPanel] Showing slides iframe: ${url}, title=${name}`);
    const nonce = getNonce();
    this.panel!.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src https: http:; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe src="${escapeHtml(url)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</body>
</html>`;
  }

  /** Reload the current content. */
  async refresh() {
    if (!this.currentUrl) { return; }
    this.log.info(`[BrowserPanel] Refreshing: ${this.currentUrl}`);
    // Determine mode from panel title
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

    this.panel.webview.onDidReceiveMessage(msg => {
      this.log.info(`[BrowserPanel] Received message: ${JSON.stringify(msg)}`);
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

  // Intercept course card clicks
  document.querySelectorAll('.course-card[href]').forEach(function(card) {
    card.addEventListener('click', function(e) {
      e.preventDefault();
      var href = card.getAttribute('href') || '';
      var coursePath = href.replace(/^\\.?\\.?\\//, '').replace(/\\/index\\.html$/, '');
      console.log('[Catalog] Card clicked: ' + coursePath);
      if (!coursePath) return;
      vscode.postMessage({
        type: 'labGuide.startCourse',
        server: '${base}',
        course: coursePath
      });
    });
  });
})();
</script>`;

    let modified = html;
    // Inject <base> after <head> so relative URLs resolve to the remote server
    modified = modified.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${escapeHtml(base)}/">`);
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
