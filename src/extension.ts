import * as vscode from 'vscode';
import { providerLabel } from './presentation/controlCenter/modelLabels';
import { getControlCenterState } from './application/controlCenterState';
import { ReasoningModelService } from './application/models/ReasoningModelService';
import { safeModelFailure } from './application/models/ModelFailure';
import { VscodeLanguageModelGateway, VscodeModelDiscovery, WorkspaceModelSelectionStore } from './infrastructure/models/vscodeModels';
import { ControlCenterViewProvider } from './presentation/controlCenter/ControlCenterViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const gateway = new VscodeLanguageModelGateway();
  const models = new ReasoningModelService(
    new VscodeModelDiscovery(context.languageModelAccessInformation),
    new WorkspaceModelSelectionStore(context.workspaceState), gateway,
  );
  const provider = new ControlCenterViewProvider(context.extensionUri, () => ({
    ...getControlCenterState(vscode.workspace.workspaceFolders?.map((folder) => ({
      name: folder.name, path: folder.uri?.scheme === 'file' ? folder.uri.fsPath : folder.uri?.toString(),
    }))),
    reasoning: { state: models.state, notice: models.notice, testResult: models.testResult, testing: models.testing },
  }));
  const run = async (operation: () => Promise<void>): Promise<void> => {
    try { await operation(); }
    catch (error) { await vscode.window.showWarningMessage(safeModelFailure(error).message); }
  };
  // Discovery errors appear in the view; automatic refreshes must not spam notifications.
  const refresh = (): void => { void models.refresh().catch(() => undefined); };

  context.subscriptions.push(
    provider, gateway,
    models.onDidChange(() => provider.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.lm.onDidChangeChatModels(refresh),
    context.languageModelAccessInformation.onDidChange(refresh),
    vscode.window.registerWebviewViewProvider(ControlCenterViewProvider.viewType, provider),
    vscode.commands.registerCommand('devpilot.openControlCenter', async () => {
      await vscode.commands.executeCommand(`${ControlCenterViewProvider.viewType}.focus`);
    }),
    vscode.commands.registerCommand('devpilot.openFolder', () => run(async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Open Folder',
      });
      const folder = folders?.[0];
      if (folder) await vscode.commands.executeCommand('vscode.openFolder', folder);
    })),
    vscode.commands.registerCommand('devpilot.refreshModels', () => run(() => models.refresh())),
    vscode.commands.registerCommand('devpilot.selectModel', () => run(async () => {
      await models.refresh();
      if (models.state.models.length === 0) return;
      const currentId = models.state.status === 'READY' ? models.state.selected.id : undefined;
      const selection = await vscode.window.showQuickPick(models.state.models.map((model) => ({
        label: model.name, description: providerLabel(model.vendor),
        detail: `${model.family}${model.id === currentId ? ' · Currently selected' : ''}`,
        picked: model.id === currentId, modelId: model.id,
      })), { title: 'Select DevPilot reasoning model', placeHolder: 'Explicitly select a model for reasoning, not a coding agent' });
      if (selection) await models.select(selection.modelId);
    })),
    vscode.commands.registerCommand('devpilot.clearModel', () => run(async () => {
      const confirmation = await vscode.window.showWarningMessage(
        "Clear DevPilot's selected reasoning model?",
        { modal: true, detail: "This only removes DevPilot's model selection. It does not change VS Code or GitHub Copilot configuration." },
        'Clear Model',
      );
      if (confirmation === 'Clear Model') await models.clear();
    })),
    vscode.commands.registerCommand('devpilot.initializeProject', () => run(async () => {
      await models.requireReady();
      await vscode.window.showInformationMessage('AI configuration is ready. Project initialization is not implemented in this version.');
    })),
    vscode.commands.registerCommand('devpilot.testModel', () => run(async () => {
      await vscode.commands.executeCommand(`${ControlCenterViewProvider.viewType}.focus`);
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'DevPilot: Test Model', cancellable: true,
      }, async (_progress, token) => models.testModel(token));
    })),
  );
  refresh();
}
