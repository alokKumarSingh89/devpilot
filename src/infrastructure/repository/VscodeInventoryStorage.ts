import { ProjectFailure } from '../../domain/ProjectFailure';
import * as vscode from 'vscode';
import { createHash, randomUUID } from 'node:crypto';
import type { InventoryStorage } from '../../application/repository/ports';
import type { ProjectWorkspace } from '../../application/projects/ports';
import { InventoryFailure } from '../../domain/repository/InventoryFailure';
import { MAX_INVENTORY_BYTES, INVENTORY_PATH, type Inventory } from '../../domain/repository/inventory';
import { parseInventoryYaml, serializeInventoryYaml } from './inventoryYaml';

const digest = (bytes: Uint8Array | undefined): string | undefined => bytes && createHash('sha256').update(bytes).digest('hex');

export class VscodeInventoryStorage implements InventoryStorage {
  constructor(private readonly log: (message: string) => void) {}
  private uri(workspace: ProjectWorkspace, path: string): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.parse(workspace.key), path);
  }
  private async stat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try { return await vscode.workspace.fs.stat(uri); }
    catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined; throw error; }
  }
  private async directories(workspace: ProjectWorkspace): Promise<void> {
    for (const path of ['.devpilot', '.devpilot/codebase']) {
      const stat = await this.stat(this.uri(workspace, path));
      if (stat && stat.type !== vscode.FileType.Directory) throw new InventoryFailure('INVALID_INVENTORY');
    }
  }
  private async bytes(workspace: ProjectWorkspace): Promise<Uint8Array | undefined> {
    await this.directories(workspace);
    const uri = this.uri(workspace, INVENTORY_PATH);
    const stat = await this.stat(uri);
    if (!stat) return undefined;
    if (stat.type !== vscode.FileType.File || stat.size > MAX_INVENTORY_BYTES) throw new InventoryFailure('INVALID_INVENTORY');
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_INVENTORY_BYTES) throw new InventoryFailure('INVALID_INVENTORY');
    return bytes;
  }
  async read(workspace: ProjectWorkspace): Promise<Inventory | undefined> {
    try {
      const bytes = await this.bytes(workspace);
      if (!bytes) return undefined;
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new InventoryFailure('INVALID_INVENTORY'); }
      return parseInventoryYaml(text);
    } catch (error) {
      if (error instanceof InventoryFailure) throw error;
      throw new InventoryFailure('READ_FAILED');
    }
  }
  async write(workspace: ProjectWorkspace, artifact: Inventory, beforeCommit: () => Promise<void>): Promise<void> {
    const data = new TextEncoder().encode(serializeInventoryYaml(artifact));
    const temporary = this.uri(workspace, `.devpilot/codebase/.inventory-${randomUUID()}.tmp`);
    let attempted = false;
    try {
      const previous = digest(await this.bytes(workspace));
      await beforeCommit();
      await vscode.workspace.fs.createDirectory(this.uri(workspace, '.devpilot/codebase'));
      await this.directories(workspace);
      attempted = true;
      await vscode.workspace.fs.writeFile(temporary, data);
      if (digest(await this.bytes(workspace)) !== previous) throw new InventoryFailure('CONFLICT');
      // Last asynchronous preflight checks cancellation, root, project and source hash before publish.
      await beforeCommit();
      await vscode.workspace.fs.rename(temporary, this.uri(workspace, INVENTORY_PATH), { overwrite: previous !== undefined });
    } catch (error) {
      // Application preflight failures are intentionally propagated with their safe typed messages.
      if (error instanceof vscode.FileSystemError) throw new InventoryFailure(error.code === 'FileExists' ? 'CONFLICT' : 'WRITE_FAILED');
      if (error instanceof InventoryFailure || error instanceof ProjectFailure) throw error;
      throw new InventoryFailure('WRITE_FAILED');
    } finally {
      if (attempted) {
        try { await vscode.workspace.fs.delete(temporary); }
        catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) this.log('Inventory temporary-file cleanup failed.'); }
      }
    }
  }
}
