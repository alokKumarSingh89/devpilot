# DevPilot

DevPilot is an AI Engineering Control Plane for VS Code. Its long-term direction is to understand PRDs and repositories, maintain structured project intelligence, plan engineering tasks, orchestrate coding agents, independently review and validate their work, and support manual development.

## Current scope: TASK-DP-001

This foundation registers a dedicated DevPilot Activity Bar container and the `devpilot.controlCenter` Webview View. The view displays the product name, “AI Engineering Control Plane”, a Workspace section listing current workspace folder names (or “No workspace open”), and “No project initialized”. The command **DevPilot: Open Control Center** (`devpilot.openControlCenter`) reveals the view.

There is no project initialization workflow, PRD analysis, repository analysis, task planning, agent integration, model call, backend, or React dependency. No workspace files are read or written by the extension.

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

## Architecture

- `src/extension.ts`: composition root; connects VS Code workspace information, view registration, and command registration. Registrations belong to the extension context.
- `src/application/controlCenterState.ts`: VS Code-independent initial state. Opening a workspace does not initialize a DevPilot project.
- `src/presentation/controlCenter/`: thin VS Code view adapter and pure HTML renderer. The provider handles only rendering and view lifecycle. The composition root owns the workspace-folder change subscription through `context.subscriptions`. The provider refreshes resolved views and disposes view listeners both when the view closes and when the extension is deactivated.
- `media/`: theme-aware stylesheet and a monochrome `currentColor` SVG icon.
- `tests/`: Node-based unit tests for initial UI states, HTML injection protection, escaping, CSP construction, workspace refresh, and subscription disposal; no VS Code process is needed.

As actual features arrive, `src/core`, `src/domain`, `src/ai`, `src/agents`, and `src/infrastructure` can be added alongside application and presentation. No empty layers or speculative agent abstractions are included. Application/domain logic should stay independent of VS Code; external integrations should be wired through the composition root.

The webview disables scripts and limits local resources to `media/`. Its CSP denies resources by default and permits only styles from the VS Code-provided resource origin. All interpolated HTML values are escaped. There are no scripts or inline styles, so no nonce is needed. Future scripts must use a cryptographically secure nonce and an explicitly revised CSP. Styling uses VS Code theme variables.

## Validation and follow-up

Unit tests and compilation do not exercise the actual VS Code UI. Use the F5 checks above to verify integration and themes. Marketplace publication, publisher identity, license selection, VSIX distribution, automated Extension Host tests, and later product features are outside TASK-DP-001. This scaffold is private and unlicensed until distribution decisions are made.
