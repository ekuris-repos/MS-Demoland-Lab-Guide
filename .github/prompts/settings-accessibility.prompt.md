---
status: complete
implemented: v0.6.2
date: 2025-06-14
---

# Settings Button + Accessibility — Agent Prompt

## Task

Add a settings gear button to the browser panel nav bar and implement reduced-motion accessibility support using VS Code's built-in settings infrastructure.

## Repo

`C:\Users\erikkuris\Git Directories\MS-Demoland-Lab-Guide`

## Overview

The browser panel's nav bar (visible in slides mode) currently has: Home, Prev, counter, Next, Skip Steps checkbox, Notes button. We need to add a gear (⚙) button that opens VS Code settings filtered to this extension. We also need to add new configuration properties for user-facing behavior and respect VS Code's `workbench.reduceMotion` setting for accessibility.

## Files to modify

### 1. `package.json` — Add new configuration properties

Add these to `contributes.configuration.properties`:

```json
"labGuide.autoActions": {
  "type": "boolean",
  "default": true,
  "description": "Automatically execute step actions (open files, terminal, chat) when advancing slides"
},
"labGuide.showTips": {
  "type": "boolean",
  "default": true,
  "description": "Show tip callouts in the guide panel"
},
"labGuide.enforceStepCompletion": {
  "type": "boolean",
  "default": true,
  "description": "Require sub-step completion before advancing to the next slide"
},
"labGuide.showNotes": {
  "type": "boolean",
  "default": true,
  "description": "Show speaker notes below each slide by default"
},
"labGuide.followVSCodeMotion": {
  "type": "boolean",
  "default": true,
  "description": "Respect VS Code's Reduce Motion setting to disable animations (edge glows, arrows, opening animation)"
},
"labGuide.followVSCodeAccessibility": {
  "type": "boolean",
  "default": true,
  "description": "Respect VS Code's accessibility settings for screen readers and high contrast themes"
}
```

Also register a new command:

```json
{
  "command": "labGuide.openSettings",
  "title": "Lab Guide: Open Settings"
}
```

### 2. `src/extension.ts` — Register the settings command

Add the command registration alongside the existing commands:

```ts
vscode.commands.registerCommand('labGuide.openSettings', () => {
  log.info('Command: openSettings');
  vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms-demoland.lab-guide');
})
```

### 3. `src/browserPanel.ts` — Add gear button to nav bar

In the `showSlides()` method's HTML template:

**CSS:** Add styles for the settings button:

```css
.settings-btn { padding: 4px 8px; font-size: 15px; }
```

**HTML:** Remove the Notes button entirely. Add a gear button as the last item in the nav bar:

```html
<button class="settings-btn" id="settingsBtn" title="Lab Guide Settings">&#9881;</button>
```

Remove the `.notes-btn` CSS class and styles.

**JS:**

- Remove the `notesBtn` variable, click handler, and keyboard handler for `N`.
- Add settings button click handler:

```js
var settingsBtn = document.getElementById('settingsBtn');
settingsBtn.addEventListener('click', function() {
  vscode.postMessage({ type: 'openSettings' });
});
```

- Read the `showNotes` setting: The extension should read `labGuide.showNotes` and pass it to the webview when creating the slides HTML. If `showNotes` is true, post a `toggleNotes` message to the iframe on initial load to show notes. The `N` hotkey remains as a runtime toggle:

```js
// Notes: apply initial setting, keep N as runtime toggle
var notesOn = INITIAL_SHOW_NOTES; // injected by extension as true/false
if (notesOn) {
  // On iframe load, send toggleNotes to show notes by default
  iframe.addEventListener('load', function() {
    iframe.contentWindow.postMessage({ type: 'toggleNotes' }, '*');
  });
}

document.addEventListener('keydown', function(e) {
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) {
    notesOn = !notesOn;
    iframe.contentWindow.postMessage({ type: 'toggleNotes' }, '*');
  }
  // ... other key handlers
});
```

In `showSlides()`, read the setting and inject it:

```ts
const showNotes = vscode.workspace.getConfiguration('labGuide').get<boolean>('showNotes', true);
// In the JS template: var INITIAL_SHOW_NOTES = ${showNotes};
```

**In the `ensurePanel()` message handler** (or the existing `messageHandler` flow), handle the `openSettings` message:

```ts
if (msg.type === 'openSettings') {
  vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms-demoland.lab-guide');
  return;
}
```

### 4. `src/labController.ts` — Respect `autoActions` setting

In the `executeAction()` method, check the setting before running:

