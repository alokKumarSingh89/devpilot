# DevPilot

DevPilot is an AI Engineering Control Plane for VS Code. Its long-term direction is to understand PRDs and repositories, maintain structured project intelligence, plan engineering tasks, orchestrate coding agents, independently review and validate their work, and support manual development.

## Current scope: TASK-DP-001 and TASK-DP-002

This foundation registers a dedicated DevPilot Activity Bar container and the `devpilot.controlCenter` Webview View. The view displays the product name, “AI Engineering Control Plane”, a Workspace section listing current workspace folder names (or “No workspace open”), and “No project initialized”. The command **DevPilot: Open Control Center** (`devpilot.openControlCenter`) reveals the view.

TASK-DP-002 adds a reasoning-model gateway using the stable VS Code Language Model API. A reasoning model is **not a coding agent**. Future reasoning uses may include PRD analysis, planning, architecture, review, and validation; none of those workflows are implemented here.

There is no project initialization workflow, PRD analysis, repository analysis, task planning, agent integration, backend, or React dependency. Test Model sends only a fixed readiness prompt, never workspace files. Only the selected model ID is persisted in VS Code workspace state (`devpilot.reasoningModelId`); model objects and responses are not persisted.

## Development

Use Node.js 22.12 or newer, npm, and VS Code 1.96 or newer.

```sh
npm install
npm run typecheck
npm test
npm run compile
```

Commit `package-lock.json` with dependency changes. Use `npm ci` for reproducible subsequent installs. All dependencies are development dependencies; VS Code provides the runtime API.

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
9. Select a model again. **Initialize Project** appears only with **AI Ready**. Clicking it shows an explicit not-implemented notice and creates no project. This is a gated entry point only; initialization is outside DP-002. Clear the model, then invoke **DevPilot: Initialize Project** directly from the Command Palette: it must require selection rather than bypass the gate.
10. Disable the selected model provider or remove access and refresh. Expect **Setup required** if other models remain, otherwise **No reasoning models available**. No replacement is selected automatically.
11. Check light, dark, and high-contrast themes, keyboard focus on actions, and a narrow sidebar. Confirm text and buttons remain readable and wrap appropriately.

Discovery also refreshes on model-catalog and access changes. `READY` means the chosen model is currently exposed and not known to be denied; consent, quota, and transient provider failures can still occur at request time. DevPilot handles these separately. No account credentials or API keys are stored by DevPilot. Clearing uses `workspaceState.update('devpilot.reasoningModelId', undefined)` and touches no other setting. A late response from a test started before clearing cannot restore the cleared result or selection.

The workspace card shows actual folder names and paths. **Open Folder** uses the native folder picker and opens only your selection. The selected reasoning-model card shows actual model metadata, a **Selected** badge (not an inferred default), and the maximum **input** token limit when reported. Static SVG icons inherit theme colors. **Coding Agent → Configure** is disabled and labeled as a future feature; no coding-agent integration is included.

## Architecture

- `src/extension.ts`: composition root; wires workspace/model events, application services, view registration, Quick Pick, progress cancellation, and commands. Registrations belong to the extension context.
- `src/domain/reasoningModel.ts`: DevPilot-owned model metadata and the discriminated `NO_MODEL` / `SELECTION_REQUIRED` / `READY` states. No VS Code imports.
- `src/application/models/`: discovery, selection-store, cancellation, and gateway ports. `ReasoningModelService` coordinates explicit select/clear, serialized preference updates, a shared READY gate, and test results. Discovery remains a separate dependency; no extra selection wrapper is needed. Clearing never discovers, alters, or uninstalls provider models. No VS Code imports.
- `src/infrastructure/models/vscodeModels.ts`: VS Code discovery mapping, workspace-state persistence, and LanguageModelGateway adapter. Every request resolves the selected ID afresh. The adapter forwards cancellation, consumes the text stream, bounds test output to 8,192 characters, and disposes its cancellation sources and subscriptions. Extension shutdown cancels active requests.
- `src/application/controlCenterState.ts`: VS Code-independent initial state. Opening a workspace does not initialize a DevPilot project.
- `src/presentation/controlCenter/`: thin VS Code view adapter and pure HTML renderer. The provider handles only rendering and view lifecycle. The composition root owns the workspace-folder change subscription through `context.subscriptions`. The provider refreshes resolved views and disposes view listeners both when the view closes and when the extension is deactivated.
- `media/`: theme-aware stylesheet and a monochrome `currentColor` SVG icon.
- `tests/`: Node-based unit tests for initial UI states, HTML injection protection, escaping, CSP construction, workspace refresh, subscription disposal, model states, clear confirmation, preference isolation, and direct-command gates; no VS Code process is needed.

As actual features arrive, `src/core`, `src/ai`, and `src/agents` can be added alongside application and presentation. No empty layers or speculative agent abstractions are included. Application/domain logic should stay independent of VS Code; external integrations should be wired through the composition root.

The webview disables scripts and limits local resources to `media/`. Only the six static commands declared in the typed `controlCenterActions` map are allowlisted; provider metadata and responses are rendered as escaped text, never links or executable markup. Commands enforce the application model gate. Its CSP denies resources by default and permits only styles from the VS Code-provided resource origin. All interpolated HTML values are escaped. There are no scripts or inline styles, so no nonce is needed. Future scripts must use a cryptographically secure nonce and an explicitly revised CSP. Styling uses VS Code theme variables. Workspace trust behavior is unchanged: these commands do not read or execute workspace code, and the project entry point performs no initialization or filesystem writes.

## Validation and follow-up

Unit tests and compilation do not exercise the actual VS Code UI. Use the F5 checks above to verify integration and themes. Marketplace publication, publisher identity, license selection, VSIX distribution, automated Extension Host tests, and later product features are outside TASK-DP-002. This scaffold is private and unlicensed until distribution decisions are made.
