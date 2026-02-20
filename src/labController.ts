import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { GuidePanel } from './guidePanel';
import { BrowserPanel } from './browserPanel';

export interface LabStep {
  title: string;
  instruction: string;
  tip?: string;
  focus?: 'slides' | 'chat' | 'terminal' | 'editor' | 'guide';
  action?: string | string[];
}

export interface Lab {
  title: string;
  steps: LabStep[];
}

export class LabController {
  private guidePanel: GuidePanel | undefined;
  private browserPanel: BrowserPanel;
  private lab: Lab | undefined;
  private currentStep = 0;
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private context: vscode.ExtensionContext,
    private log: vscode.LogOutputChannel
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(this.statusBarItem);
    this.browserPanel = new BrowserPanel(context, log);
    this.browserPanel.onMessage(msg => this.onBrowserMessage(msg));
    this.log.info('LabController: BrowserPanel created with message handler');
  }

  // ── Open catalog in our browser panel ──────────────────────────
  async openCatalog(url: string) {
    this.log.info(`openCatalog → ${url}`);
    await this.browserPanel.showCatalog(url);
  }

  // ── Start lab via URI handler ──────────────────────────────────
  async startLabFromUri(server: string, coursePath: string) {
    server = server.replace(/\/+$/, '');
    coursePath = coursePath.replace(/^\/+|\/+$/g, '');

    const labUrl = `${server}/${coursePath}/lab.json`;
    this.log.info(`Fetching lab → ${labUrl}`);

    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Loading lab…' },
      async () => {
        this.log.info(`[startLabFromUri] Fetching JSON from ${labUrl}`);
        const labJson = await this.fetchJson(labUrl);
        if (!labJson) {
          this.log.error(`[startLabFromUri] FAILED to fetch lab from ${labUrl}`);
          vscode.window.showErrorMessage(`Could not load lab from ${labUrl}`);
          return;
        }

        this.lab = labJson as Lab;
        this.currentStep = 0;
        this.log.info(`[startLabFromUri] Lab loaded: "${this.lab.title}" — ${this.lab.steps.length} steps`);

        // Navigate the browser panel to the course slides (left column)
        const courseUrl = `${server}/${coursePath}/`;
        this.log.info(`[startLabFromUri] Navigating browser panel → ${courseUrl}`);
        this.browserPanel.showSlides(courseUrl);

        // Open guide panel in column 2 (center)
        this.log.info('[startLabFromUri] Creating/revealing guide panel in Column 2');
        if (!this.guidePanel) {
          this.log.info('[startLabFromUri] Creating new GuidePanel');
          this.guidePanel = new GuidePanel(this.context, msg => this.onWebviewMessage(msg));
        } else {
          this.log.info('[startLabFromUri] Reusing existing GuidePanel');
        }
        this.guidePanel.show();
        this.log.info('[startLabFromUri] GuidePanel.show() called');

        this.guidePanel.postMessage({ type: 'setTitle', title: this.lab.title });
        this.log.info(`[startLabFromUri] Sent setTitle: "${this.lab.title}"`);

        this.statusBarItem.show();
        this.showCurrentStep();
        this.log.info('[startLabFromUri] Lab fully initialized ✓');
      }
    );
  }

  // ── Start lab interactively (command palette) ──────────────────
  async startLab() {
    const catalogUrl = vscode.workspace.getConfiguration('labGuide').get<string>('catalogUrl');
    const defaultUrl = catalogUrl?.replace(/\/+$/, '') || 'https://ekuris-repos.github.io/MS-Demoland';

    const server = await vscode.window.showInputBox({
      title: 'Course Server URL',
      prompt: 'Base URL of the course site',
      value: defaultUrl,
      validateInput: (v) => {
        try { new URL(v); return null; }
        catch { return 'Enter a valid URL'; }
      }
    });

    if (!server) { return; }
    this.log.info(`startLab → opening catalog at ${server}`);
    this.openCatalog(server.replace(/\/+$/, '') + '/');
  }

  nextStep() {
    if (!this.lab || this.currentStep >= this.lab.steps.length - 1) { return; }
    this.currentStep++;
    this.showCurrentStep();
  }

  prevStep() {
    if (!this.lab || this.currentStep <= 0) { return; }
    this.currentStep--;
    this.showCurrentStep();
  }

  reset() {
    this.currentStep = 0;
    if (this.lab) { this.showCurrentStep(); }
  }

  refreshBrowser() {
    return this.browserPanel.refresh();
  }

  dispose() {
    this.guidePanel?.dispose();
    this.browserPanel.dispose();
    this.statusBarItem.dispose();
  }

  // ── Fetch JSON from a URL ─────────────────────────────────────
  private fetchJson(url: string): Promise<unknown | null> {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  // ── Quick probe to check if a URL is reachable ────────────────
  private probeUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 3000 }, (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  private showCurrentStep() {
    if (!this.lab || !this.guidePanel) { return; }

    const step = this.lab.steps[this.currentStep];
    this.statusBarItem.text = `$(book) Lab: ${this.currentStep + 1}/${this.lab.steps.length} — ${step.title}`;

    this.guidePanel.postMessage({
      type: 'setState',
      step: { ...step, index: this.currentStep, total: this.lab.steps.length }
    });

    // Execute step action(s)
    if (step.action) {
      const actions = Array.isArray(step.action) ? step.action : [step.action];
      for (const cmd of actions) {
        this.executeAction(cmd);
      }
    }
  }

  /** Run a VS Code command only if its target isn't already visible. */
  private async executeAction(cmd: string) {
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);

    // Guard: skip if the target is already open
    switch (cmd) {
      case 'workbench.action.chat.open': {
        const hasChat = tabs.some(t =>
          t.label.toLowerCase().includes('copilot') ||
          t.label.toLowerCase().includes('chat')
        );
        if (hasChat) {
          this.log.info(`[action] Skipped (chat already open): ${cmd}`);
          return;
        }
        break;
      }
      case 'workbench.action.files.newUntitledFile': {
        const hasUntitled = tabs.some(t => t.label.startsWith('Untitled'));
        if (hasUntitled) {
          this.log.info(`[action] Skipped (untitled file exists): ${cmd}`);
          return;
        }
        break;
      }
      case 'workbench.action.terminal.toggleTerminal':
      case 'workbench.action.terminal.focus': {
        if (vscode.window.terminals.length > 0) {
          // Just focus the existing terminal instead of toggling
          this.log.info(`[action] Terminal exists, focusing instead of toggle`);
          cmd = 'workbench.action.terminal.focus';
        }
        break;
      }
      case 'workbench.action.openSettings': {
        const hasSettings = tabs.some(t => t.label === 'Settings');
        if (hasSettings) {
          this.log.info(`[action] Skipped (settings already open): ${cmd}`);
          return;
        }
        break;
      }
    }

    this.log.info(`[action] Executing: ${cmd}`);
    try {
      await vscode.commands.executeCommand(cmd);
      this.log.info(`[action] \u2713 ${cmd}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`[action] \u2717 ${cmd}: ${msg}`);
    }
  }

  private onWebviewMessage(msg: { type: string }) {
    switch (msg.type) {
      case 'nextStep': this.nextStep(); break;
      case 'prevStep': this.prevStep(); break;
      case 'ready': this.showCurrentStep(); break;
    }
  }

  private onBrowserMessage(msg: { type: string; server?: string; course?: string }) {
    this.log.info(`[LabController] onBrowserMessage: type=${msg.type}`);
    if (msg.type === 'labGuide.startCourse' && msg.server && msg.course) {
      this.log.info(`[LabController] Course selected → server=${msg.server}, course=${msg.course}`);
      this.startLabFromUri(msg.server, msg.course);
    } else {
      this.log.warn(`[LabController] Unhandled browser message: ${JSON.stringify(msg)}`);
    }
  }
}
