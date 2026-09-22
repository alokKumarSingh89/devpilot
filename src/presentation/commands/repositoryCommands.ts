import * as vscode from 'vscode';
import { safeInventoryFailure, type RepositoryInventoryService } from '../../application/repository/RepositoryInventoryService';
import type { ProjectService } from '../../application/projects/ProjectService';
import { INVENTORY_PATH } from '../../domain/repository/inventory';
export function registerRepositoryCommands(inventory: RepositoryInventoryService, projects: ProjectService, chooseWorkspace: () => Promise<boolean>, log: (message: string) => void): vscode.Disposable[] {
  const run = async (operation: () => Promise<void>): Promise<void> => {
    try { if (await chooseWorkspace()) await operation(); }
    catch (error) {
      const failure = safeInventoryFailure(error); log(`Repository inventory: ${failure.code}`);
      if (failure.code === 'CANCELLED') await vscode.window.showInformationMessage(failure.message);
      else await vscode.window.showWarningMessage(failure.message);
    } finally { await projects.refresh(); }
  };
  return [
    vscode.commands.registerCommand('devpilot.scanCodebase', () => run(async () => {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DevPilot: Scan Codebase', cancellable: true }, async (_progress, token) => inventory.scan(token));
      await vscode.window.showInformationMessage('Repository inventory saved. Review scan coverage in the Control Center; the project remains Initializing.');
    })),
    vscode.commands.registerCommand('devpilot.openRepositoryInventory', () => run(async () => {
      const workspace = await inventory.inventoryWorkspace();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.parse(workspace.key), INVENTORY_PATH));
      await vscode.window.showTextDocument(document, { preview: false });
    })),
  ];
}
