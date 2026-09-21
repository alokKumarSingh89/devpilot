import * as vscode from 'vscode';
import type { ProjectWorkspace, ProjectWorkspaceContext } from '../../application/projects/ports';
import { ProjectFailure } from '../../domain/ProjectFailure';

/** Multi-root selection is explicit and session-local; no machine paths are persisted. */
export class VscodeProjectWorkspace implements ProjectWorkspaceContext {
  private selectedKey: string | undefined;
  folders(): ProjectWorkspace[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders.map((folder) => ({ key: folder.uri.toString(), name: folders.length === 1 ? vscode.workspace.name ?? folder.name : folder.name, folderName: folder.name }));
  }
  current(): ProjectWorkspace | undefined {
    const folders = this.folders();
    if (!folders.some((folder) => folder.key === this.selectedKey)) this.selectedKey = undefined;
    if (folders.length === 1) return folders[0];
    return folders.find((folder) => folder.key === this.selectedKey);
  }
  needsSelection(): boolean { return this.folders().length > 1 && !this.current(); }
  select(key: string): void {
    if (!this.folders().some((folder) => folder.key === key)) throw new ProjectFailure('WORKSPACE_CHANGED');
    this.selectedKey = key;
  }
  isTrusted(): boolean { return vscode.workspace.isTrusted; }
}
