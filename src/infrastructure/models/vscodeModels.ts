import { awaitCancellation } from '../../application/models/awaitCancellation';
import * as vscode from 'vscode';
import type { ReasoningModel } from '../../domain/reasoningModel';
import type { LanguageModelGateway, ModelDiscovery, ModelSelectionStore, RequestCancellation, ModelRequestOptions } from '../../application/models/ports';
import { checkCancellation, ModelFailure } from '../../application/models/ModelFailure';

function mapFailure(error: unknown): ModelFailure {
  if (error instanceof ModelFailure) return error;
  if (error instanceof vscode.CancellationError) return new ModelFailure('CANCELLED');
  if (error instanceof vscode.LanguageModelError) {
    if (error.code === 'NotFound') return new ModelFailure('NOT_FOUND');
    if (error.code === 'NoPermissions' || error.code === 'Blocked') return new ModelFailure('ACCESS');
  }
  return new ModelFailure('PROVIDER');
}

export class VscodeModelDiscovery implements ModelDiscovery {
  constructor(private readonly access: vscode.LanguageModelAccessInformation) {}

  async discover(): Promise<readonly ReasoningModel[]> {
    try {
      const models = await vscode.lm.selectChatModels();
      return models.filter((model) => this.access.canSendRequest(model) !== false).map((model) => ({
        id: model.id, name: model.name, vendor: model.vendor, family: model.family,
        ...(Number.isFinite(model.maxInputTokens) && model.maxInputTokens > 0
          ? { maxInputTokens: model.maxInputTokens } : {}),
      }));
    } catch (error) { throw mapFailure(error); }
  }
}

export class WorkspaceModelSelectionStore implements ModelSelectionStore {
  private static readonly key = 'devpilot.reasoningModelId';
  constructor(private readonly state: vscode.Memento) {}
  read(): string | undefined {
    const value = this.state.get<unknown>(WorkspaceModelSelectionStore.key);
    return typeof value === 'string' ? value : undefined;
  }
  async clear(): Promise<void> {
    await this.state.update(WorkspaceModelSelectionStore.key, undefined);
  }
  async write(id: string): Promise<void> {
    await this.state.update(WorkspaceModelSelectionStore.key, id);
  }
}

export class VscodeLanguageModelGateway implements LanguageModelGateway, vscode.Disposable {
  private readonly activeSources = new Set<vscode.CancellationTokenSource>();
  private disposed = false;
  constructor(private readonly log: (message: string) => void = () => undefined) {}
  private diagnostic(message: string): void {
    try { this.log(`PRD analysis transport: ${message}`); } catch { /* Diagnostics cannot fail a request. */ }
  }

  dispose(): void {
    this.disposed = true;
    for (const source of this.activeSources) {
      source.cancel();
      source.dispose();
    }
    this.activeSources.clear();
  }

  async sendRequest(modelId: string, prompt: string, cancellation: RequestCancellation, options?: ModelRequestOptions): Promise<string> {
    if (this.disposed) throw new ModelFailure('CANCELLED');
    const source = new vscode.CancellationTokenSource();
    this.activeSources.add(source);
    const subscription = cancellation.onCancellationRequested(() => source.cancel());
    try {
      checkCancellation(cancellation);
      checkCancellation(source.token);
      const models = await awaitCancellation(vscode.lm.selectChatModels({ id: modelId }), source.token);
      checkCancellation(cancellation);
      checkCancellation(source.token);
      const model = models.find((candidate) => candidate.id === modelId);
      if (!model) throw new ModelFailure('NOT_FOUND');
      const message = vscode.LanguageModelChatMessage.User(prompt);
      if (options) {
        if (model.vendor !== options.expectedModel.vendor || model.family !== options.expectedModel.family) throw new ModelFailure('NOT_FOUND');
        if (!Number.isSafeInteger(options.maxResponseCharacters) || options.maxResponseCharacters < 1 || options.maxResponseCharacters > 262144
          || !Number.isSafeInteger(options.outputHeadroomTokens) || options.outputHeadroomTokens < 4096) throw new ModelFailure('CONTEXT_LIMIT');
        const count = await awaitCancellation(model.countTokens(message, source.token), source.token);
        checkCancellation(cancellation);
        checkCancellation(source.token);
        const capacity = model.maxInputTokens;
        this.diagnostic(`inputTokens=${count}, maxInputTokens=${capacity}, outputHeadroomTokens=${options.outputHeadroomTokens}, framingTokens=256`);
        // maxInputTokens is not a total-context/output guarantee. Reserve both proportional slack and explicit headroom.
        if (!Number.isSafeInteger(capacity) || capacity <= 0 || !Number.isSafeInteger(count) || count < 1
          || count + 256 > Math.min(Math.floor(capacity * 0.75), capacity - options.outputHeadroomTokens)) throw new ModelFailure('CONTEXT_LIMIT');
      }
      const response = await awaitCancellation(model.sendRequest([message], options ? { justification: 'Analyze your explicitly imported PRD into structured requirements.' } : {}, source.token), source.token);
      let text = '';
      let fragments = 0;
      const iterator = response.text[Symbol.asyncIterator]();
      let complete = false;
      try {
        while (true) {
          const next = await awaitCancellation(iterator.next(), source.token);
          if (next.done) { complete = true; break; }
          const fragment = next.value;
          checkCancellation(cancellation);
          checkCancellation(source.token);
          text += fragment; fragments++;
          if (text.length > (options?.maxResponseCharacters ?? 8192)) {
            source.cancel();
            throw new ModelFailure(options ? 'RESPONSE_LIMIT' : 'PROVIDER');
          }
        }
      } finally {
        if (!complete) {
          source.cancel();
          // Do not wait for an uncooperative provider's iterator to close after cancellation.
          try { void Promise.resolve(iterator.return?.()).catch(() => undefined); } catch { /* Provider cleanup is best effort. */ }
        }
      }
      checkCancellation(cancellation);
      checkCancellation(source.token);
      if (options) this.diagnostic(`streamComplete=true, fragments=${fragments}, responseCharacters=${text.length}`);
      return text;
    } catch (error) {
      if (cancellation.isCancellationRequested || this.disposed) throw new ModelFailure('CANCELLED');
      throw mapFailure(error);
    } finally {
      subscription.dispose();
      if (this.activeSources.delete(source)) source.dispose();
    }
  }
}
