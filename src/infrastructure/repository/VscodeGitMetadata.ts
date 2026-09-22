import * as vscode from 'vscode';
import type { GitMetadataReader } from '../../application/repository/ports';
import type { ProjectWorkspace } from '../../application/projects/ports';
import type { GitMetadata } from '../../domain/repository/inventory';
import { validateGitMetadata } from '../../domain/repository/validateInventory';
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
/** Reads the already-active built-in Git extension's cached state. No subprocess, activation, status command or remote access. */
export class VscodeGitMetadata implements GitMetadataReader {
  async read(workspace: ProjectWorkspace): Promise<GitMetadata> {
    try {
      const extension = vscode.extensions.getExtension<unknown>('vscode.git');
      if (!extension?.isActive) return { available: false };
      const exported = record(extension.exports);
      if (typeof exported.getAPI !== 'function') return { available: false };
      const api: unknown = exported.getAPI.call(extension.exports, 1);
      const repositories = record(api).repositories;
      if (!Array.isArray(repositories)) return { available: false };
      for (const value of repositories.slice(0, 100)) {
        const repository = record(value); const uri = repository.rootUri;
        if (!(uri instanceof vscode.Uri) || uri.toString() !== workspace.key) continue;
        const state = record(repository.state); const head = record(state.HEAD);
        const groups = [state.indexChanges, state.workingTreeChanges, state.mergeChanges];
        if (!groups.every(Array.isArray)) return { available: false };
        const untracked = state.untrackedChanges;
        return validateGitMetadata({ available: true, branch: head.name ?? null, headCommit: head.commit ?? null,
          dirty: groups.some((group) => Array.isArray(group) && group.length > 0) || Array.isArray(untracked) && untracked.length > 0 });
      }
      return { available: false };
    } catch { return { available: false }; }
  }
}
