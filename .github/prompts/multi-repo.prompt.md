# Multi-Repo Support — Agent Prompt

## Task

Extend the Lab Guide extension to support cloning multiple repositories when a course specifies them. Currently `lab.repo` accepts a single URL string. Add support for `lab.repos` as a string array alongside the existing `lab.repo` for backward compatibility.

## Repo

`C:\Users\erikkuris\Git Directories\MS-Demoland-Lab-Guide`

## Context

The extension already has a `cloneLabRepo(repoUrl: string)` method in `src/labController.ts` that:
- Derives a folder name from the repo URL
- Clones to `os.tmpdir()/lab-guide/<repo-name>/`
- Checks if already cloned (reuses from previous run)
- Adds the cloned folder to the VS Code workspace via `updateWorkspaceFolders`
- Uses `git clone --depth 1` with a 60-second timeout

The `Lab` interface currently has:
```ts
export interface Lab {
  title: string;
  repo?: string;
  slides: Record<string, SlideEntry>;
}
```

## Files to modify

### 1. `src/labController.ts` — Add `repos` field and multi-clone logic

**Update the `Lab` interface:**

```ts
export interface Lab {
  title: string;
  /** Optional single repo URL to clone (backward compat). */
  repo?: string;
  /** Optional array of repo URLs to clone as the lab workspace. */
  repos?: string[];
  slides: Record<string, SlideEntry>;
}
```

**Update `startLabFromUri`:**

Replace the existing single-repo clone block:

```ts
// Clone the lab repo if one is specified
if (this.lab.repo) {
  await this.cloneLabRepo(this.lab.repo);
}
```

With logic that merges both fields and clones all repos:

```ts
// Collect all repos to clone (support both single and multi)
const repos: string[] = [];
if (this.lab.repos) {
  repos.push(...this.lab.repos);
}
if (this.lab.repo && !repos.includes(this.lab.repo)) {
  repos.push(this.lab.repo);
}

// Clone all repos
for (const repoUrl of repos) {
  await this.cloneLabRepo(repoUrl);
}
```

This approach:
- Backward compatible: `lab.repo` (single string) still works exactly as before
- Additive: If both `repo` and `repos` are specified, all unique URLs are cloned
- Sequential: Clones one at a time to avoid hammering git
- Each repo gets its own workspace folder (the existing `updateWorkspaceFolders` call in `cloneLabRepo` already handles this)

**No changes needed to `cloneLabRepo` itself** — it already handles a single URL, adds the folder to the workspace, and reuses previously cloned repos. Calling it multiple times naturally adds multiple workspace folders.

### 2. No other files need changes

The `cloneLabRepo` method, workspace folder management, and cleanup logic all work correctly with multiple folders already. `closeAllWorkspaceFolders` removes ALL workspace folders (using `folders.length`), so cleanup on course switch is already correct.

## lab.json format (updated)

**Single repo (backward compat — unchanged):**
```json
{
  "title": "The Copilot Awakens",
  "repo": "https://github.com/example/lab-repo",
  "slides": { ... }
}
```

**Multiple repos (new):**
```json
{
  "title": "Multi-Agent Multi-Repo Roundup",
  "repos": [
    "https://github.com/example/frontend-repo",
    "https://github.com/example/backend-repo",
    "https://github.com/example/shared-config"
  ],
  "slides": { ... }
}
```

**Both (belt and suspenders — works but repos takes precedence):**
```json
{
  "title": "Some Course",
  "repo": "https://github.com/example/main-repo",
  "repos": [
    "https://github.com/example/main-repo",
    "https://github.com/example/extra-repo"
  ],
  "slides": { ... }
}
```

## What NOT to do

- Do NOT change the `cloneLabRepo` method signature or behavior — it already works for single repos
- Do NOT clone repos in parallel — sequential is safer and avoids git/network contention
- Do NOT remove the `repo` field — it must stay for backward compatibility
- Do NOT create new files — this is a single-file change to `labController.ts`
- Do NOT modify the browser panel, guide panel, or CSS
- Do NOT add a UI for selecting which repos to clone — always clone all specified repos

## Build & release

Follow the standard extension versioning procedure. This is a new feature (MINOR bump).

1. Bump `version` in `package.json` (MINOR increment from the current version).
2. Run `npm run package` — builds TypeScript and outputs VSIX to `releases/`.
3. Tag the commit with `v{version}`.
4. `git push --follow-tags` (code + tag in one operation).

## Testing

1. Create a test `lab.json` with `repos: ["url1", "url2"]` — both should be cloned and appear as workspace folders
2. Create a test `lab.json` with only `repo: "url1"` — should work exactly as before (backward compat)
3. Create a test `lab.json` with both `repo` and `repos` containing overlapping URLs — should deduplicate and not clone the same repo twice
4. Start a course with multiple repos, then click Home to return to catalog — all workspace folders should be cleaned up
5. Start the same multi-repo course again — should reuse previously cloned repos (no re-clone)
6. Check the Lab Guide output channel for clone logs — should see one `[cloneRepo]` entry per repo
