import * as vscode from 'vscode';
import { getControlCenterState } from './application/controlCenterState';
import { ControlCenterViewProvider } from './presentation/controlCenter/ControlCenterViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ControlCenterViewProvider(
    context.extensionUri,
    () => getControlCenterState(vscode.workspace.workspaceFolders),
  );

  context.subscriptions.push(
    provider,
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.window.registerWebviewViewProvider(ControlCenterViewProvider.viewType, provider),
    vscode.commands.registerCommand('devpilot.openControlCenter', async () => {
      await vscode.commands.executeCommand(`${ControlCenterViewProvider.viewType}.focus`);
    }),
  );
}
