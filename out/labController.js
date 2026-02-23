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
exports.LabController = void 0;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const guidePanel_1 = require("./guidePanel");
const browserPanel_1 = require("./browserPanel");
class LabController {
    constructor(context, log) {
        this.context = context;
        this.log = log;
        this.currentSlide = 1;
        this.currentSubStep = 0;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        context.subscriptions.push(this.statusBarItem);
        this.browserPanel = new browserPanel_1.BrowserPanel(context, log);
        this.browserPanel.onMessage(msg => this.onBrowserMessage(msg));
        this.log.info('LabController: BrowserPanel created with message handler');
    }
    // ── Open catalog in our browser panel ──────────────────────────
    async openCatalog(url) {
        this.log.info(`openCatalog → ${url}`);
        await this.browserPanel.showCatalog(url);
    }
    // ── Start lab via URI handler ──────────────────────────────────
    async startLabFromUri(server, coursePath) {
        server = server.replace(/\/+$/, '');
        coursePath = coursePath.replace(/^\/+|\/+$/g, '');
        const labUrl = `${server}/${coursePath}/lab.json`;
        this.log.info(`Fetching lab → ${labUrl}`);
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading lab…' }, async () => {
            this.log.info(`[startLabFromUri] Fetching JSON from ${labUrl}`);
            const labJson = await this.fetchJson(labUrl);
            if (!labJson) {
                this.log.error(`[startLabFromUri] FAILED to fetch lab from ${labUrl}`);
                vscode.window.showErrorMessage(`Could not load lab from ${labUrl}`);
                return;
            }
            this.lab = labJson;
            this.currentSlide = 1;
            this.currentSubStep = 0;
            this.log.info(`[startLabFromUri] Lab loaded: "${this.lab.title}" — ${Object.keys(this.lab.slides).length} slide entries`);
            // Navigate the browser panel to the course slides (left column)
            const courseUrl = `${server}/${coursePath}/`;
            this.log.info(`[startLabFromUri] Navigating browser panel → ${courseUrl}`);
            this.browserPanel.showSlides(courseUrl);
            // Open guide panel in column 2 (center)
            this.log.info('[startLabFromUri] Creating/revealing guide panel in Column 2');
            if (!this.guidePanel) {
                this.log.info('[startLabFromUri] Creating new GuidePanel');
                this.guidePanel = new guidePanel_1.GuidePanel(this.context, msg => this.onWebviewMessage(msg));
            }
            else {
                this.log.info('[startLabFromUri] Reusing existing GuidePanel');
            }
            this.guidePanel.show();
            this.log.info('[startLabFromUri] GuidePanel.show() called');
            this.guidePanel.postMessage({ type: 'setTitle', title: this.lab.title });
            this.log.info(`[startLabFromUri] Sent setTitle: "${this.lab.title}"`);
            this.statusBarItem.show();
            this.showCurrentStep();
            this.log.info('[startLabFromUri] Lab fully initialized ✓');
        });
    }
    // ── Start lab interactively (command palette) ──────────────────
    async startLab() {
        const catalogUrl = vscode.workspace.getConfiguration('labGuide').get('catalogUrl');
        const defaultUrl = catalogUrl?.replace(/\/+$/, '') || 'https://ekuris-repos.github.io/MS-Demoland';
        const server = await vscode.window.showInputBox({
            title: 'Course Server URL',
            prompt: 'Base URL of the course site',
            value: defaultUrl,
            validateInput: (v) => {
                try {
                    new URL(v);
                    return null;
                }
                catch {
                    return 'Enter a valid URL';
                }
            }
        });
        if (!server) {
            return;
        }
        this.log.info(`startLab → opening catalog at ${server}`);
        this.openCatalog(server.replace(/\/+$/, '') + '/');
    }
    /** Move to next sub-step within the current slide. */
    nextStep() {
        const entry = this.currentEntry();
        if (!entry) {
            return;
        }
        if (this.currentSubStep < entry.steps.length - 1) {
            this.currentSubStep++;
            this.showCurrentStep();
        }
    }
    /** Move to previous sub-step within the current slide. */
    prevStep() {
        if (this.currentSubStep > 0) {
            this.currentSubStep--;
            this.showCurrentStep();
        }
    }
    reset() {
        this.currentSubStep = 0;
        if (this.lab) {
            this.showCurrentStep();
        }
    }
    refreshBrowser() {
        return this.browserPanel.refresh();
    }
    dispose() {
        this.guidePanel?.dispose();
        this.browserPanel.dispose();
        this.statusBarItem.dispose();
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
        // Close sidebar (Extensions pane, Explorer, etc.)
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
        // Close panel area (Terminal, Output, Problems, etc.)
        await vscode.commands.executeCommand('workbench.action.closePanel');
        this.log.info('[LabController] Cleanup complete ✓');
    }
    // ── Fetch JSON from a URL ─────────────────────────────────────
    fetchJson(url) {
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
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }
    // ── Quick probe to check if a URL is reachable ────────────────
    probeUrl(url) {
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
    /** Get the current slide entry (if any). */
    currentEntry() {
        return this.lab?.slides[String(this.currentSlide)];
    }
    /** Called when the browser panel reports a slide change. */
    async onSlideChanged(slide) {
        if (!this.lab || !this.guidePanel) {
            return;
        }
        // Run onLeave cleanup for the previous slide
        const prevEntry = this.lab.slides[String(this.currentSlide)];
        if (prevEntry?.onLeave) {
            const commands = Array.isArray(prevEntry.onLeave) ? prevEntry.onLeave : [prevEntry.onLeave];
            for (const cmd of commands) {
                this.log.info(`[onLeave] Slide ${this.currentSlide} → ${cmd}`);
                try {
                    await vscode.commands.executeCommand(cmd);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.log.error(`[onLeave] ✗ ${cmd}: ${msg}`);
                }
            }
        }
        this.log.info(`[LabController] Slide changed → ${slide}`);
        this.currentSlide = slide;
        this.currentSubStep = 0;
        this.showCurrentStep();
    }
    async showCurrentStep() {
        if (!this.lab || !this.guidePanel) {
            return;
        }
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
            return;
        }
        const step = entry.steps[this.currentSubStep];
        const total = entry.steps.length;
        this.statusBarItem.text = `$(book) Slide ${this.currentSlide} — Step ${this.currentSubStep + 1}/${total} — ${step.title}`;
        this.guidePanel.postMessage({
            type: 'setState',
            step: {
                ...step,
                index: this.currentSubStep,
                total,
                slide: this.currentSlide
            }
        });
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
    async executeAction(cmd) {
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        // Guard: skip if the target is already open
        switch (cmd) {
            case 'workbench.action.chat.open': {
                const hasChat = tabs.some(t => t.label.toLowerCase().includes('copilot') ||
                    t.label.toLowerCase().includes('chat'));
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
                    if (input && typeof input.uri !== 'undefined') {
                        const uri = input.uri;
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
                }
                catch (err) {
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.error(`[action] \u2717 ${cmd}: ${msg}`);
        }
    }
    onWebviewMessage(msg) {
        switch (msg.type) {
            case 'nextStep':
                this.nextStep();
                break;
            case 'prevStep':
                this.prevStep();
                break;
            case 'ready':
                this.showCurrentStep();
                break;
            case 'replayAction':
                this.replayCurrentAction();
                break;
            case 'copyToClipboard':
                if (msg.text) {
                    vscode.env.clipboard.writeText(msg.text);
                }
                break;
        }
    }
    /** Re-execute the current step's action (e.g. re-open a closed file). */
    async replayCurrentAction() {
        const entry = this.currentEntry();
        if (!entry) {
            return;
        }
        const step = entry.steps[this.currentSubStep];
        if (!step?.action) {
            return;
        }
        const actions = Array.isArray(step.action) ? step.action : [step.action];
        for (const cmd of actions) {
            await this.executeAction(cmd);
        }
        setTimeout(() => this.guidePanel?.reveal(), 300);
    }
    onBrowserMessage(msg) {
        this.log.info(`[LabController] onBrowserMessage: type=${msg.type}`);
        if (msg.type === 'labGuide.startCourse' && msg.server && msg.course) {
            this.log.info(`[LabController] Course selected → server=${msg.server}, course=${msg.course}`);
            this.startLabFromUri(msg.server, msg.course);
        }
        else if (msg.type === 'slideChanged' && typeof msg.slide === 'number') {
            this.onSlideChanged(msg.slide);
        }
        else if (msg.type === 'iframeNavigated') {
            this.returnToCatalog();
        }
        else {
            this.log.warn(`[LabController] Unhandled browser message: ${JSON.stringify(msg)}`);
        }
    }
}
exports.LabController = LabController;
//# sourceMappingURL=labController.js.map