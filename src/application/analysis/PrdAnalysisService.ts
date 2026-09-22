import { reconcileRequirements } from './RequirementsReconciler';
import { AnalysisValidationFailure } from '../../domain/requirements/analysisContract';
import { validateRawModelStructure, verifyModelSourceReferences } from '../../domain/requirements/validateRawModelAnalysis';
import { analysisDiagnostic } from './analysisDiagnostics';
import { DocumentFailure } from '../../domain/DocumentFailure';
import { ProjectFailure } from '../../domain/ProjectFailure';
import type { ProjectManifest } from '../../domain/project';
import { AnalysisFailure } from '../../domain/requirements/AnalysisFailure';
import { MAX_ANALYSIS_RESPONSE_CHARACTERS, type AnalysisState } from '../../domain/requirements/requirements';
import { validateRequirementsArtifact } from '../../domain/requirements/validateRequirements';
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
    private readonly log: (message: string) => void = () => undefined,
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
    let stage = 'preflight';
    let requested = false;
    analysisDiagnostic(this.log, 'started');
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
      const prompt = compilePrdAnalysisPrompt(source.document.text);
      analysisDiagnostic(this.log, 'request', { modelId: selected.id, vendor: selected.vendor, family: selected.family, prdPath: source.input.relativePath, prdCharacters: source.document.text.length, prdBytes: source.document.sizeBytes, promptCharacters: prompt.length, outputHeadroomTokens: 8192 });
      stage = 'stream collection'; requested = true;
      const response = await this.gateway.sendRequest(selected.id, prompt, token, {
        purpose: 'prdAnalysis', expectedModel: { vendor: selected.vendor, family: selected.family }, maxResponseCharacters: MAX_ANALYSIS_RESPONSE_CHARACTERS, outputHeadroomTokens: 8192,
      });
      checkCancellation(token);
      analysisDiagnostic(this.log, 'response collected', { responseCharacters: response.length });
      stage = 'response extraction / JSON parsing'; analysisDiagnostic(this.log, stage);
      const parsed = parseAnalysisResponse(response);
      stage = 'RAW_SHAPE_VALIDATION'; analysisDiagnostic(this.log, stage);
      const candidate = validateRawModelStructure(parsed);
      analysisDiagnostic(this.log, 'RAW_SHAPE_VALIDATION', { result: 'success' });
      stage = 'SOURCE_VERIFICATION'; analysisDiagnostic(this.log, stage);
      const raw = verifyModelSourceReferences(candidate, source.document.text);
      analysisDiagnostic(this.log, 'SOURCE_VERIFICATION', { result: 'success' });
      stage = 'RECONCILIATION'; analysisDiagnostic(this.log, stage);
      const reconciled = reconcileRequirements(raw);
      for (const event of reconciled.events) analysisDiagnostic(this.log, 'RECONCILIATION', { ...event });
      analysisDiagnostic(this.log, 'RECONCILIATION', { result: 'success', changes: reconciled.events.length });
      stage = 'canonicalization'; analysisDiagnostic(this.log, stage);
      const content = canonicalizeRequirements(reconciled.content);
      stage = 'CANONICAL_VALIDATION'; analysisDiagnostic(this.log, stage);
      const artifact = validateRequirementsArtifact({
        schemaVersion: 1,
        generated: { generatedAt: this.now().toISOString(), projectId: snapshot.project.id,
          model: { id: selected.id, vendor: selected.vendor, family: selected.family },
          source: { relativePath: source.input.relativePath, contentHash: source.input.contentHash } },
        ...content,
      });
      analysisDiagnostic(this.log, 'CANONICAL_VALIDATION', { result: 'success' });
      const beforeCommit = async (): Promise<void> => {
        checkCancellation(token);
        await this.source(workspace, source.manifest);
        checkCancellation(token);
      };
      await beforeCommit();
      stage = 'PERSISTENCE'; analysisDiagnostic(this.log, stage);
      await this.requirements.write(workspace, artifact, beforeCommit);
      analysisDiagnostic(this.log, 'PERSISTENCE', { result: 'success' });
      analysisDiagnostic(this.log, 'completed');
      // Rename is the commit point. Cancellation after commit cannot truthfully undo a completed write.
    } catch (error) {
      let failure = token.isCancellationRequested ? new AnalysisFailure('CANCELLED') : safeAnalysisFailure(error);
      analysisDiagnostic(this.log, 'failed', { stage, code: failure.code, ...(error instanceof AnalysisValidationFailure ? { ...error.diagnostic } : {}) });
      if (requested && failure.code !== 'CANCELLED') {
        const existing = await this.requirements.read(workspace).then((artifact) => artifact ? 'present' : 'absent').catch(() => 'unknown');
        const outcome = existing === 'present' ? 'Analysis failed. The previous requirements artifact was preserved.'
          : existing === 'absent' ? 'Analysis failed. No requirements artifact was created.'
          : 'Analysis failed. The existing requirements artifact could not be verified.';
        const guidance = failure.code === 'CHANGED' ? ' Re-import the changed PRD before analyzing.' : ' See DevPilot Output for diagnostics.';
        failure.message = outcome + guidance;
      }
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
