# DevPilot

DevPilot is an AI Engineering Control Plane for VS Code. Its long-term direction is to understand PRDs and repositories, maintain structured project intelligence, plan engineering tasks, orchestrate coding agents, independently review and validate their work, and support manual development.

## Current scope: TASK-DP-001 through TASK-DP-006

This foundation registers a dedicated DevPilot Activity Bar container and the `devpilot.controlCenter` Webview View. The view displays the product name, “AI Engineering Control Plane”, a Workspace section listing current workspace folder names (or “No workspace open”), and “No project initialized”. The command **DevPilot: Open Control Center** (`devpilot.openControlCenter`) reveals the view.

TASK-DP-002 adds a reasoning-model gateway using the stable VS Code Language Model API. A reasoning model is **not a coding agent**. PRD analysis is implemented in TASK-DP-005; planning, architecture, review, and validation remain future scope.

TASK-DP-003 adds project initialization and validated persistence in `.devpilot/project.yaml`. TASK-DP-004 adds explicit PRD discovery, safe text import, and portable source metadata. TASK-DP-005 adds explicitly requested AI PRD analysis and validated structured requirements. TASK-DP-006 adds explicit deterministic repository inventory without model calls. There is no AI repository analysis, task planning, agent integration, Git automation, backend, or React dependency. Test Model sends only a fixed readiness prompt, never workspace files. Only the selected model ID is persisted in VS Code workspace state (`devpilot.reasoningModelId`); model objects and responses are not persisted.

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
- `src/infrastructure/models/vscodeModels.ts`: VS Code discovery mapping, workspace-state persistence, and LanguageModelGateway adapter. Every request resolves the selected ID afresh. The adapter forwards cancellation, consumes the text stream, bounds test output to 8,192 characters (analysis to 262,144), checks analysis token capacity, and disposes its cancellation sources and subscriptions. Extension shutdown cancels active requests.
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

Unit tests and compilation do not exercise the actual VS Code UI. Use the F5 checks above to verify integration and themes. Marketplace publication, publisher identity, license selection, VSIX distribution, automated Extension Host tests, and later product features are outside TASK-DP-005. This scaffold is private and unlicensed until distribution decisions are made.


## Project initialization (TASK-DP-003)

Use **DevPilot: Initialize Project** or its Control Center action. A workspace folder and a currently available, explicitly selected reasoning model are required. In a multi-root workspace, DevPilot requires an **explicit project folder selection** before project operations. Use **Choose Project Folder** to change it; the Project card identifies the root. Selection is session-local and must be repeated after reloading a multi-root workspace. A single-root workspace uses its sole folder. The manifest name uses the workspace name for a single root and the selected folder name for multiple roots. Changing/removing the root while a picker is open rejects the pending operation. No machine-specific root URI is persisted.

The source picker offers **Import PRD**, **Analyze Existing Code**, and **PRD + Existing Code** (recommended for an existing project with requirements). These choices only set the source field. Cancelling writes nothing. No document is requested, scanned, read, or analyzed, and no model request is sent by initialization.

New projects always have lifecycle `INITIALIZING`. `READY` is supported when reading a valid manifest but is never produced by this initialization workflow. Existing manifests take precedence over AI configuration when displaying project identity, so clearing a model never makes an existing project appear uninitialized. Without a workspace, state is `NO_WORKSPACE`; a missing manifest resolves to `NOT_INITIALIZED` independently of model readiness. Initialization remains gated by the selected model. The UI also handles loading and storage/validation errors without enabling initialization during an error.

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

The default limit is **1 MiB**, configurable with `devpilot.documents.maxBytes` (1 byte–16 MiB). SHA-256 is calculated over the original bytes, including any UTF-8 BOM. Import itself reads text transiently without persisting it in YAML or sending it to a model. TASK-DP-005 adds a separate explicit Analyze PRD action described below; import still triggers no analysis.

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

PRD state is separate from project lifecycle: **Not selected**, **Selected**, **Missing**, **Changed**, or **Unavailable** for validation/access errors. Reload and **Refresh Project** reevaluate the saved document and hash; no polling loop is used. **Re-import PRD** opens explicit selection again and updates metadata only after a successful import. Import is local and does not require sending a model request; Analyze PRD does. Existing initialization still requires AI Ready.

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


## Structured PRD analysis (TASK-DP-005)

