import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { activate } from '../src/extension';
vi.mock('../src/infrastructure/projects/VscodeProjectStorage', () => ({
  PROJECT_MANIFEST_PATH: '.devpilot/project.yaml',
  VscodeProjectStorage: class {
    async exists() { return false; }
    async read() { return undefined; }
    async write() { /* Model/workspace regression tests isolate project storage. */ }
  },
}));
function watcher() { return { dispose() {}, onDidCreate: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) }; }


const host = vi.hoisted(() => ({
  openDialog: vi.fn<() => Promise<vscode.Uri[] | undefined>>(),
  execute: vi.fn(async (..._args: unknown[]) => undefined),
  commands: new Map<string, () => Promise<void>>(),
  discover: vi.fn(),
  warning: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
  information: vi.fn(async (_message: string) => undefined),
  picker: vi.fn(async (_items: unknown[], _options: unknown) => undefined),
}));
vi.mock('vscode', () => ({
  lm: { selectChatModels: host.discover, onDidChangeChatModels: () => ({ dispose() {} }) },
  workspace: { isTrusted: true, createFileSystemWatcher: watcher, workspaceFolders: [{ name: 'test', uri: { toString: () => 'file:///test' } }], onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
  commands: { executeCommand: host.execute, registerCommand: (id: string, callback: () => Promise<void>) => {
    host.commands.set(id, callback);
    return { dispose: () => { host.commands.delete(id); } };
  } },
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    registerWebviewViewProvider: () => ({ dispose() {} }),
    showWarningMessage: host.warning,
    showInformationMessage: host.information,
    showQuickPick: host.picker,
    showOpenDialog: host.openDialog,
  },
}));

const model = { id: 'chosen', name: 'Example', vendor: 'copilot', family: 'example', maxInputTokens: 1024 };
let subscriptions: vscode.Disposable[];
let saved: string | undefined;
let update: ReturnType<typeof vi.fn>;
async function invoke(id: string) {
  const command = host.commands.get(id);
  if (!command) throw new Error(`Missing command ${id}`);
  await command();
}

beforeEach(async () => {
  host.commands.clear();
  host.openDialog.mockReset();
  host.execute.mockClear();
  host.discover.mockResolvedValue([model]);
  host.warning.mockReset();
  host.warning.mockResolvedValue(undefined);
  host.information.mockClear();
  host.picker.mockClear();
  saved = model.id;
  subscriptions = [];
  update = vi.fn(async (_key: string, value: string | undefined) => { saved = value; });
  activate({
    extensionUri: {}, subscriptions,
    workspaceState: { get: () => saved, update },
    languageModelAccessInformation: { canSendRequest: () => true, onDidChange: () => ({ dispose() {} }) },
  } as unknown as vscode.ExtensionContext);
  await invoke('devpilot.refreshModels');
});
afterEach(() => subscriptions.forEach((subscription) => subscription.dispose()));

describe('Clear Reasoning Model command confirmation', () => {
  it.each([undefined, 'Cancel'])('does not clear on dismissal or Cancel (%s)', async (answer) => {
    host.warning.mockResolvedValue(answer);
    await invoke('devpilot.clearModel');
    expect(saved).toBe(model.id);
    expect(update).not.toHaveBeenCalled();
    expect(host.warning).toHaveBeenCalledWith(
      "Clear DevPilot's selected reasoning model?",
      { modal: true, detail: "This only removes DevPilot's model selection. It does not change VS Code or GitHub Copilot configuration." },
      'Clear Model',
    );
  });

  it('clears only after explicit confirmation and blocks the project command afterward', async () => {
    host.warning.mockResolvedValue('Clear Model');
    await invoke('devpilot.clearModel');
    expect(saved).toBeUndefined();
    expect(update).toHaveBeenCalledExactlyOnceWith('devpilot.reasoningModelId', undefined);
    await invoke('devpilot.initializeProject');
    expect(host.information).not.toHaveBeenCalled();
    expect(host.warning).toHaveBeenLastCalledWith('Select a DevPilot reasoning model before continuing.');
  });
});

describe('project command gate and selection picker', () => {
  it('shows the source picker when READY and cancels without initializing', async () => {
    await invoke('devpilot.initializeProject');
    expect(host.picker).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ source: 'PRD' }), expect.objectContaining({ source: 'CODEBASE' }), expect.objectContaining({ source: 'PRD_AND_CODEBASE' })]), expect.anything());
    expect(host.information).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a direct project invocation when the model disappears', async () => {
    host.discover.mockResolvedValue([{ ...model, id: 'replacement' }]);
    await invoke('devpilot.initializeProject');
    expect(host.information).not.toHaveBeenCalled();
    expect(host.warning).toHaveBeenCalledWith('Select a DevPilot reasoning model before continuing.');
  });

  it('rejects a direct project invocation with zero models', async () => {
    host.discover.mockResolvedValue([]);
    await invoke('devpilot.initializeProject');
    expect(host.information).not.toHaveBeenCalled();
    expect(host.warning).toHaveBeenCalledWith(expect.stringContaining('No reasoning model is available'));
  });

  it('marks the current model in Quick Pick and preserves selection when cancelled', async () => {
    await invoke('devpilot.selectModel');
    expect(host.picker).toHaveBeenCalledWith([
      { label: 'Example', description: 'GitHub Copilot', detail: 'example · Currently selected', picked: true, modelId: 'chosen' },
    ], expect.anything());
    expect(update).not.toHaveBeenCalled();
    expect(saved).toBe(model.id);
  });
});


it('opens only a folder explicitly selected in the native dialog', async () => {
  host.openDialog.mockResolvedValue(undefined);
  await invoke('devpilot.openFolder');
  expect(host.execute).not.toHaveBeenCalled();
  const folder = { scheme: 'file', fsPath: '/projects/example' } as vscode.Uri;
  host.openDialog.mockResolvedValue([folder]);
  await invoke('devpilot.openFolder');
  expect(host.openDialog).toHaveBeenCalledWith({
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Open Folder',
  });
  expect(host.execute).toHaveBeenCalledExactlyOnceWith('vscode.openFolder', folder);
});
