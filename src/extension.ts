import * as vscode from 'vscode';
import { LabController } from './labController';

const PROFILE_URL = 'https://ekuris-repos.github.io/MS-Demoland/lab-guide.code-profile';

let controller: LabController | undefined;
const log = vscode.window.createOutputChannel('Lab Guide', { log: true });

/** Prompt the user to import the Lab Guide profile. */
function promptProfileImport() {
  const importUri = vscode.Uri.parse(
    `${vscode.env.uriScheme}://app/import-profile?url=${encodeURIComponent(PROFILE_URL)}`
  );

  vscode.window.showInformationMessage(
    'Lab Guide requires its own VS Code profile to keep your settings safe. Import the Lab Guide profile to get started.',
    'Import Profile'
  ).then(choice => {
    if (choice === 'Import Profile') {
      vscode.env.openExternal(importUri);
    }
  });
}

export async function activate(context: vscode.ExtensionContext) {
  log.info('Lab Guide extension activating…');
  context.subscriptions.push(log);

  // ── Profile gate ──────────────────────────────────────────────
  const profileActive = vscode.workspace.getConfiguration('labGuide')
    .get<boolean>('profileActive', false);

  if (!profileActive) {
    log.info('labGuide.profileActive is false — not in Lab Guide profile');

    // Register a minimal URI handler so vscode:// links still prompt for import
    context.subscriptions.push(
      vscode.window.registerUriHandler({
        handleUri(_uri: vscode.Uri) {
          log.info('URI received outside Lab Guide profile — prompting profile import');
          promptProfileImport();
        }
      })
    );

    promptProfileImport();
    return;
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
