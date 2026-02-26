import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { GuidePanel } from './guidePanel';
import { BrowserPanel } from './browserPanel';

export interface LabStep {
  title: string;
  instruction: string;
  tip?: string;
  focus?: string | string[];
  action?: string | string[];
  actionLabel?: string;
  onLeave?: string | string[];
}

/** A slide entry contains one or more sub-steps shown when that slide is active. */
export interface SlideEntry {
  steps: LabStep[];
  onLeave?: string | string[];
}

/** New lab.json format: keyed by slide number. */
export interface Lab {
  title: string;
  /** Optional single repo URL to clone (backward compat). */
  repo?: string;
  /** Optional array of repo URLs to clone as the lab workspace. */
  repos?: string[];
  slides: Record<string, SlideEntry>;
}

export class LabController {
  private guidePanel: GuidePanel | undefined;
  private browserPanel: BrowserPanel;
  private lab: Lab | undefined;
  private currentSlide = 1;
  private currentSubStep = 0;
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
        this.currentSlide = 1;
        this.currentSubStep = 0;
        this.log.info(`[startLabFromUri] Lab loaded: "${this.lab.title}" — ${Object.keys(this.lab.slides).length} slide entries`);

        // ── GitHub session (best-effort — slides load regardless) ─────
        const ghSession = await vscode.authentication.getSession('github', [], { silent: true });
        if (ghSession) {
          this.log.info(`[metrics] course="${coursePath}" user="${ghSession.account.label}" userId="${ghSession.account.id}"`);
        } else {
          this.log.warn('[startLabFromUri] No GitHub session — course progress will not be tracked');
        }

        // Clean slate: close all workspace folders so the learner starts fresh
        await this.closeAllWorkspaceFolders();

        // Collect all repos to clone (support both single and multi)
        const repos: string[] = [];
        if (this.lab.repos) {
          repos.push(...this.lab.repos);
        }
        if (this.lab.repo && !repos.includes(this.lab.repo)) {
          repos.push(this.lab.repo);
        }

        // Clone all repos
        for (const repoUrl of repos) {
          await this.cloneLabRepo(repoUrl);
        }

        // Navigate the browser panel to the course slides (left column)
        const courseUrl = `${server}/${coursePath}/`;
        this.log.info(`[startLabFromUri] Navigating browser panel → ${courseUrl}`);
        this.browserPanel.showSlides(courseUrl);

        // Guide panel only loads when we have a tracked session so the
        // extension can navigate slides and record progress.
        if (ghSession) {
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
        } else {
          this.log.info('[startLabFromUri] Skipping guide panel — no tracked session');
        }
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

  /** Move to next sub-step within the current slide. */
  async nextStep() {
    const entry = this.currentEntry();
    if (!entry) { return; }
    if (this.currentSubStep < entry.steps.length - 1) {
      await this.runStepOnLeave();
      this.currentSubStep++;
      this.showCurrentStep();
    }
  }

  /** Move to previous sub-step within the current slide. */
  async prevStep() {
    if (this.currentSubStep > 0) {
      await this.runStepOnLeave();
      this.currentSubStep--;
      this.showCurrentStep();
    }
  }

