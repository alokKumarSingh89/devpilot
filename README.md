# DevPilot

DevPilot is an AI Engineering Control Plane for VS Code. Its long-term direction is to understand PRDs and repositories, maintain structured project intelligence, plan engineering tasks, orchestrate coding agents, independently review and validate their work, and support manual development.

## Current scope: TASK-DP-001 through TASK-DP-003

This foundation registers a dedicated DevPilot Activity Bar container and the `devpilot.controlCenter` Webview View. The view displays the product name, “AI Engineering Control Plane”, a Workspace section listing current workspace folder names (or “No workspace open”), and “No project initialized”. The command **DevPilot: Open Control Center** (`devpilot.openControlCenter`) reveals the view.

TASK-DP-002 adds a reasoning-model gateway using the stable VS Code Language Model API. A reasoning model is **not a coding agent**. Future reasoning uses may include PRD analysis, planning, architecture, review, and validation; none of those workflows are implemented here.

TASK-DP-003 adds project initialization and validated persistence in `.devpilot/project.yaml`. There is no PRD reading/analysis, repository scanning/analysis, task planning, agent integration, Git automation, backend, or React dependency. Test Model sends only a fixed readiness prompt, never workspace files. Only the selected model ID is persisted in VS Code workspace state (`devpilot.reasoningModelId`); model objects and responses are not persisted.

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
- `src/infrastructure/projects/`: VS Code workspace selection, `workspace.fs` create-only storage, and YAML parsing/serialization. No Node filesystem access.
- `src/presentation/commands/`: model and project command controllers for Quick Pick, confirmation, notifications, and safe failures. Business rules remain in application services.
- `src/application/controlCenterState.ts`: VS Code-independent initial view state. Opening a workspace does not initialize a DevPilot project.
- `src/presentation/controlCenter/`: thin VS Code view adapter and pure HTML renderer. The provider handles only rendering and view lifecycle. The composition root owns the workspace-folder change subscription through `context.subscriptions`. The provider refreshes resolved views and disposes view listeners both when the view closes and when the extension is deactivated.
- `media/`: theme-aware stylesheet and a monochrome `currentColor` SVG icon.
- `tests/`: Node-based unit tests for initial UI states, HTML injection protection, escaping, CSP construction, workspace refresh, subscription disposal, model states, clear confirmation, preference isolation, and direct-command gates; no VS Code process is needed.

As actual features arrive, `src/core`, `src/ai`, and `src/agents` can be added alongside application and presentation. No empty layers or speculative agent abstractions are included. Application/domain logic should stay independent of VS Code; external integrations should be wired through the composition root.

The webview disables scripts and limits local resources to `media/`. Only the six static commands declared in the typed `controlCenterActions` map are allowlisted; provider metadata and responses are rendered as escaped text, never links or executable markup. Commands enforce the application model gate. Its CSP denies resources by default and permits only styles from the VS Code-provided resource origin. All interpolated HTML values are escaped. There are no scripts or inline styles, so no nonce is needed. Future scripts must use a cryptographically secure nonce and an explicitly revised CSP. Styling uses VS Code theme variables. Initialization requires a trusted workspace in addition to the workspace/model gates. The extension reads only its manifest and writes only its `.devpilot` metadata; it does not read or execute repository code.

## Validation and follow-up

Unit tests and compilation do not exercise the actual VS Code UI. Use the F5 checks above to verify integration and themes. Marketplace publication, publisher identity, license selection, VSIX distribution, automated Extension Host tests, and later product features are outside TASK-DP-003. This scaffold is private and unlicensed until distribution decisions are made.


## Project initialization (TASK-DP-003)

Use **DevPilot: Initialize Project** or its Control Center action. A workspace folder and a currently available, explicitly selected reasoning model are required. In a multi-root workspace, the **first folder** is the project root; the Project card and source-picker title identify it. The manifest name uses VS Code's workspace name, falling back to the folder name. Changing/removing the root while the source picker is open rejects initialization. No selection is stored for a separate project root in this task.

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

Persistence uses `vscode.workspace.fs` with URI-aware paths. Serialization and validation happen before writes. The adapter writes to a unique temporary file in `.devpilot`, then renames to `project.yaml` with `overwrite: false`. Existing files, including corrupt manifests, are never replaced. Failed temporary writes are cleaned up where the filesystem allows it; cleanup failures are logged. A `.devpilot` directory alone does not imply initialization. Symbolic-link metadata paths reported by a provider are rejected. Rename and filesystem semantics depend on the remote/virtual provider; providers without writable/rename support fail gracefully.

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
