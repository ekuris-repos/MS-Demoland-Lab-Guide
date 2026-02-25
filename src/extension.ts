import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { LabController } from './labController';

const PROFILE_NAME = 'Lab Guide';
const EXTENSION_ID = 'ms-demoland.lab-guide';

let controller: LabController | undefined;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });

/** Open a new window under the Lab Guide profile, installing the extension into it. */
function createProfileAndOpen() {
  const cliPath = vscode.env.appHost === 'desktop'
    ? process.execPath          // the Electron binary
    : undefined;
  if (!cliPath) { return; }

  const args = [
    '--profile', PROFILE_NAME,
    '--install-extension', EXTENSION_ID
  ];
  log.info(`Launching: ${cliPath} ${args.join(' ')}`);
  execFile(cliPath, args, (err) => {
    if (err) { log.error(`Profile creation failed: ${err.message}`); }
  });
}

export async function activate(context: vscode.ExtensionContext) {
  log.info('Lab Guide extension activating…');
  context.subscriptions.push(log);

  // ── Profile gate ──────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('labGuide');
  let profileActive = config.get<boolean>('profileActive', false);

  if (!profileActive) {
    // First activation in a fresh profile? Auto-enable and continue.
    const firstRun = !context.globalState.get<boolean>('prompted');
    if (firstRun) {
      await context.globalState.update('prompted', true);
    }
    // If this is NOT the first run (user already dismissed), they're in the
    // wrong profile — show the toast.  If it IS the first run AND the
    // extension was installed via --install-extension into a named profile,
    // auto-enable so the profile is ready to go.
    if (firstRun) {
      log.info('First activation — auto-enabling profileActive');
      await config.update('profileActive', true, vscode.ConfigurationTarget.Global);
      profileActive = true;
    } else {
      log.info('labGuide.profileActive is false — not in Lab Guide profile');
      vscode.window.showInformationMessage(
        'Lab Guide requires its own VS Code profile to keep your settings safe.',
        'Get Profile'
      ).then(choice => {
        if (choice === 'Get Profile') {
          createProfileAndOpen();
        }
      });
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
