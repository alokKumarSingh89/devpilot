# DevPilot

DevPilot is an AI Engineering Control Plane for VS Code. Its long-term direction is to understand PRDs and repositories, maintain structured project intelligence, plan engineering tasks, orchestrate coding agents, independently review and validate their work, and support manual development.

## Current scope: TASK-DP-001 through TASK-DP-004

This foundation registers a dedicated DevPilot Activity Bar container and the `devpilot.controlCenter` Webview View. The view displays the product name, “AI Engineering Control Plane”, a Workspace section listing current workspace folder names (or “No workspace open”), and “No project initialized”. The command **DevPilot: Open Control Center** (`devpilot.openControlCenter`) reveals the view.

TASK-DP-002 adds a reasoning-model gateway using the stable VS Code Language Model API. A reasoning model is **not a coding agent**. Future reasoning uses may include PRD analysis, planning, architecture, review, and validation; none of those workflows are implemented here.

TASK-DP-003 adds project initialization and validated persistence in `.devpilot/project.yaml`. TASK-DP-004 adds explicit PRD discovery, safe text import, and portable source metadata. There is no AI PRD analysis, repository analysis, task planning, agent integration, Git automation, backend, or React dependency. Test Model sends only a fixed readiness prompt, never workspace files. Only the selected model ID is persisted in VS Code workspace state (`devpilot.reasoningModelId`); model objects and responses are not persisted.

## Development

Use Node.js 22.12 or newer, npm, and VS Code 1.96 or newer.

```sh
npm install
npm run typecheck
npm test
npm run compile
```

Commit `package-lock.json` with dependency changes. Use `npm ci` for reproducible subsequent installs. The `yaml` runtime dependency is bundled by esbuild; VS Code provides the editor API. Other dependencies are development tooling.

`npm run compile` bundles `src/extension.ts` to `dist/extension.js` with esbuild and emits a source map. The extension host output is CommonJS, targets Node 20 compatibility, and leaves `vscode` external. Development tooling uses Node 22.12 or newer. Compilation does not typecheck; run `npm run typecheck` separately. `npm run watch` rebuilds on changes, and `npm run test:watch` runs tests interactively.

## Run and debug with F5

1. Open this repository in VS Code and run `npm install`.
2. Select **Run DevPilot Extension** in Run and Debug and press **F5**. The prelaunch task compiles the extension and opens an Extension Development Host.
3. Click the DevPilot Activity Bar icon, or run **DevPilot: Open Control Center** from the Command Palette. Confirm that the Control Center appears with the product title, subtitle, and uninitialized status.
4. In the development host, use **File > Open Folder…** to open a folder. Reopen Control Center if VS Code reloads, and confirm **Workspace** displays that folder's name.
5. Use **File > Save Workspace As…**, then **File > Add Folder to Workspace…** to add another folder. Keep Control Center visible and confirm both names appear without manually restarting or reloading. In Explorer, right-click the added folder and choose **Remove Folder from Workspace**; confirm its name disappears immediately. Remove the remaining folder from the saved workspace and confirm **Workspace / No workspace open**. Also verify this state with **File > Close Workspace** (or **Close Folder**).
6. Hide Control Center, add another folder, and reopen it; confirm the current folder list appears.
7. Switch between light, dark, and high contrast themes; verify readable text and the monochrome Activity Bar icon. Resize the sidebar and check long workspace names wrap.
8. Put a breakpoint in `src/extension.ts`, restart debugging, and open Control Center to exercise activation. After code edits, restart F5 to rebuild, or use watch mode and reload the development host.

Opening a folder can reload the development host. Reopen Control Center afterward. Contributed commands and views activate the extension automatically on the supported VS Code versions; startup activation is unnecessary.

## Reasoning models: manual verification

