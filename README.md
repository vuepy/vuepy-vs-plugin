# Vuepy (VS Code / Cursor Extension)

Provides Vuepy-related syntax and language features for **Vue SFC (`.vue`) files**: Python highlighting and **Pylance forwarding** for `<script lang="py">`, Markdown highlighting inside `<PnMarkdown>` / `<markdown>` blocks, and run/debug entry points.

Extension identifiers: `name` = `vuepy`, `publisher` = `vuepy-org`, `displayName` = **Vuepy**.

---

## Features Overview

### Syntax Highlighting (`package.json` → `contributes.grammars`)

1. **`vue.injections.python`** (`syntaxes/vue-python.tmLanguage.json`)  
   Embeds the **Python** scope inside `<script lang="py">` within `source.vue` and `text.html.vue`, enabling stacked highlighting alongside Volar's Vue syntax.

2. **`vue.injections.pnmarkdown`** (`syntaxes/vue-pnmarkdown.tmLanguage.json`)  
   **Injects** Markdown-style highlighting (excluding comment regions) into the following root grammars:
   - `source.vue`
   - `text.html.vue`
   - `text.html.derivative` (used in certain environments / derived HTML views; more stable when combined with Volar etc.)

   **Supported tag names** (opening/closing tags must be paired; case as permitted by the regex):  
   `PnMarkdown`, `pn-markdown`, `Markdown`, `markdown`.

   **Key rules inside blocks**:
   - **ATX headings** `#`–`######`: leading indentation is allowed (to accommodate indented layouts inside templates).
   - **Fenced code blocks** `` ```lang ``: switches embedded syntax by language and aligns with editor language IDs in `package.json`'s `embeddedLanguages`, e.g.:
     - `python` / `py` → Python  
     - `json` / `jsonc` → JSON  
     - `javascript` / `js` → JavaScript  
     - `typescript` / `ts` → TypeScript  
     - `bash` / `sh` / `shell` / `zsh` → Shell  
     - `html` / `htm` / `vue` → HTML  
     - `css` / `scss` / `less` → CSS  
     - `yaml` / `yml` → YAML  
     - Other `` ``` `` language markers: fall back to a generic fenced block (see the fallback definition in the tmLanguage file).
   - Common Markdown highlights: **blockquotes** `>`, **unordered lists**, **inline code** `` `...` ``, **bold / italic / strikethrough**, etc.

### Language Service Forwarding (`extension.js`)

Inside **`<script lang="py">`** regions, the extension syncs the block's source code to a temporary `.py` file, then calls VS Code's built-in `vscode.execute*` commands to **map results from Pylance (Python extension) back to the current `.vue` file**.

| Capability | Behavior |
|------------|----------|
| **Go to Definition** | Inside script: delegates to Pylance and maps the returned position back to `.vue` or an external `.py`. Outside script (e.g. template): performs a simple source-text match (`def` / `async def`, top-level `name =`) within the script block and jumps to the matching line. |
| **Hover** | Only active inside the script block; hover content comes from Pylance. |
| **Find References** | Inside script: Pylance references + position mapping. Also performs a simple full-text match for the same identifier in the **template**, merging results (skipping the script region to avoid duplicates). |
| **Completion** | Inside script: forwards Pylance completions and maps `range` / `additionalTextEdits` from temporary-file coordinates back to `.vue`. |
| **Outline (Document Symbols)** | Writes the entire script block to a temporary file, retrieves Pylance's DocumentSymbol tree, and maps `range` / `selectionRange` back to `.vue` (handles `DocumentSymbol` tree structure only). |
| **Formatting** | **Format Document** / **Format Selection**: only replaces content **between** `<script lang="py">` and `</script>`; tags, template, and style sections are untouched. Formatting writes the raw block content (not wrapped in `setup()`) to a temporary `.py` file, then calls `vscode.executeFormatDocumentProvider`, avoiding semantic issues that would arise from wrapping the whole block in a function. |
| **Rename (F2)** | Only active inside the script block. The `prepareRename` phase checks whether the cursor is on a renameable identifier. `provideRenameEdits` forwards the request to Pylance (`vscode.executeDocumentRenameProvider`) and maps the returned `WorkspaceEdit`'s temporary-file coordinates back to the `.vue` file; edits from cross-file refactoring (e.g. other `.py` files) are preserved as-is. **Note**: because the temporary file is isolated, usages in templates are not within Pylance's rename scope — only the script interior is affected. |
| **Code Refactor Actions** | Inside the script block, maps the current selection to the temporary file and calls `vscode.executeCodeActionProvider`. Maps `WorkspaceEdit` coordinates from Pylance's returned `CodeAction` (Extract Function, Inline Variable, Quick Fix, etc.) back to `.vue`. Supported `CodeActionKind` values: `Refactor`, `RefactorExtract`, `RefactorInline`, `RefactorRewrite`, `QuickFix`. |

**Temporary files and caching**:

- Written by default to **`.vue-py-cache/`** under the workspace folder, with filenames in the format `original-vue-basename-<8-char-hash>.py`. If there is no workspace, falls back to a `vue-py-scripts/` directory under the extension's global storage (or a system temp directory — see code for exact strategy).
- Temporary files used for navigation / hover / completion / outline ("wrapped in `setup`") use **different cache keys** from those used for formatting only, preventing cross-contamination.
- It is recommended to add `.vue-py-cache/` to your repository's **`.gitignore`**.

