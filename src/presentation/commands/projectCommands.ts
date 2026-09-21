import * as vscode from 'vscode';
import type { ProjectService } from '../../application/projects/ProjectService';
import { ProjectFailure } from '../../domain/ProjectFailure';
import { ModelFailure } from '../../application/models/ModelFailure';
import type { ProjectSource } from '../../domain/project';

const sourceChoices: readonly (vscode.QuickPickItem & { source: ProjectSource })[] = [
  { label: 'Import PRD', description: 'Start from an existing product requirements document.', source: 'PRD' },
  { label: 'Analyze Existing Code', description: 'Start from the current repository/codebase.', source: 'CODEBASE' },
  { label: 'PRD + Existing Code', description: 'Compare intended requirements with the existing implementation.', detail: 'Recommended for an existing project with requirements.', source: 'PRD_AND_CODEBASE' },
];

export function registerProjectCommands(projects: ProjectService, log: (message: string) => void): vscode.Disposable {
  return vscode.commands.registerCommand('devpilot.initializeProject', async () => {
    try {
      const workspace = await projects.prepare();
      const selection = await vscode.window.showQuickPick(sourceChoices, {
        title: `Initialize DevPilot — ${workspace.folderName}`,
        placeHolder: 'How should DevPilot understand this project? No analysis will run yet.',
      });
      if (!selection) return;
      const manifest = await projects.initialize(selection.source, workspace);
      await vscode.window.showInformationMessage(`DevPilot project "${manifest.project.name}" initialized. Project intelligence has not been generated yet.`);
    } catch (error) {
      const failure = error instanceof ProjectFailure || error instanceof ModelFailure ? error : new ProjectFailure('WRITE_FAILED');
      log(`initializeProject: ${failure.code}`);
      await projects.refresh();
      await vscode.window.showWarningMessage(failure.message);
    }
  });
}
