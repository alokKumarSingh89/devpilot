import * as vscode from 'vscode';
import type { ProjectWorkspace, ProjectWorkspaceContext } from '../../application/projects/ports';

/** DP-003 uses the first folder as the root of a multi-root workspace. */
export class VscodeProjectWorkspace implements ProjectWorkspaceContext {
  current(): ProjectWorkspace | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    return { key: folder.uri.toString(), name: vscode.workspace.name ?? folder.name, folderName: folder.name };
  }
  isTrusted(): boolean { return vscode.workspace.isTrusted; }
}