After importing an unchanged PRD into an `INITIALIZING` PRD or PRD + Existing Code project, select an available reasoning model and click **Analyze PRD**. This explicit action sends the PRD to that model through the existing VS Code Language Model gateway. A cancellable notification shows progress. Refresh, reload, initialization and import never trigger analysis automatically.

Successful analysis creates **`.devpilot/product/requirements.yaml`** with versioned product information, actors, functional/non-functional requirements, constraints, out-of-scope items, and open questions. Every traced item has bounded source evidence; provenance records the project UUID, imported path/hash, generation time and actual model ID/vendor/family. Project metadata is unchanged and lifecycle remains **Initializing**. **View Requirements** opens the YAML in the editor for review; **Re-analyze PRD** generates a complete validated replacement. There is no merge/reconciliation or developer approval state yet.

Read [Requirements artifact V1](docs/requirements-schema.md) for the exact field constraints, ID strategy, JSON extraction policy, trust boundaries, context limits, state model, and filesystem guarantees. DevPilot rejects malformed output rather than silently repairing or trusting it. Valid structure and matching evidence still require human review for meaning and completeness.

Architecture additions:

- `src/domain/requirements/`: owned requirements/analysis types, enums, limits, safe failures, and strict runtime validators.
- `src/application/analysis/`: prompt compiler, response parser, canonical IDs, analysis orchestrator, cancellation scope, and storage port. No VS Code imports; no commands or model output execute code.
- `src/infrastructure/requirements/`: bounded YAML loading/serialization and temporary-file replacement through `workspace.fs`.
- Existing reasoning gateway: fresh model resolution, token checks and bounded cancellable streaming; existing Test Model behavior is preserved.
- `analysisCommands.ts` and `renderAnalysis.ts`: explicit commands/progress/editor opening and escaped summary rendering. The webview remains script-free with its existing CSP and static command allowlist.

Added commands: `devpilot.analyzePrd` and `devpilot.openRequirements`. No new dependencies or settings were required. Requirements artifact watchers, analysis listeners and cancellation scopes belong to the extension lifecycle.

### TASK-DP-005 manual acceptance

Run `npm run typecheck`, `npm test`, and `npm run compile`. Press **F5 → Run DevPilot Extension**. In the Extension Development Host, open the folder containing your DP-004 DevTask PRD, open **DevPilot: Open Control Center**, explicitly choose the correct root if multiple folders are open, and select an available reasoning model. Initialize/import the DevTask PRD if needed. Confirm the PRD state is **Selected** and project status **Initializing**. Use saved document contents; unsaved editor changes are not imported or analyzed.

1. **Real model request:** Click **Analyze PRD**. Accept VS Code's provider consent prompt if shown. Expect a cancellable **DevPilot: Analyze PRD** notification and **Requirements intelligence → Analyzing…**. No second analysis should run if the command is invoked again. A context-limit error requires choosing a larger model; DevPilot does not truncate the PRD.
2. **Persistence:** After a successful response, verify `.devpilot/product/requirements.yaml` exists. The original `project.yaml` must be unchanged, including `INITIALIZING`.
3. **Structure and evidence:** Inspect the generated product, actors, functional requirements, NFRs, constraints, out-of-scope and questions. For DevTask, review entries covering authentication, projects, tasks, task dependencies, comments, notifications, security, performance and stated constraints. Wording/counts vary by model; inspect source excerpts against the PRD and flag omissions or misleading interpretations. Verify the stored source hash matches `project.yaml` and the generating model matches the selected model.
4. **Summary/reload:** Verify **Requirements intelligence → Analyzed**, counts for functional requirements, NFRs, constraints and open questions, and the generating model family. Run **Developer: Reload Window** (reselect the root for multi-root) and verify the same artifact/summary returns without a model call.
5. **Editor review:** Click **View Requirements** or run **DevPilot: View Requirements**. The selected root's `.devpilot/product/requirements.yaml` must open in VS Code.
6. **Changed PRD:** Edit and save `PRD.md` without re-importing, then **Refresh Project**. Expect PRD **Changed** and no Analyze/Re-analyze action. Invoke **DevPilot: Analyze PRD** directly: it must reject with a re-import explanation and preserve the artifact.
7. **Re-import/re-analysis:** Re-import the saved changed PRD. Expect requirements **Stale** until you explicitly analyze again. A successful re-analysis replaces the complete requirements artifact, restores **Analyzed**, and keeps the project **Initializing**.
8. **Cancellation:** Start re-analysis, then cancel in the progress notification while the provider is responding. Expect a cancellation notice, no partial YAML and unchanged previous requirements. If no artifact existed, state returns to **Not analyzed**. Cancellation after the final rename begins cannot undo that completed commit.
9. **Malformed output:** Run `npm test -- tests/requirementsValidation.test.ts tests/prdAnalysis.test.ts tests/requirementsStorage.test.ts`. These fake-provider tests inject malformed JSON, invalid schemas, fabricated/oversized evidence and failed writes; they assert that existing valid requirements remain intact. No AI quota is used by tests.

