import * as vscode from 'vscode';
import type { VscodeProjectWorkspace } from '../../infrastructure/projects/VscodeProjectWorkspace';

export async function selectProjectWorkspace(workspace: VscodeProjectWorkspace, force = false): Promise<boolean> {
  if (!force && !workspace.needsSelection()) return true;
  const folders = workspace.folders();
  if (folders.length <= 1) return true;
  const selected = await vscode.window.showQuickPick(folders.map((folder) => ({
    label: folder.folderName, description: folder.key, folder,
    ...(folder.key === workspace.current()?.key ? { detail: 'Current DevPilot project folder' } : {}),
  })), { title: 'Select DevPilot project folder', placeHolder: 'Choose the root for project metadata and PRD documents' });
  if (!selected) return false;
  workspace.select(selected.folder.key);
  return true;
}