  /** Run the current step's onLeave commands (if any). */
  private async runStepOnLeave() {
    const entry = this.currentEntry();
    if (!entry) { return; }
    const step = entry.steps[this.currentSubStep];
    if (!step?.onLeave) { return; }
    const commands = Array.isArray(step.onLeave) ? step.onLeave : [step.onLeave];
    for (const cmd of commands) {
      this.log.info(`[onLeave:step] Slide ${this.currentSlide} step ${this.currentSubStep} → ${cmd}`);
      try {
        await vscode.commands.executeCommand(cmd);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`[onLeave:step] ✗ ${cmd}: ${msg}`);
      }
    }
  }

  reset() {
    this.currentSubStep = 0;
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

  // ── Workspace folder management ───────────────────────────────

  /** Remove all workspace folders so the learner starts with a clean slate. */
  private async closeAllWorkspaceFolders() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.log.info(`[init] Closing ${folders.length} workspace folder(s)`);
      vscode.workspace.updateWorkspaceFolders(0, folders.length);
    }
    // Also close all editor tabs, sidebar, and panel
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    this.log.info('[init] Workspace cleaned ✓');
  }

  /** Clone a git repo into a temp directory and open it as the workspace folder. */
  private async cloneLabRepo(repoUrl: string): Promise<void> {
    // Derive a folder name from the repo URL
    const repoName = repoUrl.replace(/\.git$/, '').split('/').pop() || 'lab-repo';
    const targetDir = path.join(os.tmpdir(), 'lab-guide', repoName);
    const targetUri = vscode.Uri.file(targetDir);

    // Check if already cloned from a previous run
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(targetDir, '.git')));
      this.log.info(`[cloneRepo] Already cloned at ${targetDir} — reusing`);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: targetUri, name: repoName });
      return;
    } catch {
      // Not cloned yet — continue
    }

    this.log.info(`[cloneRepo] Cloning ${repoUrl} → ${targetDir}`);

    return new Promise<void>((resolve) => {
      cp.exec(
        `git clone --depth 1 "${repoUrl}" "${targetDir}"`,
        { timeout: 60_000 },
        (err, _stdout, stderr) => {
          if (err) {
            this.log.error(`[cloneRepo] ✗ ${err.message}`);
            this.log.error(`[cloneRepo] stderr: ${stderr}`);
            vscode.window.showErrorMessage(`Failed to clone lab repo: ${err.message}`);
            resolve();
            return;
          }
          this.log.info(`[cloneRepo] ✓ Cloned successfully`);
          vscode.workspace.updateWorkspaceFolders(0, 0, { uri: targetUri, name: repoName });
          resolve();
        }
      );
    });
  }

  /** Clean up all lab state and panels when returning to the catalog. */
  async returnToCatalog() {
    this.log.info('[LabController] Returning to catalog — cleaning up');
    this.lab = undefined;
    this.currentSlide = 1;
    this.currentSubStep = 0;
    this.statusBarItem.hide();

    // Close the guide panel
    this.guidePanel?.dispose();
    this.guidePanel = undefined;

    // Remove workspace folders only (don't close editors — the browser panel stays open)
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.log.info(`[returnToCatalog] Removing ${folders.length} workspace folder(s)`);
      vscode.workspace.updateWorkspaceFolders(0, folders.length);
    }

    this.log.info('[LabController] Cleanup complete ✓');
  }

  // ── Fetch JSON from a URL ─────────────────────────────────────
  private fetchJson(url: string): Promise<unknown | null> {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
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

  /** Get the current slide entry (if any). */
  private currentEntry(): SlideEntry | undefined {
    return this.lab?.slides[String(this.currentSlide)];
  }

  /** Called when the browser panel reports a slide change. */
  private async onSlideChanged(slide: number) {
    if (!this.lab || !this.guidePanel) { return; }

    // Run step-level onLeave for the current step before leaving the slide
    await this.runStepOnLeave();

    // Run slide-level onLeave cleanup for the previous slide
    const prevEntry = this.lab.slides[String(this.currentSlide)];
    if (prevEntry?.onLeave) {
      const commands = Array.isArray(prevEntry.onLeave) ? prevEntry.onLeave : [prevEntry.onLeave];
      for (const cmd of commands) {
        this.log.info(`[onLeave:slide] Slide ${this.currentSlide} → ${cmd}`);
        try {
          await vscode.commands.executeCommand(cmd);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error(`[onLeave:slide] ✗ ${cmd}: ${msg}`);
        }
      }
    }

    this.log.info(`[LabController] Slide changed → ${slide}`);
    this.currentSlide = slide;
    this.currentSubStep = 0;
    this.showCurrentStep();
  }

  /** Tell the browser panel whether there are remaining sub-steps on this slide. */
  private updateExtraStepsFlag() {
    const entry = this.currentEntry();
    const hasExtra = !!entry && entry.steps.length > 1 && this.currentSubStep < entry.steps.length - 1;
    this.browserPanel.postMessage({ type: 'setExtraSteps', hasExtra });
  }

  private async showCurrentStep() {
    if (!this.lab || !this.guidePanel) { return; }

    const entry = this.currentEntry();

    if (!entry || entry.steps.length === 0) {
      // No lab content for this slide — point to the slides and let them drive
      this.statusBarItem.text = `$(book) Slide ${this.currentSlide}`;
      this.guidePanel.postMessage({
        type: 'setState',
        step: {
          title: 'Follow Along',
          instruction: 'Review the content on the current slide. When you\'re ready, advance to the next slide.',
          focus: 'left',
          focusLabel: { left: 'Advance the slides' },
          index: 0,
          total: 1,
          slide: this.currentSlide
        }
      });
      this.updateExtraStepsFlag();
      return;
    }

    const step = entry.steps[this.currentSubStep];
    const total = entry.steps.length;
    this.statusBarItem.text = `$(book) Slide ${this.currentSlide} — Step ${this.currentSubStep + 1}/${total} — ${step.title}`;

    const showTips = vscode.workspace.getConfiguration('labGuide').get<boolean>('showTips', true);

    this.guidePanel.postMessage({
      type: 'setState',
      step: {
        ...step,
        tip: showTips ? step.tip : undefined,
        index: this.currentSubStep,
        total,
        slide: this.currentSlide
      }
    });

    this.updateExtraStepsFlag();

    // Execute step action(s), then re-focus the guide panel
    if (step.action) {
      const actions = Array.isArray(step.action) ? step.action : [step.action];
      for (const cmd of actions) {
        await this.executeAction(cmd);
      }
      setTimeout(() => this.guidePanel?.reveal(), 300);
    }
  }

  /** Run a VS Code command only if its target isn't already visible. */
  private async executeAction(cmd: string) {
    const autoActions = vscode.workspace.getConfiguration('labGuide').get<boolean>('autoActions', true);
    if (!autoActions) {
      this.log.info(`[executeAction] Auto-actions disabled, skipping: ${cmd}`);
      return;
    }

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
        const untitledTab = tabs.find(t => t.label.startsWith('Untitled'));
        if (untitledTab) {
          // Focus the existing untitled file instead of creating another
          this.log.info(`[action] Focusing existing untitled file`);
          const input = untitledTab.input;
          if (input && typeof (input as { uri?: unknown }).uri !== 'undefined') {
            const uri = (input as { uri: vscode.Uri }).uri;
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Two,
              preserveFocus: true
            });
          }
          return;
        }
        // Open as a background tab in the guide column (Column 2)
        this.log.info(`[action] Opening untitled file in Column 2 (background)`);
        try {
          const doc = await vscode.workspace.openTextDocument({ content: '' });
          await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true
          });
          this.log.info(`[action] ✓ Untitled file opened in Column 2`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error(`[action] ✗ newUntitledFile: ${msg}`);
        }
        return;
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

  private onWebviewMessage(msg: { type: string; text?: string }) {
    switch (msg.type) {
      case 'nextStep': this.nextStep(); break;
      case 'prevStep': this.prevStep(); break;
      case 'ready': this.showCurrentStep(); break;
      case 'replayAction': this.replayCurrentAction(); break;
      case 'copyToClipboard':
        if (msg.text) { vscode.env.clipboard.writeText(msg.text); }
        break;
    }
  }

  /** Re-execute the current step's action (e.g. re-open a closed file). */
  private async replayCurrentAction() {
    const entry = this.currentEntry();
    if (!entry) { return; }
    const step = entry.steps[this.currentSubStep];
    if (!step?.action) { return; }
    const actions = Array.isArray(step.action) ? step.action : [step.action];
    for (const cmd of actions) {
      await this.executeAction(cmd);
    }
    setTimeout(() => this.guidePanel?.reveal(), 300);
  }

  private async onBrowserMessage(msg: { type: string; server?: string; course?: string; slide?: number }) {
    this.log.info(`[LabController] onBrowserMessage: type=${msg.type}`);
    if (msg.type === 'labGuide.startCourse' && msg.server && msg.course) {
      this.log.info(`[LabController] Course selected → server=${msg.server}, course=${msg.course}`);
      this.startLabFromUri(msg.server, msg.course);
    } else if (msg.type === 'slideChanged' && typeof msg.slide === 'number') {
      this.onSlideChanged(msg.slide);
    } else if (msg.type === 'extraStepsBlocked') {
      this.log.info('[LabController] Nav-next blocked — extra steps remain, sending glow');
      this.guidePanel?.postMessage({ type: 'glowNext' });
    } else if (msg.type === 'iframeNavigated') {
      await this.returnToCatalog();
    } else {
      this.log.warn(`[LabController] Unhandled browser message: ${JSON.stringify(msg)}`);
    }
  }
}
