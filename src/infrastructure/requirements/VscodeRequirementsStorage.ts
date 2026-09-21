import { ModelFailure } from '../../application/models/ModelFailure';
import { DocumentFailure } from '../../domain/DocumentFailure';
import { ProjectFailure } from '../../domain/ProjectFailure';
import * as vscode from 'vscode';
import { createHash, randomUUID } from 'node:crypto';
import type { RequirementsStorage } from '../../application/analysis/ports';
import type { ProjectWorkspace } from '../../application/projects/ports';
import { AnalysisFailure } from '../../domain/requirements/AnalysisFailure';
import { MAX_REQUIREMENTS_BYTES, type RequirementsArtifact } from '../../domain/requirements/requirements';
import { parseRequirementsYaml, serializeRequirementsYaml } from './requirementsYaml';

export const REQUIREMENTS_PATH = '.devpilot/product/requirements.yaml';
const digest = (bytes: Uint8Array | undefined): string | undefined => bytes && createHash('sha256').update(bytes).digest('hex');

export class VscodeRequirementsStorage implements RequirementsStorage {
  constructor(private readonly log: (message: string) => void) {}
  private uri(workspace: ProjectWorkspace, path: string): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.parse(workspace.key), path);
  }
  private async stat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try { return await vscode.workspace.fs.stat(uri); }
    catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined; throw error; }
  }
  private async directories(workspace: ProjectWorkspace): Promise<void> {
    for (const path of ['.devpilot', '.devpilot/product']) {
      const stat = await this.stat(this.uri(workspace, path));
      if (stat && stat.type !== vscode.FileType.Directory) throw new AnalysisFailure('INVALID_ARTIFACT');
    }
  }
  private async bytes(workspace: ProjectWorkspace): Promise<Uint8Array | undefined> {
    await this.directories(workspace);
    const uri = this.uri(workspace, REQUIREMENTS_PATH);
    const stat = await this.stat(uri);
    if (!stat) return undefined;
    if (stat.type !== vscode.FileType.File || stat.size > MAX_REQUIREMENTS_BYTES) throw new AnalysisFailure('INVALID_ARTIFACT');
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_REQUIREMENTS_BYTES) throw new AnalysisFailure('INVALID_ARTIFACT');
    return bytes;
  }
  async read(workspace: ProjectWorkspace): Promise<RequirementsArtifact | undefined> {
    try {
      const bytes = await this.bytes(workspace);
      if (!bytes) return undefined;
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new AnalysisFailure('INVALID_ARTIFACT'); }
      return parseRequirementsYaml(text);
    } catch (error) {
      if (error instanceof AnalysisFailure) throw error;
      throw new AnalysisFailure('READ_FAILED');
    }
  }
  async write(workspace: ProjectWorkspace, artifact: RequirementsArtifact, beforeCommit: () => Promise<void>): Promise<void> {
    const data = new TextEncoder().encode(serializeRequirementsYaml(artifact));
    const temporary = this.uri(workspace, `.devpilot/product/.requirements-${randomUUID()}.tmp`);
    let attempted = false;
    try {
      const previous = digest(await this.bytes(workspace));
      await beforeCommit();
      await vscode.workspace.fs.createDirectory(this.uri(workspace, '.devpilot/product'));
      await this.directories(workspace);
      attempted = true;
      await vscode.workspace.fs.writeFile(temporary, data);
      if (digest(await this.bytes(workspace)) !== previous) throw new AnalysisFailure('CONFLICT');
      // Last asynchronous preflight checks cancellation, root, project and source hash before publish.
      await beforeCommit();
      await vscode.workspace.fs.rename(temporary, this.uri(workspace, REQUIREMENTS_PATH), { overwrite: previous !== undefined });
    } catch (error) {
      // Application preflight failures are intentionally propagated with their safe typed messages.
      if (error instanceof vscode.FileSystemError) throw new AnalysisFailure(error.code === 'FileExists' ? 'CONFLICT' : 'WRITE_FAILED');
      if (error instanceof AnalysisFailure || error instanceof DocumentFailure || error instanceof ProjectFailure || error instanceof ModelFailure) throw error;
      throw new AnalysisFailure('WRITE_FAILED');
    } finally {
      if (attempted) {
        try { await vscode.workspace.fs.delete(temporary); }
        catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) this.log('Requirements temporary-file cleanup failed.'); }
      }
    }
  }
}