Also verify light/dark/high-contrast themes and a narrow sidebar; model metadata, paths and error text must render literally. CODEBASE-only projects, missing PRDs, no selected reasoning model and untrusted workspaces must reject direct analysis commands. No architecture generation, AI codebase analysis, task planning, coding-agent integration, Git automation, or autonomous work is included.

Live model quality, quota/consent, remote filesystem behavior and Extension Host UI require manual verification. The test fixture at `tests/fixtures/requirements-prd.md` is intentionally small; it is not a replacement for reviewing the full DevTask PRD output. IDs are stable for identical normalized semantic identities, but arbitrary rewording across runs requires future reconciliation. Prompt defenses and structural validation cannot establish semantic correctness by themselves.


## Deterministic repository inventory (TASK-DP-006)

Initialize an **Existing Codebase** or **PRD + Existing Code** project, then click **Scan Codebase**. This explicit, cancellable operation creates `.devpilot/codebase/inventory.yaml`. It inventories bounded repository facts; it never calls a reasoning model, executes target scripts, installs dependencies, runs target tests/builds, or starts containers. Existing initialization still requires AI Ready; scanning an already initialized project does not require a selected model. PRD-only projects cannot scan through the command layer.

The Control Center shows **Codebase intelligence** with Not scanned, Scanning, Scanned, Stale or Scan failed, repository type, languages/frameworks, package/test counts, Git metadata and incomplete-coverage warnings. **View Inventory** opens the validated artifact. **Rescan Codebase** replaces it only after successful validation. **Refresh Project** explicitly checks its fingerprint without replacing the artifact. Normal view refreshes, reloads and file watchers only load saved inventory; there is no automatic repository scan. After reload, the UI explains that saved inventory needs an explicit freshness check. Project lifecycle remains **Initializing**, and `project.yaml` is unchanged.

See [Repository inventory V1](docs/repository-inventory.md) for schema, bounds, detector evidence, secret handling, fingerprint inputs and filesystem limitations. The new commands are `devpilot.scanCodebase` and `devpilot.openRepositoryInventory`. Resource-scoped `devpilot.inventory.*` settings control the five scan limits. No dependencies were added.

### TASK-DP-006 manual acceptance

Run the development validation commands above, then press **F5 → Run DevPilot Extension**. In the Extension Development Host, open **DevPilot: Open Control Center**, select a reasoning model and initialize with **Existing Codebase** (or **PRD + Existing Code**). In a multi-root workspace explicitly select the intended project folder. Initialization itself must not scan. Use disposable copies for cases involving new files. These checks require a live Extension Host; fixture tests do not replace them.

