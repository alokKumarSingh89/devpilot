import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ProjectStorage, ProjectWorkspace } from '../../application/projects/ports';
import { ProjectFailure } from '../../domain/ProjectFailure';
import type { ProjectManifest } from '../../domain/project';
import { MAX_MANIFEST_BYTES, parseProjectYaml, serializeProjectYaml } from './projectYaml';

export const PROJECT_MANIFEST_PATH = '.devpilot/project.yaml';

export class VscodeProjectStorage implements ProjectStorage {
  constructor(private readonly log: (message: string) => void) {}

  private uri(workspace: ProjectWorkspace, ...path: string[]): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.parse(workspace.key), ...path);
  }
  private async stat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try { return await vscode.workspace.fs.stat(uri); }
    catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined;
      throw error;
    }
  }
  private failure(operation: string, error: unknown, fallback: 'READ_FAILED' | 'WRITE_FAILED'): ProjectFailure {
    const code = error instanceof ProjectFailure || error instanceof vscode.FileSystemError ? error.code : 'UnexpectedError';
    this.log(`${operation}: ${code}`);
    return error instanceof ProjectFailure ? error : new ProjectFailure(fallback);
  }
  private async checkDirectory(workspace: ProjectWorkspace): Promise<void> {
    const stat = await this.stat(this.uri(workspace, '.devpilot'));
    if (stat && ((stat.type & vscode.FileType.SymbolicLink) !== 0 || (stat.type & vscode.FileType.Directory) === 0)) {
      throw new ProjectFailure('INVALID_MANIFEST');
    }
  }
  async exists(workspace: ProjectWorkspace): Promise<boolean> {
    try {
      await this.checkDirectory(workspace);
      return (await this.stat(this.uri(workspace, PROJECT_MANIFEST_PATH))) !== undefined;
    } catch (error) { throw this.failure('exists', error, 'READ_FAILED'); }
  }
  async read(workspace: ProjectWorkspace): Promise<ProjectManifest | undefined> {
    try {
      await this.checkDirectory(workspace);
      const uri = this.uri(workspace, PROJECT_MANIFEST_PATH);
      const stat = await this.stat(uri);
      if (!stat) return undefined;
      if (stat.type !== vscode.FileType.File || stat.size > MAX_MANIFEST_BYTES) throw new ProjectFailure('INVALID_MANIFEST');
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new ProjectFailure('INVALID_MANIFEST');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new ProjectFailure('INVALID_MANIFEST'); }
      return parseProjectYaml(text);
    } catch (error) { throw this.failure('read', error, 'READ_FAILED'); }
  }
  async write(workspace: ProjectWorkspace, project: ProjectManifest): Promise<void> {
    // Serialize before any filesystem changes. The final file is never written in place.
    const data = new TextEncoder().encode(serializeProjectYaml(project));
    const directory = this.uri(workspace, '.devpilot');
    const destination = this.uri(workspace, PROJECT_MANIFEST_PATH);
    const temporary = this.uri(workspace, '.devpilot', `.project-${randomUUID()}.tmp`);
    let temporaryAttempted = false;
    try {
      if (await this.exists(workspace)) throw new ProjectFailure('ALREADY_EXISTS');
      await vscode.workspace.fs.createDirectory(directory);
      await this.checkDirectory(workspace);
      temporaryAttempted = true;
      await vscode.workspace.fs.writeFile(temporary, data);
      await vscode.workspace.fs.rename(temporary, destination, { overwrite: false });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileExists') throw new ProjectFailure('ALREADY_EXISTS');
      throw this.failure('write', error, 'WRITE_FAILED');
    } finally {
      if (temporaryAttempted) {
        try { await vscode.workspace.fs.delete(temporary); }
        catch (error) {
          if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) this.log('Temporary manifest cleanup failed.');
        }
      }
    }
  }
}
