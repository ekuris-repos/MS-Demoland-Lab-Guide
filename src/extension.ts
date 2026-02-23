import * as vscode from 'vscode';
import { LabController } from './labController';

const PROFILE_NAME = 'Lab Guide';
const SENTINEL_FILE = 'lab-guide-profile.marker';

let controller: LabController | undefined;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });

/**
 * Check for a sentinel file in globalStorage that proves we're in the
 * Lab Guide profile.  Any other profile (default, "Python", "Work", etc.)
 * won't have this file and will be redirected.
 */
async function isLabGuideProfile(context: vscode.ExtensionContext): Promise<boolean> {
  const marker = vscode.Uri.joinPath(context.globalStorageUri, SENTINEL_FILE);
  try {
    await vscode.workspace.fs.stat(marker);
    return true;
  } catch {
    return false;
  }
}

/** Write the sentinel so future activations in this profile are recognised. */
async function stampProfile(context: vscode.ExtensionContext): Promise<void> {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  const marker = vscode.Uri.joinPath(context.globalStorageUri, SENTINEL_FILE);
  await vscode.workspace.fs.writeFile(marker, Buffer.from('lab-guide-profile'));
  log.info('Sentinel written — this profile is now recognised as Lab Guide');
}

/** Open VS Code in the Lab Guide profile. */
function redirectToProfile() {
  log.info(`Not in Lab Guide profile — switching to --profile "${PROFILE_NAME}"`);

  const isInsiders = vscode.env.appName.toLowerCase().includes('insider');
  const binName = isInsiders ? 'code-insiders' : 'code';

  // Use a hidden terminal — most reliable cross-platform way to invoke the CLI.
  const term = vscode.window.createTerminal({
    name: 'Lab Guide Profile',
    hideFromUser: true,
  });
  const cmd = `${binName} --profile "${PROFILE_NAME}"`;
  log.info(`Sending to terminal: ${cmd}`);
  term.sendText(cmd);
  // Dispose after a short delay so the command has time to launch
  setTimeout(() => term.dispose(), 5000);

  vscode.window.showInformationMessage(
    `Lab Guide needs its own profile to keep your settings safe. Switching to the "${PROFILE_NAME}" profile…`
  );
}

export async function activate(context: vscode.ExtensionContext) {
  log.info('Lab Guide extension activating…');
  context.subscriptions.push(log);

  // ── Profile gate ──────────────────────────────────────────────
  const inLabProfile = await isLabGuideProfile(context);

  if (!inLabProfile) {
    // Check if this is the FIRST activation inside the newly-created
    // Lab Guide profile (no sentinel yet, but user just got redirected).
    // Heuristic: if the profile is named and has no sentinel, ask the user
    // whether to stamp it.  Or: if this is a fresh profile (no previous
    // extensions/settings), auto-stamp.
    //
    // Simplest safe approach: if we're in a named profile (not default),
    // stamp it — the user was just redirected here.  If we're in the
    // default profile, redirect.
    const isNamed = context.globalStorageUri.path.includes('/profiles/');
    if (isNamed) {
      log.info('First activation in a named profile — stamping as Lab Guide');
      await stampProfile(context);
      // fall through to normal activation
    } else {
      // Register a minimal URI handler so vscode:// links still work
      // from the default profile — they just redirect to the Lab Guide profile.
      context.subscriptions.push(
        vscode.window.registerUriHandler({
          handleUri(_uri: vscode.Uri) {
            log.info('URI received in default profile — redirecting to Lab Guide profile');
            redirectToProfile();
          }
        })
      );

      redirectToProfile();
      log.info('Redirected to Lab Guide profile — skipping activation in default profile.');
      return;
    }
  }
  log.info('Running inside Lab Guide profile ✓');

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
    });
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