1. **DevPilot itself:** Open a copy of DevPilot in the host, initialize it, and click **Scan Codebase → View Inventory**. Expect TypeScript, npm, VS Code Extension, esbuild and Vitest signals. Check relative paths, schema version 1, a SHA-256 fingerprint and `project.yaml` still `INITIALIZING`. Clearing the selected model after initialization must not block a rescan.
2. **NestJS:** Open a small existing NestJS project, initialize and scan. Expect TypeScript, NestJS with `@nestjs/core` evidence, package/TypeScript manifests and tests where present. No package scripts should run. The automated fixture is `tests/fixtures/repositories/nestjs.json`.
3. **Monorepo:** Open a small existing workspace repository with workspace declarations and multiple apps/packages. Initialize and scan; expect MONOREPO, individual package paths and explicit workspace/structural evidence. The automated fixture is `tests/fixtures/repositories/monorepo.json`.
4. **Excluded directories:** In a disposable initialized repository containing `node_modules`, `dist`, `build` or `coverage`, scan and inspect YAML. None of their paths may appear or contribute language/test counts. In DevPilot itself, existing dependencies and `dist` provide this check without running any target command.
5. **Secrets:** In the disposable repository add `.env`, `.env.local` and a `.key` file containing a distinctive dummy marker. Rescan. Neither these paths nor the marker may appear in inventory. Use dummy data, not actual credentials.
6. **Stable fingerprint:** Save `generated.repositoryFingerprint`, rescan without editing files or changing Git HEAD/settings, and compare. The hash must match even though `generatedAt` changes. `.devpilot` writes must not invalidate it. Run **Refresh Project**; expect Scanned.
7. **Staleness:** Add and save a candidate such as `src/main.ts` or a new `tsconfig.extra.json` in the disposable repository. Run **Refresh Project**; expect Stale while the saved artifact remains unchanged. Click **Rescan Codebase**; expect Scanned and a different fingerprint. No automatic polling or model call should occur.
8. **Cancellation:** Save a copy of a valid inventory. Start **Rescan Codebase**, then click **Cancel** in its progress notification before completion. Verify the previous artifact is unchanged and no partial inventory replaced it. A larger repository or slower remote filesystem makes this easier to observe; small scans may finish before cancellation. Automated tests cover stalled discovery and cancellation before commit deterministically.

Also scan a Python/FastAPI project (fixture: `tests/fixtures/repositories/fastapi.json`); check FastAPI/Pytest evidence and Python counts. Lower `devpilot.inventory.maxFiles` temporarily to exercise the incomplete-coverage warning, then restore it. In PRD + Existing Code, previously analyzed requirements must remain visible alongside the inventory. Verify untrusted workspaces and PRD-only projects reject direct scan commands, unavailable Git still permits scanning, and themes/narrow sidebars preserve readable escaped labels.


### TASK-DP-005 real-model integration retest

The hardening fix separates raw model content from final IDs/provenance and records safe stage/path diagnostics in **DevPilot Output**. See [the analysis contract and diagnostics](docs/requirements-schema.md). Historical failures cannot be attributed to an exact response field without the original response or diagnostics; the old generic error concealed that information. Tests reproduce ID-contract brittleness, strict enum/null behavior and misleading first-analysis artifact claims. Existing stream collection already waited for completion; a new split-JSON regression verifies it.

1. Run `npm run typecheck`, `npm test`, `npm run compile`, then **F5 → Run DevPilot Extension**. Open the intended PRD workspace and DevPilot. Use a disposable workspace copy or back up `.devpilot` before this destructive reset test.
2. **A–B:** Delete `.devpilot` in the Extension Development Host Explorer. Click **Refresh Project** (or **Developer: Reload Window**, then reopen DevPilot). Expect **No project initialized**, with no recreation of metadata. If no model is selected, select one to enable initialization.
3. **C–D:** Click **Initialize Project** and choose **Import PRD** or **PRD + Existing Code**. Confirm project status is **Initializing**. In multi-root workspaces select the intended root explicitly.
4. **E:** Click **Select PRD** and explicitly import the saved `PRD.md`. Expect **Selected**.
5. **F–G:** Open **View → Output**, select **DevPilot**, then click **Analyze PRD**. Accept provider access if prompted. Observe request metadata, token headroom, stream completion, response size and validation stages. No full PRD or model response should appear in logs. On rejection, inspect the exact stage/path/expected/received diagnostic.
6. **H–I:** On success, click **View Requirements**. Verify `.devpilot/product/requirements.yaml` exists, has schema 1, locally generated IDs and actual model/source metadata. Review actors, requirements, NFRs, constraints, exclusions, questions and source evidence against your full DevTask PRD. The project must remain **Initializing**.
7. **J:** Click **Re-analyze PRD**. A successful result replaces the complete artifact. A failed result must leave the previous artifact intact and report preservation; a failed first analysis after deletion must instead report that no artifact was created. Cancel a running analysis before commit and verify no partial replacement.
8. **K–L:** Edit and save `PRD.md`, then **Refresh Project**. Expect **Changed** and no enabled analysis action. Invoke **DevPilot: Analyze PRD** directly; expect a re-import instruction and unchanged requirements. Explicitly re-import, then analyze again.

Live provider output, quota/consent and Extension Host behavior still require this manual retest. Automated tests use mocked editor/provider boundaries and do not contact a model.