1. Press **F5** and open **DevPilot: Open Control Center** in the Extension Development Host. Expect Workspace, AI Configuration, Coding Agent, and Project cards. The layout follows the supplied design and adapts to narrow sidebars using VS Code theme variables.
2. Click **Refresh Models**. With no usable models, expect **No reasoning models available**, the model's intended purposes, and an explanation that project initialization needs AI configuration. Selection controls must be absent.
3. With models available and no saved selection, expect **Setup required**, the available model count, and **Select Reasoning Model**. If already configured, click **Clear Model** and confirm to reach this starting state.
4. Click **Select Reasoning Model**. Explicitly choose **GPT-5 mini** if your provider exposes it, or another available model. Expect **AI Ready**, the model name, provider, family, and input token limit when reported. This limit does not imply the full context window or output limit.
5. Click **Change Model**. The Quick Pick shows name, provider, and family and marks the current model **Currently selected**. Cancel the picker and confirm that selection is unchanged.
6. Click **Test Model** and accept the provider's access prompt if desired. Inspect **Actual response**: the expected reply is `DEV PILOT AI READY`. The UI displays the actual text, including deviations or an empty reply. Use the progress notification's **Cancel** action to test cancellation.
7. Click **Clear Model**. Confirm the dialog says **Clear DevPilot's selected reasoning model?** and explains that VS Code/GitHub Copilot configuration is unaffected. Choose **Cancel**: the selected model and **AI Ready** must remain.
8. Click **Clear Model** again and choose **Clear Model** in the dialog. Expect **Setup required** immediately, with **Select Reasoning Model**, no old test result, and no Initialize Project action. No restart is needed. Reload the same workspace and confirm the preference remains cleared.
9. In an uninitialized workspace, select a model again. **Initialize Project** becomes available after **AI Ready** and project detection completes. It opens the source picker described below. Clear the model and invoke **DevPilot: Initialize Project** directly: the application gate must require selection. Existing project identity remains visible even if AI is later unconfigured.
10. Disable the selected model provider or remove access and refresh. Expect **Setup required** if other models remain, otherwise **No reasoning models available**. No replacement is selected automatically.
11. Check light, dark, and high-contrast themes, keyboard focus on actions, and a narrow sidebar. Confirm text and buttons remain readable and wrap appropriately.

Discovery also refreshes on model-catalog and access changes. `READY` means the chosen model is currently exposed and not known to be denied; consent, quota, and transient provider failures can still occur at request time. DevPilot handles these separately. No account credentials or API keys are stored by DevPilot. Clearing uses `workspaceState.update('devpilot.reasoningModelId', undefined)` and touches no other setting. A late response from a test started before clearing cannot restore the cleared result or selection.

The workspace card shows actual folder names and paths. **Open Folder** uses the native folder picker and opens only your selection. The selected reasoning-model card shows actual model metadata, a **Selected** badge (not an inferred default), and the maximum **input** token limit when reported. Static SVG icons inherit theme colors. **Coding Agent → Configure** is disabled and labeled as a future feature; no coding-agent integration is included.

## Architecture

- `src/extension.ts`: composition root; wires workspace/model/manifest events, application services, view registration, and command controllers. Registrations belong to the extension context.
- `src/domain/reasoningModel.ts`: DevPilot-owned model metadata and the discriminated `NO_MODEL` / `SELECTION_REQUIRED` / `READY` states. No VS Code imports.
- `src/application/models/`: discovery, selection-store, cancellation, and gateway ports. `ReasoningModelService` coordinates explicit select/clear, serialized preference updates, a shared READY gate, and test results. Discovery remains a separate dependency; no extra selection wrapper is needed. Clearing never discovers, alters, or uninstalls provider models. No VS Code imports.
- `src/infrastructure/models/vscodeModels.ts`: VS Code discovery mapping, workspace-state persistence, and LanguageModelGateway adapter. Every request resolves the selected ID afresh. The adapter forwards cancellation, consumes the text stream, bounds test output to 8,192 characters, and disposes its cancellation sources and subscriptions. Extension shutdown cancels active requests.
- `src/domain/project.ts`, `ProjectFailure.ts`, and `validateProjectManifest.ts`: portable schema V1, lifecycle/source/state types, safe errors, and strict runtime validation. No VS Code or YAML imports.
- `src/application/projects/`: initialization use case, project state resolution, concurrency protection, and workspace/storage ports. Uses the existing reasoning-model gate without introducing another discovery implementation.
- `src/infrastructure/projects/`: VS Code workspace selection, `workspace.fs` create-only initialization and checked metadata updates, and YAML parsing/serialization. No Node filesystem access.
- `src/presentation/commands/`: model and project command controllers for Quick Pick, confirmation, notifications, and safe failures. Business rules remain in application services.
- `src/application/controlCenterState.ts`: VS Code-independent initial view state. Opening a workspace does not initialize a DevPilot project.
- `src/presentation/controlCenter/`: thin VS Code view adapter and pure HTML renderer. The provider handles only rendering and view lifecycle. The composition root owns the workspace-folder change subscription through `context.subscriptions`. The provider refreshes resolved views and disposes view listeners both when the view closes and when the extension is deactivated.
- `media/`: theme-aware stylesheet and a monochrome `currentColor` SVG icon.
- `tests/`: Node-based unit tests for initial UI states, HTML injection protection, escaping, CSP construction, workspace refresh, subscription disposal, model states, clear confirmation, preference isolation, and direct-command gates; no VS Code process is needed.