**Volar virtual documents**: If the active editor URI is not a direct `file://…/*.vue` URL, the extension attempts to parse the `.vue` path from the URI string and resolve the real file within the workspace, so that Go to Definition and similar features still work from the template side.

### Running and Debugging Vuepy Files (`package.json` + `extension.js`)

- **Run command**: `vuepy.runVueFile`, titled **▶ Run Vuepy file**.
- **Debug command**: `vuepy.debugVueFile`, titled **Debug Vuepy file**. Uses the Python extension's debug adapter (`type: python`), launched with `module: vuepy` and `args: ['run', <current file>]`. You can set breakpoints in compiled Python or dependency libraries (set breakpoints in the corresponding `.py` file, or adjust `justMyCode`).
- **Menus**: When **`vuepy.hasScriptPy`** is true, both items appear in the editor title bar **Run** dropdown (`when`: `resourceExtname == .vue && vuepy.hasScriptPy`).
- **Logic**: When the current file is `.vue` and contains `<script lang="py">`, the following is executed in the terminal:  
  `<python> -m vuepy run <absolute path to current file>`  
  The interpreter is resolved in order: **Python extension** `getExecutionDetails` → `python.defaultInterpreterPath` → `python`. The extension does **not** `cd` to the workspace directory, nor does it set a `cwd` for newly created terminals; relative path behavior is determined by the shell's current directory.
- **Terminal reuse**: Reuses a terminal named **`vuepy`** if one exists; otherwise creates a new one. Debug launches still use the `cwd` from the `launch` config (workspace root or file's directory) to aid Python relative import resolution.

**Context `vuepy.hasScriptPy`**: On activation and whenever the active editor or document changes, the extension scans the active `.vue` file for the presence of `<script lang="py">` and dynamically updates this context value, controlling whether the Run button is shown.

### Activation and Dependencies

- **`activationEvents`**: `onLanguage:vue` (activated when a Vue language file is opened).
- **`extensionDependencies`**: `ms-python.python`, `Vue.volar` (installing this extension will pull in or prompt you to install Python and Vue - Official).

---

## Installation and Development

### Required Extensions (auto-installed or prompted)

| Extension ID | Description |
|--------------|-------------|
| `Vue.volar` | Vue - Official (Volar) — provides base grammars (`source.vue` / `text.html.vue`) and language services |
| `ms-python.python` | Python — Pylance ships with the Python extension and provides Go to Definition, hover, references, completion, outline, formatting, etc. |

If installing **from VSIX** or by copying the extension directory, make sure the above extensions are enabled.

### Option 1: Development Mode (Recommended for First Try)

1. Open the extension directory (the folder containing `package.json`, `extension.js`, and `syntaxes/`) in **Cursor / VS Code**.
2. Press **F5** to launch the Extension Development Host.
3. In the new window, open your Vuepy project and open a `.vue` file containing `<script lang="py">` or `<PnMarkdown>` to verify highlighting and language features.

### Option 2: Copy to Extensions Directory

Copy the entire extension folder to your user extensions directory, e.g.:

- Linux / macOS: `~/.cursor/extensions/vuepy-0.0.1/` (`package.json` should be directly visible inside)

Restart the editor to apply.

### Option 3: Package as VSIX

`vsce package` — **Node 20+** is recommended.

```bash
cd /path/to/vs-plugin-vuepy
npm install -g @vscode/vsce
vsce package
```

Then select **Install from VSIX** in the Extensions view.

---

## Troubleshooting

1. Confirm that **Vue - Official** and **Python** are installed, and that the language mode for the current `.vue` file is **Vue**.
2. Run **Developer: Reload Window** to reload the window.
3. If highlighting is still incorrect, use **Inspect Editor Tokens and Scopes** to check the **Scope** at the cursor position. If the root scope is not in the `injectTo` list, add it as needed in `package.json`'s `contributes.grammars[].injectTo` and the corresponding `tmLanguage.json`'s `injectionSelector` (must match Volar / the current Vue syntax package).

---

## Changelog (relative to the early "Python highlighting only" version)

- Extension package name and entry point unified as **Vuepy** (`vuepy` / `extension.js`); hard dependencies on **Volar** and **Python** declared.
- **PnMarkdown grammar injection** adds **`text.html.derivative`** as an injection target; blocks now support multiple fenced languages and a more complete set of Markdown constructs; tag names support `PnMarkdown`, `pn-markdown`, `Markdown`, and `markdown`.
- **Language features**: on top of the original Go to Definition / hover / references, adds **completion**, **outline**, and **script-block-only formatting** (independent temporary file strategy).
- **Rename and refactor**: new **Rename (F2)** and **Code Refactor Actions (Extract / Inline / QuickFix)**, both using `mapWorkspaceEditToVue` to map temporary-file coordinates back to `.vue`; renaming is limited to the script interior (template usages are outside Pylance's recognition scope).
- **Template ↔ Script**: simple **Go to Definition** and **Find References** linking between template and script symbols; compatible with **real `.vue` path resolution** for Volar virtual URIs.
- **Run**: new **Run Vuepy file** command and title bar Run button (only shown when `<script lang="py">` is present).
