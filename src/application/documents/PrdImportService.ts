import { DocumentFailure } from '../../domain/DocumentFailure';
import { ProjectFailure } from '../../domain/ProjectFailure';
import type { ProjectManifest } from '../../domain/project';
import { validateProjectManifest } from '../../domain/validateProjectManifest';
import type { ProjectUpdateStorage, ProjectWorkspace, ProjectWorkspaceContext } from '../projects/ports';
import type { DocumentDiscovery, DocumentReader } from './ports';

export class PrdImportService {
  private importing = false;
  constructor(
    private readonly workspace: ProjectWorkspaceContext,
    private readonly storage: ProjectUpdateStorage,
    private readonly discovery: DocumentDiscovery,
    private readonly reader: DocumentReader,
    private readonly now: () => Date,
  ) {}
  private assertWorkspace(expected?: ProjectWorkspace): ProjectWorkspace {
    const current = this.workspace.current();
    if (!current) throw new ProjectFailure(this.workspace.needsSelection?.() ? 'WORKSPACE_SELECTION_REQUIRED' : 'NO_WORKSPACE');
    if (expected && current.key !== expected.key) throw new ProjectFailure('WORKSPACE_CHANGED');
    if (!this.workspace.isTrusted()) throw new ProjectFailure('UNTRUSTED');
    return current;
  }
  private async project(workspace: ProjectWorkspace): Promise<ProjectManifest> {
    const manifest = await this.storage.read(workspace);
    if (!manifest) throw new DocumentFailure('PROJECT_REQUIRED');
    if (manifest.project.status !== 'INITIALIZING' || manifest.project.source === 'CODEBASE') throw new DocumentFailure('SOURCE_NOT_ALLOWED');
    return manifest;
  }
  async discover() {
    const workspace = this.assertWorkspace();
    const manifest = await this.project(workspace);
    const result = await this.discovery.discover(workspace);
    this.assertWorkspace(workspace);
    return { workspace, manifest, ...result };
  }
  async import(workspace: ProjectWorkspace, expected: ProjectManifest, relativePath: string): Promise<void> {
    if (this.importing) throw new DocumentFailure('BUSY');
    this.importing = true;
    try {
      this.assertWorkspace(workspace);
      const current = await this.project(workspace);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new ProjectFailure('CONFLICT');
      const document = await this.reader.read(workspace, relativePath);
      this.assertWorkspace(workspace);
      const importedAt = this.now().toISOString();
      const manifest = validateProjectManifest({
        ...current, project: { ...current.project, updatedAt: importedAt },
        inputs: { ...current.inputs, prd: {
          relativePath: document.relativePath, format: document.format, sizeBytes: document.sizeBytes,
          contentHash: document.contentHash, importedAt,
        } },
      });
      await this.storage.update(workspace, expected, manifest);
    } finally { this.importing = false; }
  }
}