As actual features arrive, `src/core`, `src/ai`, and `src/agents` can be added alongside application and presentation. No empty layers or speculative agent abstractions are included. Application/domain logic should stay independent of VS Code; external integrations should be wired through the composition root.

The webview disables scripts and limits local resources to `media/`. Only the static commands declared in the typed `controlCenterActions` map are allowlisted; provider metadata and responses are rendered as escaped text, never links or executable markup. Model requests and initialization enforce the application model gate; local PRD import enforces project source, lifecycle, workspace, and trust rules without calling a model. Its CSP denies resources by default and permits only styles from the VS Code-provided resource origin. All interpolated HTML values are escaped. There are no scripts or inline styles, so no nonce is needed. Future scripts must use a cryptographically secure nonce and an explicitly revised CSP. Styling uses VS Code theme variables. Initialization requires a trusted workspace in addition to the workspace/model gates. The extension reads its manifest and explicitly selected requirements documents, and writes only its `.devpilot` metadata; it does not execute repository code.

## Validation and follow-up

Unit tests and compilation do not exercise the actual VS Code UI. Use the F5 checks above to verify integration and themes. Marketplace publication, publisher identity, license selection, VSIX distribution, automated Extension Host tests, and later product features are outside TASK-DP-004. This scaffold is private and unlicensed until distribution decisions are made.


## Project initialization (TASK-DP-003)

Use **DevPilot: Initialize Project** or its Control Center action. A workspace folder and a currently available, explicitly selected reasoning model are required. In a multi-root workspace, DevPilot requires an **explicit project folder selection** before project operations. Use **Choose Project Folder** to change it; the Project card identifies the root. Selection is session-local and must be repeated after reloading a multi-root workspace. A single-root workspace uses its sole folder. The manifest name uses the workspace name for a single root and the selected folder name for multiple roots. Changing/removing the root while a picker is open rejects the pending operation. No machine-specific root URI is persisted.

The source picker offers **Import PRD**, **Analyze Existing Code**, and **PRD + Existing Code** (recommended for an existing project with requirements). These choices only set the source field. Cancelling writes nothing. No document is requested, scanned, read, or analyzed, and no model request is sent by initialization.

New projects always have lifecycle `INITIALIZING`. `READY` is supported when reading a valid manifest but is never produced by this initialization workflow. Existing manifests take precedence over AI configuration when displaying project identity, so clearing a model never makes an existing project appear uninitialized. Without a manifest, states resolve to `NO_WORKSPACE`, `AI_NOT_READY`, or `NOT_INITIALIZED`. The UI also handles loading and storage/validation errors without enabling initialization during an error.

### Manifest V1

```yaml
schemaVersion: 1
project:
  id: ba0d745e-2e08-45cc-a5b9-bbe34932e46c
  name: example
  status: INITIALIZING
  source: PRD
  createdAt: 2026-09-21T10:00:00.000Z
  updatedAt: 2026-09-21T10:00:00.000Z
workspace:
  relativeRoot: .
ai:
  reasoningModel:
    id: selected-model-id
    vendor: selected-model-vendor
    family: selected-model-family
```

Actual IDs are generated using `crypto.randomUUID()`, timestamps use UTC ISO format, and model metadata comes from the current explicit selection. Absolute workspace locations, API keys, tokens, credentials, model objects, and model responses are not included. Model metadata is an initialization-time snapshot; changing the reasoning preference does not synchronize the manifest in DP-003.

The validator checks every required field, UUID syntax, supported status/source values, nonempty strings, valid UTC timestamps and their order, and `relativeRoot: .`. Unsupported schema versions fail explicitly. V1 rejects unknown fields instead of silently preserving arbitrary data. Parsing is limited to one UTF-8 YAML document of at most 64 KiB; duplicate keys, custom-tag warnings, and aliases are rejected.

Persistence uses `vscode.workspace.fs` with URI-aware paths. Serialization and validation happen before writes. The adapter writes to a unique temporary file in `.devpilot`, then renames to `project.yaml` with `overwrite: false`. Initialization never replaces existing files, including corrupt manifests. Explicit PRD import separately updates a valid manifest using a checked temporary-file replacement, as described below. Failed temporary writes are cleaned up where the filesystem allows it; cleanup failures are logged. A `.devpilot` directory alone does not imply initialization. Symbolic-link metadata paths reported by a provider are rejected. Rename and filesystem semantics depend on the remote/virtual provider; providers without writable/rename support fail gracefully.

Manifest changes, creation, deletion, workspace-folder changes, and model availability changes refresh the project view. Subscriptions and watchers belong to the extension lifecycle. **Output → DevPilot** shows operation/error codes without dumping manifest contents or secrets.