### TASK-DP-005 source-quote retest

Raw model `sourceReferences` now require `{section, quote}`. DevPilot independently verifies each short quote using contiguous source matching after whitespace normalization, then writes the verified excerpt as schema-v1 `evidence`. Descriptions may paraphrase; quotes may not. See [source traceability rules](docs/requirements-schema.md#source-traceability-correction).

1. Rebuild with `npm run compile`, restart **F5 → Run DevPilot Extension**, and keep the existing initialized project and selected reasoning model. Do not delete `.devpilot` for this retest.
2. Open DevPilot and **Refresh Project**. If `PRD.md` is **Changed**, explicitly re-import it; otherwise keep the current import.
3. Open **View → Output → DevPilot** and click **Analyze PRD** (or **Re-analyze PRD** when an artifact already exists), using the real configured VS Code model.
4. Confirm diagnostics progress through stream completion, JSON parsing, raw validation, **source quote verification**, **source quotes verified**, canonicalization, final artifact validation and YAML persistence. A rejected quote must produce its `.quote` field path, lengths and `NOT_FOUND`; it must not publish a partial artifact.
5. Click **View Requirements** to open `.devpilot/product/requirements.yaml`. Inspect source references across functional requirements, NFRs, constraints, exclusions and questions. Each persisted `evidence` must occur in the saved PRD after collapsing whitespace. Schema stays 1, with `evidence`, not `quote`, in the artifact.
6. Run **Re-analyze PRD** again and review the new result. A model can still violate the contract; if it does, the verifier must reject it and preserve the previous artifact. The fix does not guarantee compliance from every model response.

The automated suite includes the representative DevTask complete pipeline and the exact fourth-reference failure shape. Live provider compliance and Extension Host behavior require this manual retest.


### TASK-DP-005 classification retest

The prompt now explicitly distinguishes observable behavior, quality attributes and implementation restrictions, and contains a tested JSON example. `OPERABILITY` remains valid only for NFRs. Invalid constraint categories are rejected rather than remapped or moved.

1. Run `npm run compile`, restart **F5**, and open the current initialized workspace. Keep the same imported PRD; re-import only if its saved content has changed.
2. Open **View → Output → DevPilot**, then run **Analyze PRD** or **Re-analyze PRD** with the configured model.
3. Verify transport → complete stream → parsing → raw validation/normalization → quote verification → canonicalization → final validation → YAML persistence.
4. Open `.devpilot/product/requirements.yaml`. Check that logging and health-readiness qualities appear under NFRs with OPERABILITY, and mandated backend/frontend/database/container technologies appear as TECHNOLOGY constraints, supported by verified source evidence.
5. If the model violates the contract again, retain the exact structured diagnostic (stage, field path, expected/received values and any fixed classification hints). An invalid output must leave the prior artifact unchanged. Do not delete `.devpilot` for this retest.

A prompt improves model guidance but cannot guarantee classification compliance or semantic correctness. Automated tests validate the contract and representative fixtures; real-model compliance requires this live retest.


### TASK-DP-005 bounded-output retest

New analyses require **1–3 source references** per traced item (prefer 1), **1–8 acceptance criteria** per functional requirement, **0–50 actor links**, and **0–200 entries** in each top-level collection. Existing string bounds and quote verification remain. Limits come from one domain contract, and over-limit output fails without truncation. Existing schema-v1 artifacts remain readable under their original bounds. See the [complete bounds audit](docs/requirements-schema.md#bounded-model-output-contract-audit).

1. Rebuild with `npm run compile`, restart **F5**, and keep the current initialized DevTask project, imported PRD and configured reasoning model. Re-import only if the PRD has changed.
2. Open **View → Output → DevPilot**, then run **Analyze PRD** or **Re-analyze PRD**.
3. Confirm transport, stream completion, JSON parsing, raw validation/normalization, quote verification, canonicalization, artifact validation and persistence complete.
4. Open `.devpilot/product/requirements.yaml`; check references and criteria remain within their limits and every evidence excerpt matches the PRD after whitespace normalization.
5. If the model violates a bound again, retain its structured diagnostic: exact path, minimum, maximum, actualLength and reason. For six constraint references, expect maximum 3 and actualLength 6. The previous valid artifact must remain unchanged.

Live-provider compliance still requires this manual retest; automated fixtures cover deterministic boundary failures without model calls.
