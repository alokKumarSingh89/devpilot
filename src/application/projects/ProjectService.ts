import type { PrdStateService } from '../documents/PrdStateService';
import type { ReasoningModel } from '../../domain/reasoningModel';
import { ProjectFailure } from '../../domain/ProjectFailure';
import { PROJECT_SCHEMA_VERSION, type ProjectManifest, type ProjectSource, type ProjectState } from '../../domain/project';
import { isProjectSource, validateProjectManifest } from '../../domain/validateProjectManifest';
import type { ReasoningModelService } from '../models/ReasoningModelService';
import type { ProjectStorage, ProjectWorkspace, ProjectWorkspaceContext } from './ports';

export class ProjectService {
  state: ProjectState = { status: 'LOADING' };
  private readonly listeners = new Set<() => void>();
  private refreshRevision = 0;
  private initializing = false;
  private disposed = false;

  constructor(
    private readonly workspace: ProjectWorkspaceContext,
    private readonly models: Pick<ReasoningModelService, 'state' | 'requireReady'>,
    private readonly storage: ProjectStorage,
    private readonly createId: () => string,
    private readonly now: () => Date,
    private readonly prdState?: PrdStateService,
  ) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  dispose(): void { this.disposed = true; this.refreshRevision++; this.listeners.clear(); }
  private notify(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.refreshRevision;
    const workspace = this.workspace.current();
    this.state = { status: workspace ? 'LOADING' : this.workspace.needsSelection?.() ? 'WORKSPACE_SELECTION_REQUIRED' : 'NO_WORKSPACE' };
    this.notify();
    if (!workspace) return;
    let state: ProjectState;
    try {
      const manifest = await this.storage.read(workspace);
      state = manifest ? { status: manifest.project.status, manifest, ...(this.prdState ? { prd: await this.prdState.evaluate(workspace, manifest.inputs?.prd) } : {}) }
        : { status: this.models.state.status === 'READY' ? 'NOT_INITIALIZED' : 'AI_NOT_READY' };
    } catch (error) {
      state = { status: 'ERROR', message: error instanceof ProjectFailure ? error.message : new ProjectFailure('READ_FAILED').message };
    }
    if (!this.disposed && revision === this.refreshRevision && this.workspace.current()?.key === workspace.key) {
      this.state = state;
      this.notify();
    }
  }

  private assertWorkspace(expected?: ProjectWorkspace): ProjectWorkspace {
    const current = this.workspace.current();
    if (!current) throw new ProjectFailure(this.workspace.needsSelection?.() ? 'WORKSPACE_SELECTION_REQUIRED' : 'NO_WORKSPACE');
    if (this.disposed || (expected && current.key !== expected.key)) throw new ProjectFailure('WORKSPACE_CHANGED');
    if (!this.workspace.isTrusted()) throw new ProjectFailure('UNTRUSTED');
    return current;
  }

  private async prepareInitialization(expected?: ProjectWorkspace): Promise<{ workspace: ProjectWorkspace; selected: ReasoningModel }> {
    const workspace = this.assertWorkspace(expected);
    if (await this.storage.exists(workspace)) {
      await this.storage.read(workspace); // Report malformed/future schemas distinctly.
      throw new ProjectFailure('ALREADY_EXISTS');
    }
    const { selected } = await this.models.requireReady();
    this.assertWorkspace(workspace);
    return { workspace, selected };
  }

  /** Preflight before prompting; initialize repeats it after the choice. */
  async prepare(): Promise<ProjectWorkspace> {
    return (await this.prepareInitialization()).workspace;
  }

  async initialize(source: ProjectSource, expected?: ProjectWorkspace): Promise<ProjectManifest> {
    if (this.initializing) throw new ProjectFailure('BUSY');
    this.initializing = true;
    try {
      this.assertWorkspace(expected);
      if (!isProjectSource(source)) throw new ProjectFailure('INVALID_SOURCE');
      const { workspace, selected } = await this.prepareInitialization(expected);
      this.assertWorkspace(workspace);
      const timestamp = this.now().toISOString();
      const manifest = validateProjectManifest({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        project: { id: this.createId(), name: workspace.name, status: 'INITIALIZING', source, createdAt: timestamp, updatedAt: timestamp },
        workspace: { relativeRoot: '.' },
        ai: { reasoningModel: { id: selected.id, vendor: selected.vendor, family: selected.family } },
      });
      try { await this.storage.write(workspace, manifest); }
      catch (error) { throw error instanceof ProjectFailure ? error : new ProjectFailure('WRITE_FAILED'); }
      await this.refresh();
      return manifest;
    } finally { this.initializing = false; }
  }
}