### Manual acceptance cases

1. **No workspace:** Press F5, open DevPilot in the Extension Development Host, and close its folder/workspace. Project must say **Open a folder to start using DevPilot**, without Initialize Project. A direct command invocation must also reject.
2. **No model selected:** Open a fresh test folder and clear the DevPilot model preference if needed. Project initialization must be unavailable. A direct invocation must require model configuration.
3. **Workspace + AI Ready:** Select a reasoning model. Once project detection finishes, expect **No project initialized** and **Initialize Project**. If the folder is in Restricted Mode, trust it before writing project metadata.
4. **Import PRD:** Click Initialize Project, select **Import PRD**, and confirm the success notification. Inspect `.devpilot/project.yaml`: schemaVersion must be 1, source `PRD`, and status `INITIALIZING`. The Project card must show the name, **Initializing**, source, and the message that intelligence has not been generated. There must be no analysis or PRD file picker.
5. **Reload:** Run **Developer: Reload Window** in the development host. Reopen DevPilot; the same ID and `INITIALIZING` state must be restored.
6. **Duplicate:** Run **DevPilot: Initialize Project** again from the Command Palette. Expect an already-existing-manifest message and no change to the file, UUID, or timestamps.
7. **Portable data:** Inspect the YAML and confirm `relativeRoot: .`, UUID, timestamps, source, and only selected-model ID/vendor/family metadata. No absolute machine paths, secrets, tokens, or credentials should appear.
8. **Other sources and cancellation:** In separate fresh folders, verify CODEBASE and PRD_AND_CODEBASE, and cancel the source picker to confirm no manifest is created. Each successful case must remain INITIALIZING.
9. **Malformed/future manifest:** In a disposable test folder, edit schemaVersion to 2 or introduce invalid YAML. The watcher should show a concise error and disable initialization; restoring valid YAML should restore the project card. No manifest should be overwritten automatically.

Actual local/remote Extension Host behavior remains a manual integration check. Full project migrations, intelligence generation, synchronization, and transitions to READY belong to later tasks.


## PRD discovery and import (TASK-DP-004)

An `INITIALIZING` project with source `PRD` or `PRD_AND_CODEBASE` exposes **Select PRD**. Discovery shows a Quick Pick with relative paths and ranking reasons; it never imports a result automatically. **Browse for another document…** is always offered, including when no candidates exist. Cancelling either picker leaves metadata unchanged. `CODEBASE` projects do not expose PRD selection as a required step, and direct commands enforce the same source/lifecycle rules.

Discovery uses bounded `workspace.findFiles` searches within the selected root, looking for likely filenames first. It considers at most 500 file results and displays at most 50 ranked candidates. The picker indicates when limits are reached; browse can select files beyond the search results. Required exclusions are `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`, and `.devpilot`. Enabled `files.exclude` and `search.exclude` patterns are included; conditional exclusion objects are treated conservatively as excluded. Discovery reads filenames only.

Ranking is deterministic: exact PRD/product-requirements/requirements/spec filenames receive the strongest scores; meaningful filename terms, supported formats, and proximity to the root add explainable scores. Ties use relative-path ordering. README is a low-confidence fallback and is omitted when a stronger requirements candidate exists. No LLM ranks or chooses files. A bounded search cannot guarantee finding every document in a large workspace.

### Reading and portable metadata

Only `.md`, `.markdown`, and `.txt` are supported, case-insensitively. Files must be inside the selected root with the same URI scheme and authority. Paths are normalized workspace-relative values; absolute paths, traversal, empty segments, backslashes, percent escapes, and control characters are rejected. The reader uses `workspace.fs`, checks parent folders and file types, and rejects provider-reported symlinks. It checks size before and after reading, rejects empty/whitespace-only files, invalid UTF-8 and binary control characters, and never truncates content.

The default limit is **1 MiB**, configurable with `devpilot.documents.maxBytes` (1 byte–16 MiB). SHA-256 is calculated over the original bytes, including any UTF-8 BOM. Text exists only transiently during reading; it is neither persisted in YAML nor sent to a model. No analysis, requirements extraction, repository analysis, or coding-agent execution occurs.

Manifest schema remains **1**. Old manifests without inputs remain valid. A successful explicit import adds optional metadata:

