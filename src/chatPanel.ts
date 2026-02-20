import * as vscode from 'vscode';

export class ChatPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private onMessage: (msg: { type: string }) => void
  ) {}

  show() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'labGuide.simulatedChat',
      'Copilot Chat',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      }
    );

    const iconUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'copilot-icon.svg');
    this.panel.iconPath = { light: iconUri, dark: iconUri };
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    this.panel.onDidDispose(() => { this.panel = undefined; });
  }

  postMessage(message: unknown) {
    this.panel?.webview.postMessage(message);
  }

  dispose() {
    this.panel?.dispose();
  }

  private getHtml(): string {
    const wv = this.panel!.webview;
    const mediaUri = (file: string) =>
      wv.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${wv.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${mediaUri('chat.css')}" rel="stylesheet">
</head>
<body>
  <div class="chat-container">
    <!-- ── Header ── -->
    <div class="chat-header" id="chatHeader">
      <div class="chat-title">
        <svg class="copilot-icon" viewBox="0 0 16 16" width="16" height="16">
          <path fill="currentColor" d="M7.998 0a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM5.6 8.6a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm4.8 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"/>
        </svg>
        <span>GitHub Copilot</span>
      </div>
      <div class="model-selector" id="modelSelector">
        <span class="model-name">Claude 3.5 Sonnet</span>
        <span class="dropdown-arrow">&#9662;</span>
      </div>
    </div>

    <!-- ── Messages ── -->
    <div class="chat-messages" id="messages">
      <div class="welcome-message" id="welcome">
        <svg class="copilot-logo" viewBox="0 0 16 16" width="32" height="32">
          <path fill="currentColor" d="M7.998 0a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM5.6 8.6a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm4.8 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"/>
        </svg>
        <p>How can I help you today?</p>
      </div>
    </div>

    <!-- ── Input area ── -->
    <div class="chat-input-area" id="chatInputArea">
      <div class="chat-input-wrapper">
        <div class="chat-tools">
          <button class="tool-btn" title="Attach context">
            <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3.5 1.75a.25.25 0 0 1 .25-.25h3.168a.75.75 0 0 0 0-1.5H3.75A1.75 1.75 0 0 0 2 1.75v12.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 14.25V6.607a.75.75 0 0 0-1.5 0v7.643a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25V1.75Z"/><path fill="currentColor" d="M10 6a.75.75 0 0 0 0 1.5h1.75a.75.75 0 0 0 0-1.5H10Zm-3.25.75a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75ZM7.5 9a.75.75 0 0 0 0 1.5h4.25a.75.75 0 0 0 0-1.5H7.5Z"/></svg>
          </button>
        </div>
        <textarea id="chatInput" placeholder="Ask Copilot or type / for commands" rows="1"></textarea>
        <button class="send-btn" id="sendBtn" title="Send">
          <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.343 1.343 0 0 1-1.85-1.463L.99 8Zm.603-4.16L2.2 7.472l5.144.001a.75.75 0 0 1 0 1.5H2.199l-.608 3.834L13.55 8Z"/></svg>
          </button>
      </div>
    </div>
  </div>

  <!-- ── Step banner (instructor controls) ── -->
  <div class="step-banner" id="stepBanner">
    <div class="step-header">
      <span class="step-badge" id="stepNumber">Step 1 of 5</span>
      <span class="step-title" id="stepTitle"></span>
    </div>
    <div class="step-instruction" id="stepInstruction"></div>
    <div class="step-nav">
      <button id="prevBtn" class="step-btn">&#8592; Prev</button>
      <button id="nextBtn" class="step-btn step-btn--primary">Next &#8594;</button>
    </div>
  </div>

  <script nonce="${nonce}" src="${mediaUri('chat.js')}"></script>
</body>
</html>`;
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
