import { PrdAnalysisService } from './application/analysis/PrdAnalysisService';
import { VscodeRequirementsStorage, REQUIREMENTS_PATH } from './infrastructure/requirements/VscodeRequirementsStorage';
import { registerAnalysisCommands } from './presentation/commands/analysisCommands';
import { PrdImportService } from './application/documents/PrdImportService';
import { PrdStateService } from './application/documents/PrdStateService';
import { VscodeDocumentDiscovery } from './infrastructure/documents/VscodeDocumentDiscovery';
import { VscodeDocumentReader } from './infrastructure/documents/VscodeDocumentReader';
import { registerPrdCommands } from './presentation/commands/prdCommands';
import { selectProjectWorkspace } from './presentation/commands/workspaceSelection';
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
  const storage = new VscodeProjectStorage(log);
  const reader = new VscodeDocumentReader();
  const analysis = new PrdAnalysisService(workspace, storage, reader, models, gateway, new VscodeRequirementsStorage(log), () => new Date());
  const projects = new ProjectService(workspace, models, storage, randomUUID, () => new Date(), new PrdStateService(reader), analysis);
  const prds = new PrdImportService(workspace, storage, new VscodeDocumentDiscovery(), reader, () => new Date());
  const chooseWorkspace = async (force = false): Promise<boolean> => {
    const previous = workspace.current()?.key;
    const selected = await selectProjectWorkspace(workspace, force);
    if (selected && workspace.current()?.key !== previous) await projects.refresh();
    return selected;
  };
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
  const requirementsWatcher = vscode.workspace.createFileSystemWatcher(`**/${REQUIREMENTS_PATH}`);
  context.subscriptions.push(
    analysis, requirementsWatcher, analysis.onDidChange(refreshProjects),
    requirementsWatcher.onDidCreate(refreshProjects), requirementsWatcher.onDidChange(refreshProjects), requirementsWatcher.onDidDelete(refreshProjects),
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
    ...registerModelCommands(models), registerProjectCommands(projects, log, chooseWorkspace),
    ...registerPrdCommands(prds, projects, chooseWorkspace, log),
    ...registerAnalysisCommands(analysis, projects, chooseWorkspace, log),
  );
  refreshProjects();
  refreshModels();
}
