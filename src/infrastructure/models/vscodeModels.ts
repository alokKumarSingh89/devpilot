import * as vscode from 'vscode';
import type { ReasoningModel } from '../../domain/reasoningModel';
import type { LanguageModelGateway, ModelDiscovery, ModelSelectionStore, RequestCancellation } from '../../application/models/ports';
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

  dispose(): void {
    this.disposed = true;
    for (const source of this.activeSources) {
      source.cancel();
      source.dispose();
    }
    this.activeSources.clear();
  }

  async sendRequest(modelId: string, prompt: string, cancellation: RequestCancellation): Promise<string> {
    if (this.disposed) throw new ModelFailure('CANCELLED');
    const source = new vscode.CancellationTokenSource();
    this.activeSources.add(source);
    const subscription = cancellation.onCancellationRequested(() => source.cancel());
    try {
      checkCancellation(cancellation);
      checkCancellation(source.token);
      const models = await vscode.lm.selectChatModels({ id: modelId });
      checkCancellation(cancellation);
      checkCancellation(source.token);
      const model = models.find((candidate) => candidate.id === modelId);
      if (!model) throw new ModelFailure('NOT_FOUND');
      const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, source.token);
      let text = '';
      for await (const fragment of response.text) {
        checkCancellation(cancellation);
        checkCancellation(source.token);
        text += fragment;
        if (text.length > 8192) {
          source.cancel();
          throw new ModelFailure('PROVIDER');
        }
      }
      checkCancellation(cancellation);
      checkCancellation(source.token);
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
