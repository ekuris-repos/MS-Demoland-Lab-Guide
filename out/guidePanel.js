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
exports.GuidePanel = void 0;
const vscode = __importStar(require("vscode"));
class GuidePanel {
    constructor(context, onMessage) {
        this.context = context;
        this.onMessage = onMessage;
        // Re-send settings when configuration or theme changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('labGuide')) {
                this.sendSettings();
            }
        }), vscode.window.onDidChangeActiveColorTheme(() => {
            this.sendSettings();
        }));
    }
    show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
            this.sendSettings();
            return;
        }
        this.panel = vscode.window.createWebviewPanel('labGuide.guide', 'Lab Guide', { viewColumn: vscode.ViewColumn.Two, preserveFocus: false }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        });
        const iconUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'copilot-icon.svg');
        this.panel.iconPath = { light: iconUri, dark: iconUri };
        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
        this.panel.onDidDispose(() => { this.panel = undefined; });
        // Send initial settings after panel is created
        this.sendSettings();
    }
    postMessage(message) {
        this.panel?.webview.postMessage(message);
    }
    /** Bring the guide panel back to focus without recreating it. */
    reveal() {
        this.panel?.reveal(vscode.ViewColumn.Two, false);
    }
    dispose() {
        this.panel?.dispose();
    }
    sendSettings() {
        if (!this.panel) {
            return;
        }
        const config = vscode.workspace.getConfiguration('labGuide');
        const reduceMotion = config.get('followVSCodeMotion', true);
        const followA11y = config.get('followVSCodeAccessibility', true);
        const isHighContrast = followA11y && (vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast ||
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight);
        this.panel.webview.postMessage({
            type: 'setSettings',
            reduceMotion: reduceMotion,
            highContrast: isHighContrast
        });
    }
    getHtml() {
        const wv = this.panel.webview;
        const mediaUri = (file) => wv.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
        const nonce = getNonce();
        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${wv.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';
             img-src ${wv.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${mediaUri('guide.css')}" rel="stylesheet">
</head>
<body>
  <!-- ── Edge glows ── -->
  <div class="edge-glow edge-glow--top" id="edgeTop"></div>
  <div class="edge-glow edge-glow--left" id="edgeLeft"></div>
  <div class="edge-glow edge-glow--right" id="edgeRight"></div>
  <div class="edge-glow edge-glow--bottom" id="edgeBottom"></div>

  <!-- ── Opening animation ── -->
  <div class="opening-overlay" id="openingOverlay">
    <div class="opening-spinner"></div>
  </div>

  <!-- ── Left arrow zone ── -->
  <div class="arrow-zone arrow-left" id="arrowLeft">
    <div class="arrow-stack">
      <svg class="arrow-svg" viewBox="0 0 48 80" width="48" height="80">
        <path d="M40 4 L8 40 L40 76" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="arrow-label" id="arrowLeftLabel">Slides</span>
    </div>
  </div>

  <!-- ── Right arrow zone ── -->
  <div class="arrow-zone arrow-right" id="arrowRight">
    <div class="arrow-stack">
      <svg class="arrow-svg" viewBox="0 0 48 80" width="48" height="80">
        <path d="M8 4 L40 40 L8 76" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="arrow-label" id="arrowRightLabel">Chat</span>
    </div>
  </div>

  <!-- ── Up arrow zone ── -->
  <div class="arrow-zone arrow-up" id="arrowUp">
    <div class="arrow-stack arrow-stack--horizontal">
      <svg class="arrow-svg" viewBox="0 0 80 48" width="80" height="48">
        <path d="M4 40 L40 8 L76 40" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="arrow-label" id="arrowUpLabel">Editor</span>
    </div>
  </div>

  <!-- ── Down arrow zone ── -->
  <div class="arrow-zone arrow-down" id="arrowDown">
    <div class="arrow-stack arrow-stack--horizontal">
      <svg class="arrow-svg" viewBox="0 0 80 48" width="80" height="48">
        <path d="M4 8 L40 40 L76 8" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="arrow-label" id="arrowDownLabel">Terminal</span>
    </div>
  </div>

  <!-- ── Main content ── -->
  <div class="guide-container">
    <!-- Lab title -->
    <div class="lab-header" id="labHeader">
      <span class="lab-title" id="labTitle">Lab Guide</span>
    </div>

    <!-- Step card -->
    <div class="step-card" id="stepCard">
      <div class="step-badge-row">
        <span class="step-badge" id="stepBadge">Step 1 of 12</span>
      </div>
      <h2 class="step-title" id="stepTitle">Welcome</h2>
      <div class="step-instruction" id="stepInstruction"></div>
      <div class="step-tip" id="stepTip"></div>
      <button id="actionBtn" class="action-btn" style="display:none"></button>
      <div class="step-validation" id="stepValidation" style="display:none">
        <button id="validateBtn" class="validate-btn">Check Mission Progress</button>
        <div class="validation-results" id="validationResults"></div>
      </div>
    </div>

    <!-- Navigation -->
    <div class="step-nav">
      <button id="prevBtn" class="step-btn">&#8592; Previous</button>
      <button id="nextBtn" class="step-btn step-btn--primary">Next &#8594;</button>
    </div>
  </div>

  <script nonce="${nonce}" src="${mediaUri('guide.js')}"></script>
</body>
</html>`;
    }
}
exports.GuidePanel = GuidePanel;
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}
//# sourceMappingURL=guidePanel.js.map