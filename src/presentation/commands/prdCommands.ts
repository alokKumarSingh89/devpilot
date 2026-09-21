import * as vscode from 'vscode';
import type { PrdImportService } from '../../application/documents/PrdImportService';
import type { ProjectService } from '../../application/projects/ProjectService';
import { DocumentFailure } from '../../domain/DocumentFailure';
import { ProjectFailure } from '../../domain/ProjectFailure';
import { relativeDocumentPath } from '../../infrastructure/documents/workspaceDocumentPath';

type DocumentChoice = vscode.QuickPickItem & ({ readonly action: 'browse' } | { readonly action: 'select'; readonly relativePath: string });

export function registerPrdCommands(
  prds: PrdImportService, projects: ProjectService,
  chooseWorkspace: (force?: boolean) => Promise<boolean>, log: (message: string) => void,
): vscode.Disposable[] {
  const run = async (operation: () => Promise<void>): Promise<void> => {
    try { await operation(); }
    catch (error) {
      const failure = error instanceof ProjectFailure || error instanceof DocumentFailure ? error : new DocumentFailure('READ_FAILED');
      log(`PRD: ${failure.code}`);
      await vscode.window.showWarningMessage(failure.message);
    }
  };
  return [
    vscode.commands.registerCommand('devpilot.selectPrd', () => run(async () => {
      if (!await chooseWorkspace()) return;
      const result = await prds.discover();
      const choices: DocumentChoice[] = result.candidates.map((candidate) => ({
        label: candidate.fileName, description: candidate.relativePath,
        detail: candidate.reasons.join(' · '), action: 'select', relativePath: candidate.relativePath,
      }));
      choices.push({ label: 'Browse for another document…', description: '.md, .markdown, or .txt inside the selected project folder', action: 'browse' });
      const selection = await vscode.window.showQuickPick(choices, {
        title: `Select PRD — ${result.workspace.folderName}`,
        placeHolder: result.limited ? 'Search limit reached. Explicitly select a result or browse for another document.' : 'Explicitly choose your requirements document; nothing is selected automatically',
      });
      if (!selection) return;
      let relativePath: string;
      if (selection.action === 'browse') {
        const files = await vscode.window.showOpenDialog({
          title: 'Select a requirements document inside the project folder', defaultUri: vscode.Uri.parse(result.workspace.key),
          canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          filters: { 'Requirements documents': ['md', 'markdown', 'txt'] }, openLabel: 'Import PRD',
        });
        const file = files?.[0];
        if (!file) return;
        relativePath = relativeDocumentPath(result.workspace, file);
      } else relativePath = selection.relativePath;
      await prds.import(result.workspace, result.manifest, relativePath);
      await projects.refresh();
      await vscode.window.showInformationMessage('PRD imported. The project remains Initializing; no AI analysis has run.');
    })),
    vscode.commands.registerCommand('devpilot.refreshProject', () => run(async () => {
      if (await chooseWorkspace()) await projects.refresh();
    })),
    vscode.commands.registerCommand('devpilot.selectProjectWorkspace', () => run(async () => {
      if (await chooseWorkspace(true)) await projects.refresh();
    })),
  ];
}