```yaml
inputs:
  prd:
    relativePath: docs/PRD.md
    format: markdown
    sizeBytes: 18234
    importedAt: 2026-09-21T11:00:00.000Z
    contentHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

The hash above illustrates the 64-character lowercase hexadecimal shape; actual values come from the document bytes. Runtime validation checks all five fields, matching extension/format, positive bounded size, timestamp, and SHA-256 structure. Import preserves identity, source, model snapshot, and `INITIALIZING` status, and updates `project.updatedAt`. It never transitions the project to `READY`.

Updates recheck the manifest before writing a temporary file and again before replacing the destination. Stale picker snapshots and detected concurrent edits are rejected; failures clean up temporary files where possible. VS Code's filesystem API has no compare-and-swap transaction: a narrow race remains between the last check and rename, and atomicity depends on the provider. Avoid simultaneous external manifest edits during import. Provider-reported symlink checks cannot eliminate filesystem races; a file growing after stat may be allocated by `readFile` before the post-read limit rejects it.

PRD state is separate from project lifecycle: **Not selected**, **Selected**, **Missing**, **Changed**, or **Unavailable** for validation/access errors. Reload and **Refresh Project** reevaluate the saved document and hash; no polling loop is used. **Re-import PRD** opens explicit selection again and updates metadata only after a successful import. Import is local and does not require sending a model request. Existing initialization still requires AI Ready.

Commands added: `devpilot.selectPrd`, `devpilot.refreshProject`, and `devpilot.selectProjectWorkspace`. Command registrations follow extension disposal. The webview remains script-free, CSP-restricted, and limited to allowlisted static commands; document names and paths are escaped.

Architecture additions:

- `domain/document.ts`, `documentPath.ts`, `DocumentFailure.ts`: owned types, limits, portable-path rules, and safe failures.
- `application/documents/`: discovery/reader ports, pure ranking, import orchestration, and PRD-state evaluation. No VS Code dependency or model calls.
- `infrastructure/documents/`: VS Code search, URI boundary checks, UTF-8 reading, and built-in SHA-256.
- Existing project storage owns manifest writes; command controllers own pickers; the Control Center renderer owns only display.

### TASK-DP-004 manual acceptance

Start with `npm install`, then press **F5 → Run DevPilot Extension**. In the Extension Development Host, open a disposable test folder, open **DevPilot: Open Control Center**, explicitly select a reasoning model, and initialize with **Import PRD**. Initialization itself does not open the PRD picker. Use separate test folders where a case requires a clean file set.

1. **PRD vs README:** Put `PRD.md` and `README.md` in the folder, each with nonempty text. Click **Select PRD**. Expect `PRD.md` first; README is omitted because a stronger candidate exists. Cancel and confirm no input is saved.
2. **Nested requirements:** Put nonempty text in `docs/product-requirements.md`. Click **Select PRD** and verify the candidate displays that relative path.
3. **Browse fallback:** In a folder with no likely requirements documents, click **Select PRD → Browse for another document…** and select a supported nonempty workspace file. Browse must also appear when the candidate list is empty. Cancelling writes nothing.
4. **Valid import:** Explicitly select a valid candidate. Inspect `.devpilot/project.yaml`: `inputs.prd` contains only relative path, format, byte size, UTC import time, and a 64-character SHA-256. Confirm no full document text or absolute path; the card shows **Selected**, and lifecycle stays **Initializing**.
5. **Reload:** Run **Developer: Reload Window**, then open DevPilot. In multi-root workspaces first choose the same project folder. The saved document/path must reappear as **Selected** with the same metadata.
6. **Changed:** Edit and save the imported document; click **Refresh Project**. Expect **Changed**. Click **Re-import PRD**, explicitly select it again, and expect **Selected** with an updated hash. No AI request should run.
7. **Missing:** Delete or rename the configured document, then click **Refresh Project**. Expect **Missing**, with **Select PRD** available. The original metadata remains until a valid replacement is selected.
8. **Outside workspace:** Choose **Select PRD → Browse…** and pick a supported file outside the selected root (including another root in a multi-root workspace). Expect a concise rejection and unchanged metadata.
9. **Invalid input:** Try a zero-byte file, whitespace-only file, and a document exceeding 1 MiB with the default setting. Each must be rejected with a concise explanation and unchanged metadata. The native picker filters unsupported extensions; where the platform permits overriding filters, choose a `.pdf` and confirm rejection. Automated reader tests also exercise unsupported extensions directly.

Additional regression checks: add a second workspace folder and verify DevPilot requires an explicit root choice before project operations; cancel the root picker and verify nothing is written. Confirm a CODEBASE project has no Select PRD action and a direct **DevPilot: Select PRD** invocation is rejected. Check a narrow sidebar, keyboard navigation, light/dark/high-contrast themes, and HTML-like filenames rendered literally. Live Extension Host and remote-provider behavior require these manual checks; unit tests mock the editor boundary.
