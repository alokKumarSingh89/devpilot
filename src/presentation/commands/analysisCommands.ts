import * as vscode from 'vscode';
import type { PrdAnalysisService } from '../../application/analysis/PrdAnalysisService';
import { safeAnalysisFailure } from '../../application/analysis/safeAnalysisFailure';
import type { ProjectService } from '../../application/projects/ProjectService';
import { REQUIREMENTS_PATH } from '../../infrastructure/requirements/VscodeRequirementsStorage';

export function registerAnalysisCommands(
  analysis: PrdAnalysisService, projects: ProjectService,
  chooseWorkspace: () => Promise<boolean>, log: (message: string) => void,
): vscode.Disposable[] {
  const run = async (operation: () => Promise<void>): Promise<void> => {
    try { if (await chooseWorkspace()) await operation(); }
    catch (error) {
      const failure = safeAnalysisFailure(error);
      log(`PRD analysis: ${failure.code}`);
      if (failure.code === 'CANCELLED') await vscode.window.showInformationMessage(failure.message);
      else await vscode.window.showWarningMessage(failure.message);
    } finally { await projects.refresh(); }
  };
  return [
    vscode.commands.registerCommand('devpilot.analyzePrd', () => run(async () => {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DevPilot: Analyze PRD', cancellable: true },
        async (_progress, token) => analysis.analyze(token));
      await vscode.window.showInformationMessage('Requirements generated. Review the artifact; the project remains Initializing.');
    })),
    vscode.commands.registerCommand('devpilot.openRequirements', () => run(async () => {
      const workspace = await analysis.requirementsWorkspace();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.parse(workspace.key), REQUIREMENTS_PATH));
      await vscode.window.showTextDocument(document, { preview: false });
    })),
  ];
}
