import { DocumentFailure } from '../../domain/DocumentFailure';
import { ProjectFailure } from '../../domain/ProjectFailure';
import type { ProjectManifest } from '../../domain/project';
import { AnalysisFailure } from '../../domain/requirements/AnalysisFailure';
import { MAX_ANALYSIS_RESPONSE_CHARACTERS, type AnalysisState } from '../../domain/requirements/requirements';
import { validateRequirementsArtifact, validateRequirementsContent } from '../../domain/requirements/validateRequirements';
import type { DocumentReader } from '../documents/ports';
import { checkCancellation, ModelFailure } from '../models/ModelFailure';
import type { ReasoningModelService } from '../models/ReasoningModelService';
import type { LanguageModelGateway, RequestCancellation } from '../models/ports';
import type { ProjectStorage, ProjectWorkspace, ProjectWorkspaceContext } from '../projects/ports';
import { AnalysisCancellation } from './AnalysisCancellation';
import { canonicalizeRequirements } from './canonicalizeRequirements';
import { compilePrdAnalysisPrompt } from './compilePrdAnalysisPrompt';
import { parseAnalysisResponse } from './parseAnalysisResponse';
import type { RequirementsStorage } from './ports';
import { safeAnalysisFailure } from './safeAnalysisFailure';

const signature = (manifest: ProjectManifest): string => JSON.stringify([manifest.project.id, manifest.inputs?.prd]);

export class PrdAnalysisService {
  private active: { workspace: ProjectWorkspace; token: AnalysisCancellation } | undefined;
  private disposed = false;
  private readonly failures = new Map<string, { signature: string; message: string }>();
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly workspace: ProjectWorkspaceContext,
    private readonly projects: Pick<ProjectStorage, 'read'>,
    private readonly reader: DocumentReader,
    private readonly models: Pick<ReasoningModelService, 'requireReady' | 'state'>,
    private readonly gateway: LanguageModelGateway,
    private readonly requirements: RequirementsStorage,
    private readonly now: () => Date,
  ) {}
  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  private notify(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }
  dispose(): void { this.disposed = true; this.active?.token.cancel(); this.failures.clear(); this.listeners.clear(); }

  private current(expected?: ProjectWorkspace): ProjectWorkspace {
    if (this.disposed) throw new AnalysisFailure('CANCELLED');
    const workspace = this.workspace.current();
    if (!workspace) throw new ProjectFailure(this.workspace.needsSelection?.() ? 'WORKSPACE_SELECTION_REQUIRED' : 'NO_WORKSPACE');
    if (expected && expected.key !== workspace.key) throw new AnalysisFailure('CONFLICT');
    if (!this.workspace.isTrusted()) throw new ProjectFailure('UNTRUSTED');
    return workspace;
  }
  private async source(workspace: ProjectWorkspace, expected?: ProjectManifest) {
    this.current(workspace);
    const manifest = await this.projects.read(workspace);
    if (!manifest) throw new DocumentFailure('PROJECT_REQUIRED');
    if (manifest.project.source === 'CODEBASE' || manifest.project.status !== 'INITIALIZING') throw new AnalysisFailure('SOURCE_NOT_ALLOWED');
    if (expected && JSON.stringify(manifest) !== JSON.stringify(expected)) throw new AnalysisFailure('CONFLICT');
    const input = manifest.inputs?.prd;
    if (!input) throw new AnalysisFailure('NOT_SELECTED');
    const document = await this.reader.read(workspace, input.relativePath);
    if (document.contentHash !== input.contentHash) throw new AnalysisFailure('CHANGED');
    this.current(workspace);
    return { manifest, input, document };
  }

  async evaluate(workspace: ProjectWorkspace, manifest: ProjectManifest): Promise<AnalysisState> {
    if (this.active?.workspace.key === workspace.key) return { status: 'ANALYZING' };
    try {
      const artifact = await this.requirements.read(workspace);
      const failure = this.failures.get(workspace.key);
      if (failure?.signature === signature(manifest)) return { status: 'FAILED', message: failure.message, ...(artifact ? { artifact } : {}) };
      if (!artifact) return { status: 'NOT_ANALYZED' };
      const input = manifest.inputs?.prd;
      const matches = artifact.generated.projectId === manifest.project.id && artifact.generated.source.contentHash === input?.contentHash
        && artifact.generated.source.relativePath === input.relativePath;
      return { status: matches ? 'ANALYZED' : 'STALE', artifact };
    } catch (error) { return { status: 'FAILED', message: safeAnalysisFailure(error).message }; }
  }

  async analyze(cancellation: RequestCancellation): Promise<void> {
    if (this.active) throw new AnalysisFailure('BUSY');
    const workspace = this.current();
    const token = new AnalysisCancellation(cancellation);
    this.active = { workspace, token };
    this.failures.delete(workspace.key);
    this.notify();
    let snapshot: ProjectManifest | undefined;
    try {
      checkCancellation(token);
      const source = await this.source(workspace);
      snapshot = source.manifest;
      checkCancellation(token);
      const { selected } = await this.models.requireReady();
      checkCancellation(token);
      await this.source(workspace, snapshot);
      checkCancellation(token);
      const modelState = this.models.state;
      if (modelState.status !== 'READY') throw new ModelFailure(modelState.status);
      if (modelState.selected.id !== selected.id) throw new ModelFailure('SELECTION_REQUIRED');
      const response = await this.gateway.sendRequest(selected.id, compilePrdAnalysisPrompt(source.document.text), token, {
        purpose: 'prdAnalysis', expectedModel: { vendor: selected.vendor, family: selected.family }, maxResponseCharacters: MAX_ANALYSIS_RESPONSE_CHARACTERS, outputHeadroomTokens: 4096,
      });
      checkCancellation(token);
      const content = canonicalizeRequirements(validateRequirementsContent(parseAnalysisResponse(response), source.document.text));
      const artifact = validateRequirementsArtifact({
        schemaVersion: 1,
        generated: { generatedAt: this.now().toISOString(), projectId: snapshot.project.id,
          model: { id: selected.id, vendor: selected.vendor, family: selected.family },
          source: { relativePath: source.input.relativePath, contentHash: source.input.contentHash } },
        ...content,
      });
      const beforeCommit = async (): Promise<void> => {
        checkCancellation(token);
        await this.source(workspace, source.manifest);
        checkCancellation(token);
      };
      await beforeCommit();
      await this.requirements.write(workspace, artifact, beforeCommit);
      // Rename is the commit point. Cancellation after commit cannot truthfully undo a completed write.
    } catch (error) {
      const failure = token.isCancellationRequested ? new AnalysisFailure('CANCELLED') : safeAnalysisFailure(error);
      if (failure.code !== 'CANCELLED') {
        snapshot ??= await this.projects.read(workspace).catch(() => undefined);
        if (snapshot) this.failures.set(workspace.key, { signature: signature(snapshot), message: failure.message });
      }
      throw failure;
    } finally {
      token.dispose(); this.active = undefined; this.notify();
    }
  }

  async requirementsWorkspace(): Promise<ProjectWorkspace> {
    const workspace = this.current();
    if (!await this.projects.read(workspace)) throw new DocumentFailure('PROJECT_REQUIRED');
    if (!await this.requirements.read(workspace)) throw new AnalysisFailure('NO_ARTIFACT');
    this.current(workspace);
    return workspace;
  }
}
