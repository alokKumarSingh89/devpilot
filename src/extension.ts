import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { getControlCenterState } from './application/controlCenterState';
import { ReasoningModelService } from './application/models/ReasoningModelService';
import { ProjectService } from './application/projects/ProjectService';
import { VscodeLanguageModelGateway, VscodeModelDiscovery, WorkspaceModelSelectionStore } from './infrastructure/models/vscodeModels';
import { VscodeProjectStorage, PROJECT_MANIFEST_PATH } from './infrastructure/projects/VscodeProjectStorage';
import { VscodeProjectWorkspace } from './infrastructure/projects/VscodeProjectWorkspace';
import { ControlCenterViewProvider } from './presentation/controlCenter/ControlCenterViewProvider';
import { registerModelCommands } from './presentation/commands/modelCommands';
import { registerProjectCommands } from './presentation/commands/projectCommands';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DevPilot');
  const log = (message: string): void => output.appendLine(message);
  const gateway = new VscodeLanguageModelGateway();
  const models = new ReasoningModelService(
    new VscodeModelDiscovery(context.languageModelAccessInformation),
    new WorkspaceModelSelectionStore(context.workspaceState), gateway,
  );
  const workspace = new VscodeProjectWorkspace();
  const projects = new ProjectService(workspace, models, new VscodeProjectStorage(log), randomUUID, () => new Date());
  const provider = new ControlCenterViewProvider(context.extensionUri, () => ({
    ...getControlCenterState(vscode.workspace.workspaceFolders?.map((folder) => ({
      name: folder.name, path: folder.uri.scheme === 'file' ? folder.uri.fsPath : folder.uri.toString(),
    }))),
    reasoning: { state: models.state, notice: models.notice, testResult: models.testResult, testing: models.testing },
    project: projects.state,
    projectFolderName: workspace.current()?.folderName,
  }));
  const refreshProjects = (): void => { void projects.refresh(); };
  const refreshModels = (): void => { void models.refresh().catch(() => undefined); };
  let observedModelState = models.state;
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${PROJECT_MANIFEST_PATH}`);
  context.subscriptions.push(
    output, provider, gateway, projects, watcher,
    projects.onDidChange(() => provider.refresh()),
    models.onDidChange(() => {
      provider.refresh();
      if (models.state !== observedModelState) {
        observedModelState = models.state;
        refreshProjects();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { refreshProjects(); provider.refresh(); }),
    watcher.onDidCreate(refreshProjects), watcher.onDidChange(refreshProjects), watcher.onDidDelete(refreshProjects),
    vscode.lm.onDidChangeChatModels(refreshModels),
    context.languageModelAccessInformation.onDidChange(refreshModels),
    vscode.window.registerWebviewViewProvider(ControlCenterViewProvider.viewType, provider),
    ...registerModelCommands(models), registerProjectCommands(projects, log),
  );
  refreshProjects();
  refreshModels();
}
