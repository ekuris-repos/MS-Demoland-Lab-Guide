# Lab Guide Progress Tracking — Agent Prompt

## Task

Add persistent progress tracking to the Lab Guide VS Code extension. Progress should be stored in the Lab Guide profile's `settings.json` via `vscode.workspace.getConfiguration('labGuide')` with `ConfigurationTarget.Global`, so it persists across window closures, reboots, and extension updates.

## Repo

`C:\Users\erikkuris\Git Directories\MS-Demoland-Lab-Guide`

## Files to modify

### 1. `src/browserPanel.ts` — Add `navigateToSlide(n)` capability

The browser panel renders slides in an iframe with an external nav bar. Currently the extension can only react to slide changes (one-way: user clicks nav → extension gets `slideChanged`). We need two-way sync so the extension can drive the slides too.

**Add a public method:**

```ts
navigateToSlide(slide: number): void
```

This posts a message to the browser panel's webview telling it to navigate the iframe to the target slide. The webview JS in slides mode should:

- Call the iframe's slide navigation function (the slides use `goToSlide(n)` from `js/slides.js` in the MS Demoland repo — post a message into the iframe or call it via the iframe's `contentWindow`)
- Update the nav bar counter to reflect the new slide number
- The iframe's `hashchange` or slide-change event will fire back as normal

Since the iframe is sandboxed, the cleanest approach is to post a message to the webview, which then sets `iframe.src` to the slide URL with `#slide-N` appended (the slides.js hash navigation already supports this). The webview script should:

1. Receive a `navigateToSlide` message from the extension
2. Update `iframe.src` to `currentUrl#slide-{n}` (or update `iframe.contentWindow.location.hash`)
3. Update the counter display
4. NOT fire `slideChanged` back to the host (to avoid a loop) — use a flag like `programmaticNav = true` that gets cleared after the nav completes

**Wire it up in `LabController`:**

Add a public method on `LabController`:

```ts
private navigateToSlide(slide: number): void {
  this.browserPanel.navigateToSlide(slide);
}
```

This gets called from the resume flow (see below).

### 2. `package.json` — Register the configuration property

Add `labGuide.progress` to the `contributes.configuration.properties` section:

```json
"labGuide.progress": {
  "type": "object",
  "default": {},
  "description": "Per-course progress state (managed by extension, do not edit manually)"
}
```

Bump version (MINOR increment from the current version).

### 2. `src/labController.ts` — Core progress logic

**Progress data shape** (per course):

```ts
interface CourseProgress {
  user: string;           // GitHub username
  lastSlide: number;      // 1-indexed slide number
  lastSubStep: number;    // 0-indexed sub-step within slide
  started: string;        // ISO 8601 timestamp
  lastAccessed: string;   // ISO 8601 timestamp
  completed: boolean;     // true when user reaches the final slide's final sub-step
}
```

The full progress object is `Record<string, CourseProgress>` keyed by course path (e.g., `"Developer/Beginner/The-Copilot-Awakens"`).

**Add helper methods to `LabController`:**

- `private async saveProgress(coursePath: string): Promise<void>`
  - Reads current `labGuide.progress` from config
  - Merges/updates the entry for `coursePath` with current `currentSlide`, `currentSubStep`, `lastAccessed`, and `completed` flag
  - Writes back via `config.update('progress', progress, ConfigurationTarget.Global)`

- `private getProgress(coursePath: string): CourseProgress | undefined`
  - Reads `labGuide.progress` from config and returns the entry for `coursePath`

- `private isCompleted(): boolean`
  - Returns true if `currentSlide` is the last slide AND `currentSubStep` is the last sub-step of that slide

**Modify `startLabFromUri`:**

After the lab is loaded and the GitHub session is validated, check for existing progress:

```ts
const existing = this.getProgress(coursePath);
if (existing && !existing.completed) {
  const choice = await vscode.window.showInformationMessage(
    `You previously reached Slide ${existing.lastSlide} in "${this.lab.title}". Resume where you left off?`,
    'Resume', 'Start Over'
  );
  if (choice === 'Resume') {
    this.currentSlide = existing.lastSlide;
    this.currentSubStep = existing.lastSubStep;
  }
}
```

If no existing progress, or user chose "Start Over," initialize a new entry with `started: new Date().toISOString()`.

Store the current `coursePath` on the controller instance (e.g., `this.coursePath = coursePath`) so `saveProgress` can reference it later.

After the browser panel is opened with `showSlides(courseUrl)`, if resuming, call:

```ts
if (choice === 'Resume') {
  this.navigateToSlide(this.currentSlide);
}
```

This syncs both the slides (browser panel) and the guide panel to the saved position.

**Modify `showCurrentStep`:**

After rendering the step, call `saveProgress(this.coursePath)` to persist the current position. This fires on every slide change and every sub-step change, keeping progress always up to date.

**Modify `onSlideChanged(slide)`:**

This already calls `showCurrentStep()`, so progress saves automatically. No extra changes needed.

**Detect completion:**

In `showCurrentStep`, after updating the step, check `isCompleted()`. If true, set `completed: true` in the progress entry and show a toast:

```ts
if (this.isCompleted()) {
  vscode.window.showInformationMessage(`Congratulations! You completed "${this.lab.title}".`);
}
```

### 3. `src/extension.ts` — No changes needed

The configuration is registered in `package.json` and read/written in `labController.ts`. The extension activation flow doesn't need to change.

## What NOT to do

- Do NOT use `context.globalState` — it doesn't survive extension reinstalls and is less transparent than settings
- Do NOT send progress to any remote endpoint — this is local-only for now
- Do NOT add UI beyond the resume prompt and completion toast — keep it minimal
- Do NOT modify the guide panel webview or CSS
- Do NOT create new files — all changes go into existing files

## Build & release

Follow the standard extension versioning procedure. This is a new feature (MINOR bump).

1. Bump `version` in `package.json` (MINOR increment from the current version).
2. Run `npm run package` — builds TypeScript and outputs VSIX to `releases/`.
3. Tag the commit with `v{version}`.
4. `git push --follow-tags` (code + tag in one operation).

## Testing

After installing the updated VSIX in the Lab Guide profile:

1. Start a course, advance a few slides, close the window
2. Reopen, start the same course — should see "Resume where you left off?" prompt
3. Click Resume — should jump to the saved slide/sub-step
4. Click Start Over — should begin at slide 1
5. Complete a course — should see congratulations toast
6. Start the same course again — should NOT offer resume (completed = true), just starts fresh
7. Check Lab Guide profile `settings.json` — should see `labGuide.progress` with the course entries
