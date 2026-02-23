import * as vscode from 'vscode';
import { LabController } from './labController';
import * as cp from 'child_process';

const PROFILE_NAME = 'Lab Guide';

let controller: LabController | undefined;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });

/** True when running inside a named VS Code profile (not Default). */
function isInNamedProfile(context: vscode.ExtensionContext): boolean {
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

  vscode.window.showInformationMessage(
    `Lab Guide runs in its own VS Code profile to protect your workspace. ` +
    `A new window is opening with the "${PROFILE_NAME}" profile.`
  );
}

export function activate(context: vscode.ExtensionContext) {
  log.info('Lab Guide extension activating…');
  context.subscriptions.push(log);

  // ── Profile gate ──────────────────────────────────────────────
  if (!isInNamedProfile(context)) {
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
  log.info('Running inside a named profile ✓');

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
