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
const child_process_1 = require("child_process");
const https_1 = require("https");
const fs_1 = require("fs");
const path_1 = require("path");
const labController_1 = require("./labController");
const PROFILE_NAME = 'Lab Guide';
const EXTENSION_ID = 'ms-demoland.lab-guide';
const PROFILE_URL = 'https://ekuris-repos.github.io/MS-Demoland/lab-guide-profile.json';
let controller;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });
// ── Profile provisioning helpers ────────────────────────────────
/** Generate an 8-char hex hash (same style VS Code uses for profile dirs). */
function profileHash(name) {
    let h = 0;
    for (const ch of name) {
        h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
/** Resolve the VS Code user-data root (handles Code vs Code - Insiders). */
function userDataRoot() {
    const appData = process.env.APPDATA;
    const appName = vscode.env.appName.includes('Insiders')
        ? 'Code - Insiders' : 'Code';
    return (0, path_1.join)(appData, appName, 'User');
}
/** Download the hosted profile JSON. */
function fetchProfile(url) {
    return new Promise((resolve, reject) => {
        (0, https_1.get)(url, res => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}
/**
 * Download the profile template. Provisioning happens in openInProfile()
 * after the CLI install, so settings.json isn't overwritten.
 */
async function fetchProfileTemplate() {
    log.info(`Downloading profile from ${PROFILE_URL}`);
    try {
        return await fetchProfile(PROFILE_URL);
    }
    catch (e) {
        log.error(`Failed to download profile: ${e.message}`);
        return null;
    }
}
/** Write settings.json into the profile directory (idempotent). */
function writeProfileSettings(template) {
    const root = userDataRoot();
    const storageFile = (0, path_1.join)(root, 'globalStorage', 'storage.json');
    if (!(0, fs_1.existsSync)(storageFile)) {
        return;
    }
    const storage = JSON.parse((0, fs_1.readFileSync)(storageFile, 'utf-8'));
    const profiles = storage.userDataProfiles ?? [];
    const entry = profiles.find(p => p.name === PROFILE_NAME);
    if (!entry) {
        log.warn('Profile not found in storage.json — cannot write settings');
        return;
    }
    const profileDir = (0, path_1.join)(root, 'profiles', entry.location);
    (0, fs_1.mkdirSync)(profileDir, { recursive: true });
    if (template.settings) {
        const settings = JSON.parse(template.settings);
        (0, fs_1.writeFileSync)((0, path_1.join)(profileDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
        log.info(`Wrote settings.json → ${profileDir}`);
    }
}
/** Resolve the VS Code CLI binary (bin/code or bin/code-insiders). */
function vscodeCli() {
    const exeDir = require('path').dirname(process.execPath);
    const isInsiders = vscode.env.appName.includes('Insiders');
    const cmd = isInsiders ? 'code-insiders' : 'code';
    // Windows: bin/code-insiders.cmd, macOS/Linux: bin/code-insiders
    const ext = process.platform === 'win32' ? '.cmd' : '';
    return (0, path_1.join)(exeDir, 'bin', cmd + ext);
}
/** Run a shell command and return the exit code as a promise. */
function run(cmd) {
    return new Promise(resolve => {
        log.info(`Running: ${cmd}`);
        const child = (0, child_process_1.spawn)(cmd, { shell: true, stdio: 'ignore' });
        child.on('close', code => resolve(code ?? 1));
        child.on('error', () => resolve(1));
    });
}
/**
 * 4-phase profile setup:
 *   1. Create the blank profile
 *   2. Install the extension into it
 *   3. Write profile settings (profileActive, etc.)
 *   4. Open a new window with the fully configured profile
 */
async function openInProfile(template) {
    const cli = vscodeCli();
    // Phase 1: Create the profile (headless — just ensures it exists in storage.json)
    log.info('Phase 1: Creating profile…');
    await run(`"${cli}" --profile "${PROFILE_NAME}" --list-extensions`);
    // Phase 2: Install the extension into the profile
    log.info('Phase 2: Installing extension…');
    const installCode = await run(`"${cli}" --profile "${PROFILE_NAME}" --install-extension ${EXTENSION_ID}`);
    if (installCode !== 0) {
        log.warn(`Extension install exited with code ${installCode} (may not be published yet)`);
    }
    // Phase 3: Write settings.json so profileActive=true is picked up on launch
    log.info('Phase 3: Writing profile settings…');
    writeProfileSettings(template);
    // Phase 4: Open the window
    log.info('Phase 4: Opening profile window…');
    const child = (0, child_process_1.spawn)(`"${cli}" --profile "${PROFILE_NAME}"`, {
        shell: true, detached: true, stdio: 'ignore'
    });
    child.unref();
}
async function activate(context) {
    log.info('Lab Guide extension activating…');
    log.info(`Current profile: "${vscode.env.appName}" | globalStorageUri: ${context.globalStorageUri.fsPath}`);
    log.info(`profileActive setting value: ${vscode.workspace.getConfiguration('labGuide').get('profileActive')}`);
    context.subscriptions.push(log);
    // ── Profile gate ──────────────────────────────────────────────
    const profileActive = vscode.workspace.getConfiguration('labGuide')
        .get('profileActive', false);
    if (!profileActive) {
        log.info('labGuide.profileActive is false — not in Lab Guide profile');
        vscode.window.showInformationMessage('Lab Guide will create a dedicated VS Code profile and open it in a new window to keep your settings safe.', 'Create Profile').then(async (choice) => {
            if (choice !== 'Create Profile') {
                return;
            }
            const template = await fetchProfileTemplate();
            if (template) {
                openInProfile(template);
            }
            else {
                vscode.window.showErrorMessage('Failed to download the Lab Guide profile. Check the Lab Guide output channel for details.');
            }
        });
        return;
    }
    log.info('Running inside Lab Guide profile ✓');
    // ── Welcome toast (first run in correct profile) ──────────────
    const welcomed = context.globalState.get('welcomed');
    if (!welcomed) {
        await context.globalState.update('welcomed', true);
        vscode.window.showInformationMessage('Welcome to the GitHub Copilot Training Lab! Choose a course from the catalog to begin an interactive session.', 'Dismiss');
    }
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
    }), vscode.commands.registerCommand('labGuide.openSettings', () => {
        log.info('Command: openSettings');
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms-demoland.lab-guide');
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