```ts
private async executeAction(cmd: string): Promise<void> {
  const autoActions = vscode.workspace.getConfiguration('labGuide').get<boolean>('autoActions', true);
  if (!autoActions) {
    this.log.info(`[executeAction] Auto-actions disabled, skipping: ${cmd}`);
    return;
  }
  // ... rest of existing logic
}
```

In `showCurrentStep()`, check `showTips` before including the tip in the message to the guide panel:

```ts
const showTips = vscode.workspace.getConfiguration('labGuide').get<boolean>('showTips', true);
// When building the step data to send, omit tip if showTips is false
```

### 5. `media/guide.css` — Reduced motion support

Add at the END of `guide.css`. Use **both** the OS-level media query AND a `data-reduce-motion` attribute on the body (injected by JS when the setting is active):

```css
@media (prefers-reduced-motion: reduce), [data-reduce-motion] {
  /* Applies when OS reduces motion OR extension setting is active */
}

/* Attribute-based selector for when extension JS injects it */
body[data-reduce-motion] .edge-glow--active,
body[data-reduce-motion] .arrow--active svg,
body[data-reduce-motion] .step-nav-btn--glow,
body[data-reduce-motion] .opening .edge-glow,
body[data-reduce-motion] .opening .spinner {
  animation: none !important;
}

body[data-reduce-motion] .edge-glow--active {
  opacity: 0.7;
}

body[data-reduce-motion] .guide-container,
body[data-reduce-motion] .step-card,
body[data-reduce-motion] .copy-btn {
  transition: none !important;
}

/* Also honor OS-level setting via media query */
@media (prefers-reduced-motion: reduce) {
  .edge-glow--active {
    animation: none !important;
    opacity: 0.7;
  }

  .arrow--active svg {
    animation: none !important;
  }

  .step-nav-btn--glow {
    animation: none !important;
  }

  .opening .edge-glow,
  .opening .spinner {
    animation: none !important;
    display: none;
  }

  .guide-container {
    transition: none !important;
  }

  .step-card {
    transition: none !important;
  }

  .copy-btn {
    transition: none !important;
  }
}
```

### 5b. `media/guide.css` — High contrast / accessibility support

Add high contrast styles that activate via `data-high-contrast` attribute:

```css
body[data-high-contrast] .edge-glow--active {
  opacity: 1;
  filter: contrast(1.5);
}

body[data-high-contrast] .step-card {
  border: 2px solid var(--vscode-contrastBorder, #fff);
}

body[data-high-contrast] .step-nav-btn {
  border: 2px solid var(--vscode-contrastBorder, #fff);
}

body[data-high-contrast] .badge {
  border: 1px solid var(--vscode-contrastBorder, #fff);
}
```

### 6. `media/guide.js` — Apply settings-driven attributes

The extension should read both settings and pass them to the webview via the `setState` message (or a new `setSettings` message). The webview JS applies `data-reduce-motion` and `data-high-contrast` attributes to `document.body`:

```js
// On receiving settings from extension
window.addEventListener('message', function(e) {
  if (e.data.type === 'setSettings') {
    if (e.data.reduceMotion) {
      document.body.setAttribute('data-reduce-motion', '');
    } else {
      document.body.removeAttribute('data-reduce-motion');
    }
    if (e.data.highContrast) {
      document.body.setAttribute('data-high-contrast', '');
    } else {
      document.body.removeAttribute('data-high-contrast');
    }
  }
});
```

Also check `prefers-reduced-motion` as a fallback:

```js
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.body.setAttribute('data-reduce-motion', '');
}
```

In the opening animation logic, check for the attribute and skip the animation:

```js
if (document.body.hasAttribute('data-reduce-motion')) {
  document.body.classList.remove('opening');
  // Show content immediately
}
```

### 6b. `src/guidePanel.ts` — Send settings to webview

After creating or revealing the guide panel, read the settings and post them:

```ts
private sendSettings(): void {
  const config = vscode.workspace.getConfiguration('labGuide');
  const reduceMotion = config.get<boolean>('followVSCodeMotion', true);
  const followA11y = config.get<boolean>('followVSCodeAccessibility', true);

  // Check VS Code's actual reduced motion state
  const vsReduceMotion = reduceMotion && vscode.env.uiKind !== undefined; 
  // Note: VS Code doesn't expose reduceMotion directly via API, so we rely 
  // on the webview's CSS media query as the primary mechanism. The setting 
  // acts as an opt-out: if followVSCodeMotion is false, we tell the webview 
  // to ignore reduced motion.

  const isHighContrast = followA11y && (
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast ||
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
  );

  this.panel?.webview.postMessage({
    type: 'setSettings',
    reduceMotion: reduceMotion, // Let webview CSS media query handle the actual detection
    highContrast: isHighContrast
  });
}
```

