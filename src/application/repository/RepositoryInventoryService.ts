import type { ProjectManifest } from '../../domain/project';
import { ProjectFailure } from '../../domain/ProjectFailure';
import { InventoryFailure } from '../../domain/repository/InventoryFailure';
import type { InventoryState } from '../../domain/repository/inventory';
import { validateInventory } from '../../domain/repository/validateInventory';
import type { RequestCancellation } from '../models/ports';
import type { ProjectWorkspace, ProjectWorkspaceContext, ProjectStorage } from '../projects/ports';
import { InventoryCancellation } from './InventoryCancellation';
import type { RepositoryDiscovery, GitMetadataReader, InventoryStorage } from './ports';
import { buildInventory } from './detection/buildInventory';
export function safeInventoryFailure(error: unknown): InventoryFailure | ProjectFailure {
  return error instanceof InventoryFailure || error instanceof ProjectFailure ? error : new InventoryFailure('SCAN_FAILED');
}
export class RepositoryInventoryService {
  private active: { key: string; token: InventoryCancellation } | undefined;
  private disposed = false;
  private readonly observed = new Map<string, string>();
  private readonly failures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly workspace: ProjectWorkspaceContext, private readonly projects: Pick<ProjectStorage, 'read'>,
    private readonly discovery: RepositoryDiscovery, private readonly git: GitMetadataReader, private readonly storage: InventoryStorage,
    private readonly now: () => Date) {}
  onDidChange(listener: () => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  private notify(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }
  dispose(): void { this.disposed = true; this.active?.token.cancel(); this.listeners.clear(); this.observed.clear(); this.failures.clear(); }
  private current(expected?: ProjectWorkspace): ProjectWorkspace {
    if (this.disposed) throw new InventoryFailure('CANCELLED');
    const workspace = this.workspace.current();
    if (!workspace) throw new ProjectFailure(this.workspace.needsSelection?.() ? 'WORKSPACE_SELECTION_REQUIRED' : 'NO_WORKSPACE');
    if (!this.workspace.isTrusted()) throw new ProjectFailure('UNTRUSTED');
    if (expected && expected.key !== workspace.key) throw new InventoryFailure('CONFLICT');
    return workspace;
  }
  private check(token: RequestCancellation): void { if (token.isCancellationRequested || this.disposed) throw new InventoryFailure('CANCELLED'); }
  private async project(workspace: ProjectWorkspace): Promise<ProjectManifest> {
    this.current(workspace); const manifest = await this.projects.read(workspace);
    if (!manifest) throw new InventoryFailure('PROJECT_REQUIRED');
    if (manifest.project.source === 'PRD' || manifest.project.status !== 'INITIALIZING') throw new InventoryFailure('SOURCE_NOT_ALLOWED');
    this.current(workspace); return manifest;
  }
  async evaluate(workspace: ProjectWorkspace, project: ProjectManifest): Promise<InventoryState> {
    if (this.active?.key === workspace.key) return { status: 'SCANNING' };
    try {
      const inventory = await this.storage.read(workspace); const key = `${workspace.key}:${project.project.id}`;
      const message = this.failures.get(key);
      if (message) return { status: 'FAILED', message, ...(inventory ? { inventory } : {}) };
      if (!inventory) return { status: 'NOT_SCANNED' };
      const observed = this.observed.get(key);
      const stale = inventory.generated.projectId !== project.project.id || observed !== undefined && observed !== inventory.generated.repositoryFingerprint;
      return { status: stale ? 'STALE' : 'SCANNED', inventory, checked: observed !== undefined };
    } catch (error) { return { status: 'FAILED', message: safeInventoryFailure(error).message }; }
  }
  scan(token: RequestCancellation): Promise<void> { return this.run(token, true); }
  /** Explicit freshness evaluation; ordinary UI/manifest refresh only loads the artifact. */
  refresh(token: RequestCancellation): Promise<void> { return this.run(token, false); }
  private async run(cancellation: RequestCancellation, persist: boolean): Promise<void> {
    if (this.active) throw new InventoryFailure('BUSY');
    const workspace = this.current(); const token = new InventoryCancellation(cancellation);
    this.active = { key: workspace.key, token }; this.notify();
    let key: string | undefined;
    try {
      this.check(token); const project = await this.project(workspace); key = `${workspace.key}:${project.project.id}`; this.failures.delete(key);
      if (!persist && !await this.storage.read(workspace)) return;
      const snapshot = await this.discovery.discover(workspace, token); this.check(token);
      const git = await this.git.read(workspace).catch(() => ({ available: false as const })); this.check(token);
      const inventory = validateInventory(buildInventory(snapshot, git, workspace.folderName, project.project.id, this.now().toISOString()));
      const beforeCommit = async (): Promise<void> => {
        this.check(token); this.current(workspace);
        if (JSON.stringify(await this.project(workspace)) !== JSON.stringify(project)) throw new InventoryFailure('CONFLICT');
        this.check(token);
      };
      await beforeCommit();
      if (persist) await this.storage.write(workspace, inventory, beforeCommit);
      this.observed.set(key, inventory.generated.repositoryFingerprint);
    } catch (error) {
      const failure = token.isCancellationRequested ? new InventoryFailure('CANCELLED') : safeInventoryFailure(error);
      if (key && failure.code !== 'CANCELLED') this.failures.set(key, failure.message);
      throw failure;
    } finally { token.dispose(); this.active = undefined; this.notify(); }
  }
  async inventoryWorkspace(): Promise<ProjectWorkspace> {
    const workspace = this.current();
    if (!await this.projects.read(workspace)) throw new InventoryFailure('PROJECT_REQUIRED');
    if (!await this.storage.read(workspace)) throw new InventoryFailure('NO_INVENTORY');
    this.current(workspace); return workspace;
  }
}
