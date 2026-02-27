import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { get as httpsGet } from 'https';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { LabController } from './labController';

const PROFILE_NAME = 'Lab Guide';
const EXTENSION_ID = 'ms-demoland.lab-guide';
const PROFILE_URL = 'https://ekuris-repos.github.io/MS-Demoland/lab-guide-profile.json';

let controller: LabController | undefined;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });

// ── Profile provisioning helpers ────────────────────────────────

/** Resolve the VS Code user-data root (handles Code vs Code - Insiders). */
function userDataRoot(): string {
  const appData = process.env.APPDATA!;
  const appName = vscode.env.appName.includes('Insiders')
    ? 'Code - Insiders' : 'Code';
  return join(appData, appName, 'User');
}

interface ProfileTemplate {
  name: string;
  settings?: string;   // stringified JSON
  extensions?: string; // stringified JSON
}

/** Download the hosted profile JSON. */
function fetchProfile(url: string): Promise<ProfileTemplate> {
  return new Promise((resolve, reject) => {
    httpsGet(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const maxSize = 1024 * 1024; // 1 MB
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > maxSize) {
          reject(new Error('Profile response too large'));
          res.destroy();
        }
      });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Download the profile template. Provisioning happens in openInProfile()
 * after the CLI install, so settings.json isn't overwritten.
 */
async function fetchProfileTemplate(): Promise<ProfileTemplate | null> {
  log.info(`Downloading profile from ${PROFILE_URL}`);
  try {
    return await fetchProfile(PROFILE_URL);
  } catch (e: any) {
    log.error(`Failed to download profile: ${e.message}`);
    return null;
  }
}

/** Check whether the Lab Guide profile already exists in VS Code's storage. */
function profileExists(): boolean {
  const storageFile = join(userDataRoot(), 'globalStorage', 'storage.json');
  if (!existsSync(storageFile)) { return false; }
  try {
    const storage = JSON.parse(readFileSync(storageFile, 'utf-8'));
    const profiles: Array<{ name: string }> = storage.userDataProfiles ?? [];
    return profiles.some(p => p.name === PROFILE_NAME);
  } catch {
    return false;
  }
}

/** Open a new VS Code window in the existing Lab Guide profile. */
function switchToProfile() {
  const cli = vscodeCli();
  log.info('Switching to existing Lab Guide profile…');
  const child = spawn(`"${cli}" --profile "${PROFILE_NAME}"`, {
    shell: true, detached: true, stdio: 'ignore'
  });
  child.unref();
}

/**
 * Remove the Lab Guide profile from VS Code's storage and delete its
 * settings directory. Returns true if the profile was found and removed.
 */
function removeProfile(): boolean {
  const root = userDataRoot();
  const storageFile = join(root, 'globalStorage', 'storage.json');
  if (!existsSync(storageFile)) { return false; }

  try {
    const storage = JSON.parse(readFileSync(storageFile, 'utf-8'));
    const profiles: Array<{ name: string; location: string }> =
      storage.userDataProfiles ?? [];
    const idx = profiles.findIndex(p => p.name === PROFILE_NAME);
    if (idx === -1) { return false; }

    const location = profiles[idx].location;
    profiles.splice(idx, 1);
    storage.userDataProfiles = profiles;
    writeFileSync(storageFile, JSON.stringify(storage, null, 2), 'utf-8');
    log.info(`Removed "${PROFILE_NAME}" entry from storage.json`);

    // Delete the profile's settings directory
    const profileDir = join(root, 'profiles', location);
    if (existsSync(profileDir)) {
      rmSync(profileDir, { recursive: true, force: true });
      log.info(`Deleted profile directory: ${profileDir}`);
    }
    return true;
  } catch (e: any) {
    log.error(`Failed to remove profile: ${e.message}`);
    return false;
  }
}

/** Write settings.json into the profile directory (idempotent). */
function writeProfileSettings(template: ProfileTemplate) {
  const root = userDataRoot();
  const storageFile = join(root, 'globalStorage', 'storage.json');
  if (!existsSync(storageFile)) { return; }

  const storage = JSON.parse(readFileSync(storageFile, 'utf-8'));
  const profiles: Array<{ name: string; location: string }> =
    storage.userDataProfiles ?? [];
  const entry = profiles.find(p => p.name === PROFILE_NAME);
  if (!entry) {
    log.warn('Profile not found in storage.json — cannot write settings');
    return;
  }

  const profileDir = join(root, 'profiles', entry.location);
  mkdirSync(profileDir, { recursive: true });

  if (template.settings) {
    const settings = JSON.parse(template.settings);
    writeFileSync(
      join(profileDir, 'settings.json'),
      JSON.stringify(settings, null, 2),
      'utf-8'
    );
    log.info(`Wrote settings.json → ${profileDir}`);
  }
}

/** Resolve the VS Code CLI binary (bin/code or bin/code-insiders). */
function vscodeCli(): string {
  const exeDir = require('path').dirname(process.execPath);
  const isInsiders = vscode.env.appName.includes('Insiders');
  const cmd = isInsiders ? 'code-insiders' : 'code';
  // Windows: bin/code-insiders.cmd, macOS/Linux: bin/code-insiders
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return join(exeDir, 'bin', cmd + ext);
}

/** Run a shell command and return the exit code as a promise. */
function run(cmd: string): Promise<number> {
  return new Promise(resolve => {
    log.info(`Running: ${cmd}`);
    const child = spawn(cmd, { shell: true, stdio: 'ignore' });
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
async function openInProfile(template: ProfileTemplate) {
  const cli = vscodeCli();

  // Phase 1: Create the profile (headless — just ensures it exists in storage.json)
  log.info('Phase 1: Creating profile…');
  await run(`"${cli}" --profile "${PROFILE_NAME}" --list-extensions`);

  // Phase 2: Install the extension into the profile
  log.info('Phase 2: Installing extension…');
  const installCode = await run(
    `"${cli}" --profile "${PROFILE_NAME}" --install-extension ${EXTENSION_ID}`
  );
  if (installCode !== 0) {
    log.warn(`Extension install exited with code ${installCode} (may not be published yet)`);
  }

  // Phase 3: Write settings.json so profileActive=true is picked up on launch
  log.info('Phase 3: Writing profile settings…');
  writeProfileSettings(template);

  // Phase 4: Open the window
  log.info('Phase 4: Opening profile window…');
  const child = spawn(`"${cli}" --profile "${PROFILE_NAME}"`, {
    shell: true, detached: true, stdio: 'ignore'
  });
  child.unref();
}

export async function activate(context: vscode.ExtensionContext) {
  log.info('Lab Guide extension activating…');
  log.info(`Current profile: "${vscode.env.appName}" | globalStorageUri: ${context.globalStorageUri.fsPath}`);
  log.info(`profileActive setting value: ${vscode.workspace.getConfiguration('labGuide').get('profileActive')}`);
  context.subscriptions.push(log);

  // ── Profile gate ──────────────────────────────────────────────
  const profileActive = vscode.workspace.getConfiguration('labGuide')
    .get<boolean>('profileActive', false);

  // ── Commands available outside the profile ────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('labGuide.runProfiler', async () => {
      log.info('Command: runProfiler');
      const template = await fetchProfileTemplate();
      if (template) {
        openInProfile(template);
      } else {
        vscode.window.showErrorMessage(
          'Failed to download the Lab Guide profile. Check the Lab Guide output channel for details.'
        );
      }
    }),
    vscode.commands.registerCommand('labGuide.removeProfile', () => {
      log.info('Command: removeProfile');
      if (removeProfile()) {
        vscode.window.showInformationMessage('Lab Guide profile removed.');
      } else {
        vscode.window.showWarningMessage('No Lab Guide profile found to remove.');
      }
    })
  );

  if (!profileActive) {
    log.info('labGuide.profileActive is false — not in Lab Guide profile');
    const exists = profileExists();

    // Status bar — subtle, non-intrusive reminder that Lab Guide is available
    const statusBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    statusBtn.text = '$(beaker) Lab Guide';
    statusBtn.tooltip = exists
      ? 'Switch to the Lab Guide profile'
      : 'Create the Lab Guide profile';
    statusBtn.command = exists ? 'labGuide.switchToProfile' : 'labGuide.runProfiler';
    statusBtn.show();
    context.subscriptions.push(statusBtn);

    context.subscriptions.push(
      vscode.commands.registerCommand('labGuide.switchToProfile', () => {
        log.info('Command: switchToProfile');
        switchToProfile();
      })
    );

    if (exists) {
      log.info('Lab Guide profile already exists — suppressing setup toast');
    } else {
      vscode.window.showInformationMessage(
        'Lab Guide will create a dedicated VS Code profile and open it in a new window to keep your settings safe.',
        'Create Profile'
      ).then(async choice => {
        if (choice !== 'Create Profile') { return; }
        vscode.commands.executeCommand('labGuide.runProfiler');
      });
    }
    return;
  }
  log.info('Running inside Lab Guide profile ✓');

  // ── Welcome toast (first run in correct profile) ──────────────
  const welcomed = context.globalState.get<boolean>('welcomed');
  if (!welcomed) {
    await context.globalState.update('welcomed', true);
    vscode.window.showInformationMessage(
      'Welcome to the GitHub Copilot Training Lab! Choose a course from the catalog to begin an interactive session.',
      'Dismiss'
    );
  }

  controller = new LabController(context, log);
  log.info('LabController created');

  // ── Commands ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('labGuide.startLab', () => {
      log.info('Command: startLab');
      return controller!.startLab();
    }),
    vscode.commands.registerCommand('labGuide.nextStep', () => {
      log.info('Command: nextStep');
      return controller!.nextStep();
    }),
    vscode.commands.registerCommand('labGuide.prevStep', () => {
      log.info('Command: prevStep');
      return controller!.prevStep();
    }),
    vscode.commands.registerCommand('labGuide.reset', () => {
      log.info('Command: reset');
      return controller!.reset();
    }),
    vscode.commands.registerCommand('labGuide.refreshBrowser', () => {
      log.info('Command: refreshBrowser');
      return controller!.refreshBrowser();
    }),
    vscode.commands.registerCommand('labGuide.openSettings', () => {
      log.info('Command: openSettings');
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms-demoland.lab-guide');
    })
  );
  log.info('Commands registered');

  // ── Auto-open catalog on startup ──────────────────────────────
  const catalogUrl = vscode.workspace.getConfiguration('labGuide').get<string>('catalogUrl');
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
      controller!.openCatalog(catalogUrl);
    }, (err: unknown) => log.error(`Workspace cleanup failed: ${err}`));
  } else {
    log.warn('No catalogUrl configured — skipping auto-open');
  }

  // ── URI handler ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
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
          vscode.window.showErrorMessage(
            'Lab Guide: missing "server" query parameter in URI.'
          );
          return;
        }

        // Validate server is HTTPS
        try {
          const parsed = new URL(server);
          if (parsed.protocol !== 'https:') {
            log.warn(`Rejected non-HTTPS server URL: ${server}`);
            vscode.window.showErrorMessage('Lab Guide: server URL must use HTTPS.');
            return;
          }
        } catch {
          log.warn(`Invalid server URL: ${server}`);
          vscode.window.showErrorMessage('Lab Guide: invalid server URL.');
          return;
        }

        if (!course) {
          log.info('No course specified — opening catalog');
          controller!.openCatalog(server + '/');
          return;
        }

        log.info(`Starting lab: server="${server}", course="${course}"`);
        controller!.startLabFromUri(server, course);
      }
    })
  );
  log.info('URI handler registered');
  log.info('Lab Guide extension activated ✓');
}

export function deactivate() {
  log.info('Lab Guide extension deactivating…');
  controller?.dispose();
}
// Demo change for screenshot capture