Call `sendSettings()` after `show()` and when configuration changes:

```ts
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('labGuide')) {
    this.sendSettings();
  }
});

vscode.window.onDidChangeActiveColorTheme(() => {
  this.sendSettings();
});
```

### 7. `src/browserPanel.ts` — Reduced motion in nav bar (float hint) and settings passthrough

In the `showSlides()` HTML template, add a reduced-motion media query for the float hint animation:

```css
@media (prefers-reduced-motion: reduce) {
  .float-hint {
    animation: none !important;
    opacity: 1;
  }
}
```

Read the `followVSCodeMotion` setting and pass it to the webview JS as a variable. If `followVSCodeMotion` is `false`, the float hint should always animate regardless of OS setting:

```ts
const followMotion = vscode.workspace.getConfiguration('labGuide').get<boolean>('followVSCodeMotion', true);
// In JS template: var FOLLOW_MOTION = ${followMotion};
```

If `!FOLLOW_MOTION`, override the float hint to always use the animation.

Also respect the `enforceStepCompletion` setting when generating the HTML. Read the setting in the `showSlides()` method. The existing "Skip Steps" checkbox in the nav bar should be **removed** — it's replaced by the `enforceStepCompletion` setting. Instead, the extension reads the setting and passes it to the webview:

```ts
const enforce = vscode.workspace.getConfiguration('labGuide').get<boolean>('enforceStepCompletion', true);
// In the JS template: var ENFORCE_STEPS = ${enforce};
```

In the webview JS, replace the `skipSteps.checked` check with `!ENFORCE_STEPS`:

```js
// Old: if (hasExtraSteps && !skipSteps.checked) { ... block ... }
// New: if (hasExtraSteps && ENFORCE_STEPS) { ... block ... }
```

Remove the Skip Steps checkbox HTML and CSS from the template.

## Nav bar layout (final state)

```
[🏠 Home]    [← Prev] [3 / 28] [Next →]    [⚙]
```

Notes behavior: `labGuide.showNotes` setting (default true) controls initial state. `N` hotkey remains as a runtime toggle. No button in the nav bar.

Step enforcement: `labGuide.enforceStepCompletion` setting (default true) replaces the old "Skip Steps" checkbox. No checkbox in the nav bar.

## What NOT to do

- Do NOT add a custom reduced-motion setting — use `followVSCodeMotion` to opt in/out of respecting VS Code/OS motion preferences
- Do NOT add a custom accessibility setting — use `followVSCodeAccessibility` to opt in/out of respecting VS Code theme/accessibility
- Do NOT modify the guide panel HTML structure (only CSS and JS)
- Do NOT create new files — all changes go into existing files
- Do NOT change the guide panel layout or color scheme
- Do NOT add settings that aren't immediately useful — keep it to autoActions, showTips, enforceStepCompletion, showNotes, followVSCodeMotion, followVSCodeAccessibility

## Build & release

Follow the standard extension versioning procedure. This is a new feature (MINOR bump).

1. Bump `version` in `package.json` (MINOR increment from the current version).
2. Run `npm run package` — builds TypeScript and outputs VSIX to `releases/`.
3. Tag the commit with `v{version}`.
4. `git push --follow-tags` (code + tag in one operation).

## Testing

1. Open the Lab Guide profile, start a course
2. Click the gear button (⚙) in the nav bar — should open VS Code settings filtered to Lab Guide
3. Verify all six settings default to `true`
4. Toggle `autoActions` off — advancing slides should no longer auto-open chat/terminal/files
5. Toggle `showTips` off — tips should disappear from guide panel
6. Toggle `enforceStepCompletion` off — reopen a course, should be able to advance past slides with remaining sub-steps (no "Extra steps available!" float)
7. Toggle `showNotes` off — reopen a course, speaker notes should be hidden by default
8. Press `N` — notes should toggle on (runtime override still works)
9. With `followVSCodeMotion` on + OS/VS Code "Reduce Motion" enabled — edge glows should be static, arrows should not bounce, opening animation should be skipped, float hint should not animate
10. Toggle `followVSCodeMotion` off — animations should play even with OS Reduce Motion enabled
11. With `followVSCodeAccessibility` on + VS Code High Contrast theme — guide panel should show contrast borders, higher opacity glows
12. Toggle `followVSCodeAccessibility` off — high contrast overrides should be removed even in HC theme
13. Verify the Notes pencil button (✎) and Skip Steps checkbox are fully removed from the nav bar
