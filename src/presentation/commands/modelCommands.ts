import * as vscode from 'vscode';
import { providerLabel } from '../controlCenter/modelLabels';
import { ControlCenterViewProvider } from '../controlCenter/ControlCenterViewProvider';
import type { ReasoningModelService } from '../../application/models/ReasoningModelService';
import { safeModelFailure } from '../../application/models/ModelFailure';

export function registerModelCommands(models: ReasoningModelService): vscode.Disposable[] {
  const run = async (operation: () => Promise<void>): Promise<void> => {
    try { await operation(); }
    catch (error) { await vscode.window.showWarningMessage(safeModelFailure(error).message); }
  };
  return [
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
    vscode.commands.registerCommand('devpilot.testModel', () => run(async () => {
      await vscode.commands.executeCommand(`${ControlCenterViewProvider.viewType}.focus`);
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'DevPilot: Test Model', cancellable: true,
      }, async (_progress, token) => models.testModel(token));
    })),
  ];
}
