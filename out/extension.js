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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const labController_1 = require("./labController");
const cp = __importStar(require("child_process"));
const PROFILE_NAME = 'Lab Guide';
let controller;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });
/** True when running inside a named VS Code profile (not Default). */
function isInNamedProfile(context) {
    // Named profiles store globalStorage under .../profiles/<hash>/globalStorage/
    // The default profile uses .../User/globalStorage/ (no "profiles" segment).
    return context.globalStorageUri.path.includes('/profiles/');
}
/** Launch a new VS Code window in the Lab Guide profile and return. */
function redirectToProfile() {
    log.info(`Not in a named profile — launching new window with --profile "${PROFILE_NAME}"`);
    // Determine the correct CLI binary (code vs code-insiders)
    const isInsiders = vscode.env.appName.toLowerCase().includes('insider');
    const cli = isInsiders ? 'code-insiders' : 'code';
    cp.spawn(cli, ['--profile', PROFILE_NAME], {
        detached: true,
        stdio: 'ignore',
        shell: true,
    }).unref();
    vscode.window.showInformationMessage(`Lab Guide runs in its own VS Code profile to protect your workspace. ` +
        `A new window is opening with the "${PROFILE_NAME}" profile.`);
}
function activate(context) {
    log.info('Lab Guide extension activating…');
    context.subscriptions.push(log);
    // ── Profile gate ──────────────────────────────────────────────
    if (!isInNamedProfile(context)) {
        // Register a minimal URI handler so vscode:// links still work
        // from the default profile — they just redirect to the Lab Guide profile.
        context.subscriptions.push(vscode.window.registerUriHandler({
            handleUri(_uri) {
                log.info('URI received in default profile — redirecting to Lab Guide profile');
                redirectToProfile();
            }
        }));
        redirectToProfile();
        log.info('Redirected to Lab Guide profile — skipping activation in default profile.');
        return;
    }
    log.info('Running inside a named profile ✓');
    controller = new labController_1.LabController(context, log);
    log.info('LabController created');
    // ── Commands ──────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('labGuide.startLab', () => {
        log.info('Command: startLab');
        return controller.startLab();
    }), vscode.commands.registerCommand('labGuide.nextStep', () => {
        log.info('Command: nextStep');
        return controller.nextStep();
    }), vscode.commands.registerCommand('labGuide.prevStep', () => {
        log.info('Command: prevStep');
        return controller.prevStep();
    }), vscode.commands.registerCommand('labGuide.reset', () => {
        log.info('Command: reset');
        return controller.reset();
    }), vscode.commands.registerCommand('labGuide.refreshBrowser', () => {
        log.info('Command: refreshBrowser');
        return controller.refreshBrowser();
    }));
    log.info('Commands registered');
    // ── Auto-open catalog on startup ──────────────────────────────
    const catalogUrl = vscode.workspace.getConfiguration('labGuide').get('catalogUrl');
    log.info(`labGuide.catalogUrl = "${catalogUrl ?? '(not set)'}"`);
    if (catalogUrl) {
        log.info('Cleaning up previous workspace state');
        // Close all editor tabs
        vscode.commands.executeCommand('workbench.action.closeAllEditors').then(async () => {
            // Close sidebar (Extensions pane, Explorer, etc.)
            await vscode.commands.executeCommand('workbench.action.closeSidebar');
            // Close panel area (Terminal, Output, Problems, etc.)
            await vscode.commands.executeCommand('workbench.action.closePanel');
            log.info(`Opening catalog → ${catalogUrl}`);
            controller.openCatalog(catalogUrl);
        });
    }
    else {
        log.warn('No catalogUrl configured — skipping auto-open');
    }
    // ── URI handler ───────────────────────────────────────────────
    context.subscriptions.push(vscode.window.registerUriHandler({
        handleUri(uri) {
            log.info(`URI handler called: ${uri.toString()}`);
            if (uri.path !== '/start') {
                log.warn(`Ignoring URI — path "${uri.path}" is not /start`);
                return;
            }
            const params = new URLSearchParams(uri.query);
            const server = params.get('server');
            const course = params.get('course');
            log.info(`URI params — server="${server}", course="${course}"`);
            if (!server) {
                vscode.window.showErrorMessage('Lab Guide: missing "server" query parameter in URI.');
                return;
            }
            if (!course) {
                log.info('No course specified — opening catalog');
                controller.openCatalog(server + '/');
                return;
            }
            log.info(`Starting lab: server="${server}", course="${course}"`);
            controller.startLabFromUri(server, course);
        }
    }));
    log.info('URI handler registered');
    log.info('Lab Guide extension activated ✓');
}
function deactivate() {
    log.info('Lab Guide extension deactivating…');
    controller?.dispose();
}
//# sourceMappingURL=extension.js.map