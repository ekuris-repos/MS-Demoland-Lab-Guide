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
const PROFILE_URL = 'https://ekuris-repos.github.io/MS-Demoland/lab-guide.code-profile';
let controller;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });
/** Prompt the user to switch to the Lab Guide profile. */
function promptProfileImport() {
    vscode.window.showInformationMessage('Lab Guide requires its own VS Code profile to keep your settings safe. Import the Lab Guide profile to get started.', 'Switch Profile').then(choice => {
        if (choice === 'Switch Profile') {
            vscode.commands.executeCommand('workbench.profiles.actions.importProfile', vscode.Uri.parse(PROFILE_URL));
        }
    });
}
async function activate(context) {
    log.info('Lab Guide extension activating…');
    context.subscriptions.push(log);
    // ── Profile gate ──────────────────────────────────────────────
    const profileActive = vscode.workspace.getConfiguration('labGuide')
        .get('profileActive', false);
    if (!profileActive) {
        log.info('labGuide.profileActive is false — not in Lab Guide profile');
        // Register a minimal URI handler so vscode:// links still prompt for import
        context.subscriptions.push(vscode.window.registerUriHandler({
            handleUri(_uri) {
                log.info('URI received outside Lab Guide profile — prompting profile import');
                promptProfileImport();
            }
        }));
        promptProfileImport();
        return;
    }
    log.info('Running inside Lab Guide profile ✓');
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
            // Close auxiliary bar (Copilot Chat secondary sidebar)
            await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
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