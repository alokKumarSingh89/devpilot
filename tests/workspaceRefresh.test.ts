import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { ControlCenterViewProvider } from '../src/presentation/controlCenter/ControlCenterViewProvider';
import { activate } from '../src/extension';
vi.mock('../src/infrastructure/projects/VscodeProjectStorage', () => ({
  PROJECT_MANIFEST_PATH: '.devpilot/project.yaml',
  VscodeProjectStorage: class {
    async exists() { return false; }
    async read() { return undefined; }
    async write() { /* Model/workspace regression tests isolate project storage. */ }
  },
}));



const host = vi.hoisted(() => {
  const folderListeners = new Set<() => void>();
  return {
    folderListeners,
    workspace: {
      isTrusted: true, createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) }),
      name: undefined,
      workspaceFolders: undefined as { name: string; uri: { scheme: string; toString(): string } }[] | undefined,
      onDidChangeWorkspaceFolders: (listener: () => void) => {
        folderListeners.add(listener);
        return { dispose: () => { folderListeners.delete(listener); } };
      },
    },
    registerView: vi.fn((_id: string, _provider: ControlCenterViewProvider) => ({ dispose: vi.fn() })),
  };
});

vi.mock('vscode', () => ({
  workspace: host.workspace,
  lm: { selectChatModels: async () => [], onDidChangeChatModels: () => ({ dispose() {} }) },
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }), registerWebviewViewProvider: host.registerView },
  commands: { registerCommand: () => ({ dispose: vi.fn() }) },
  Uri: { joinPath: (_base: vscode.Uri, ...segments: string[]) => ({ toString: () => segments.join('/') }) },
}));

function createView() {
  const disposeListeners = new Set<() => void>();
  const webview = {
    html: '',
    options: {} as vscode.WebviewOptions,
    cspSource: 'https://*.vscode-cdn.net',
    asWebviewUri: (uri: vscode.Uri) => uri,
  };
  // This test double supplies only the host API surface used by the provider.
  const view = {
    webview,
    onDidDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => { disposeListeners.delete(listener); } };
    },
  } as unknown as vscode.WebviewView;
  return { view, webview, disposeListeners };
}

describe('workspace refresh through extension activation', () => {
  let subscriptions: vscode.Disposable[];
  let provider: ControlCenterViewProvider;

  beforeEach(() => {
    host.workspace.workspaceFolders = undefined;
    host.folderListeners.clear();
    host.registerView.mockClear();
    subscriptions = [];
    activate({ extensionUri: {}, subscriptions, workspaceState: { get: () => undefined }, languageModelAccessInformation: { onDidChange: () => ({ dispose() {} }), canSendRequest: () => true } } as unknown as vscode.ExtensionContext);
    const registration = host.registerView.mock.calls[0];
    if (!registration) {
      throw new Error('Control Center provider was not registered');
    }
    provider = registration[1];
  });

  afterEach(() => {
    subscriptions.forEach((subscription) => subscription.dispose());
  });

  const fireFolderChange = (): void => {
    host.folderListeners.forEach((listener) => listener());
  };

  it('renders folder names even when the workspace-level name is undefined', () => {
    host.workspace.workspaceFolders = [{ name: 'actual-folder', uri: { scheme: 'file', toString: () => 'file:///actual-folder' } }];
    const { view, webview } = createView();
    provider.resolveWebviewView(view);
    expect(webview.html).toContain('<li>actual-folder</li>');
    expect(webview.options.enableScripts).toBe(false);
    expect(webview.options.enableCommandUris).toEqual(['devpilot.scanCodebase', 'devpilot.openRepositoryInventory', 'devpilot.analyzePrd', 'devpilot.openRequirements', 'devpilot.openFolder', 'devpilot.refreshModels', 'devpilot.selectModel', 'devpilot.clearModel', 'devpilot.testModel', 'devpilot.initializeProject', 'devpilot.selectPrd', 'devpilot.refreshProject', 'devpilot.selectProjectWorkspace']);
    expect(webview.html).toContain('Content-Security-Policy');
  });

  it('updates the same view on folder additions, removals, and renames', () => {
    const { view, webview } = createView();
    provider.resolveWebviewView(view);
    expect(webview.html).toContain('No workspace open');
    host.workspace.workspaceFolders = [{ name: 'api', uri: { scheme: 'file', toString: () => 'file:///api' } }, { name: 'web', uri: { scheme: 'file', toString: () => 'file:///web' } }];
    fireFolderChange();
    expect(webview.html).toContain('<li>api</li><li>web</li>');
    host.workspace.workspaceFolders = [{ name: 'renamed', uri: { scheme: 'file', toString: () => 'file:///renamed' } }];
    fireFolderChange();
    expect(webview.html).toContain('<li>renamed</li>');
    expect(webview.html).not.toContain('<li>web</li>');
    host.workspace.workspaceFolders = [];
    fireFolderChange();
    expect(webview.html).toContain('No workspace open');
    expect(webview.html).toContain('Open a folder to start using DevPilot.');
  });

  it('reads fresh state when resolving a view after changes or disposal', () => {
    host.workspace.workspaceFolders = [{ name: 'before-resolve', uri: { scheme: 'file', toString: () => 'file:///before-resolve' } }];
    fireFolderChange();
    const first = createView();
    provider.resolveWebviewView(first.view);
    expect(first.webview.html).toContain('<li>before-resolve</li>');
    first.disposeListeners.forEach((listener) => listener());
    expect(first.disposeListeners.size).toBe(0);
    const oldHtml = first.webview.html;
    host.workspace.workspaceFolders = [{ name: 'after-dispose', uri: { scheme: 'file', toString: () => 'file:///after-dispose' } }];
    fireFolderChange();
    expect(first.webview.html).toBe(oldHtml);
    const second = createView();
    provider.resolveWebviewView(second.view);
    expect(second.webview.html).toContain('<li>after-dispose</li>');
  });

  it('disposes folder and view listeners through extension subscriptions', () => {
    const { view, webview, disposeListeners } = createView();
    provider.resolveWebviewView(view);
    expect(host.folderListeners.size).toBe(1);
    subscriptions.forEach((subscription) => subscription.dispose());
    expect(host.folderListeners.size).toBe(0);
    expect(disposeListeners.size).toBe(0);
    const oldHtml = webview.html;
    host.workspace.workspaceFolders = [{ name: 'after-shutdown', uri: { scheme: 'file', toString: () => 'file:///after-shutdown' } }];
    fireFolderChange();
    provider.refresh();
    expect(webview.html).toBe(oldHtml);
  });
});
