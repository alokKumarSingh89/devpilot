import { resolveModelState, type ModelState } from '../../domain/reasoningModel';
import { checkCancellation, ModelFailure, safeModelFailure } from './ModelFailure';
import type { LanguageModelGateway, ModelDiscovery, ModelSelectionStore, RequestCancellation } from './ports';

export interface ModelTestResult {
  readonly modelName: string;
  readonly response: string;
}

export class ReasoningModelService {
  state: ModelState = resolveModelState([], undefined);
  notice: string | undefined;
  testResult: ModelTestResult | undefined;
  testing = false;
  private selectionRevision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly discovery: ModelDiscovery,
    private readonly store: ModelSelectionStore,
    private readonly gateway: LanguageModelGateway,
  ) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private notify(): void { this.listeners.forEach((listener) => listener()); }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async discover(): Promise<void> {
    try {
      this.state = resolveModelState(await this.discovery.discover(), this.store.read());
      this.notice = undefined;
    } catch (error) {
      this.state = resolveModelState([], undefined);
      this.notice = safeModelFailure(error).message;
      throw safeModelFailure(error);
    } finally {
      this.notify();
    }
  }

  refresh(): Promise<void> { return this.enqueue(() => this.discover()); }

  select(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.discover();
      if (!this.state.models.some((model) => model.id === id)) throw new ModelFailure('SELECTION_REQUIRED');
      try { await this.store.write(id); }
      catch { throw new ModelFailure('PERSISTENCE'); }
      this.selectionRevision += 1;
      this.state = resolveModelState(this.state.models, id);
      this.testResult = undefined;
      this.notify();
    });
  }

  /** Clears only DevPilot's preference; catalog/provider configuration stays untouched. */
  clear(): Promise<void> {
    return this.enqueue(async () => {
      try { await this.store.clear(); }
      catch { throw new ModelFailure('PERSISTENCE'); }
      this.selectionRevision += 1;
      this.state = resolveModelState(this.state.models, undefined);
      this.testResult = undefined;
      this.notice = undefined;
      this.notify();
    });
  }

  /** Shared command/application gate; UI visibility is not authorization. */
  async requireReady(): Promise<Extract<ModelState, { status: 'READY' }>> {
    await this.refresh();
    if (this.state.status !== 'READY') throw new ModelFailure(this.state.status);
    return this.state;
  }

  /** Application gate: every request revalidates selection, even direct command calls. */
  async testModel(token: RequestCancellation): Promise<void> {
    if (this.testing) throw new ModelFailure('BUSY');
    this.testing = true;
    this.testResult = undefined;
    this.notice = undefined;
    this.notify();
    let requestRevision = this.selectionRevision;
    let requestedModelId: string | undefined;
    try {
      checkCancellation(token);
      const { selected } = await this.requireReady();
      checkCancellation(token);
      requestRevision = this.selectionRevision;
      requestedModelId = selected.id;
      const response = await this.gateway.sendRequest(
        selected.id, 'Reply with exactly DEV PILOT AI READY and nothing else.', token,
      );
      checkCancellation(token);
      if (requestRevision === this.selectionRevision) {
        this.testResult = { modelName: selected.name, response };
      }
    } catch (error) {
      const failure = token.isCancellationRequested ? new ModelFailure('CANCELLED') : safeModelFailure(error);
      if ((failure.code === 'NOT_FOUND' || failure.code === 'ACCESS')
        && requestRevision === this.selectionRevision && this.state.status === 'READY' && this.state.selected.id === requestedModelId) {
        // Do not leave a failed selection READY, even if a provider's catalog is stale.
        const failedId = this.state.selected.id;
        this.state = resolveModelState(this.state.models.filter((model) => model.id !== failedId), undefined);
      }
      if (requestRevision === this.selectionRevision) this.notice = failure.message;
      throw failure;
    } finally {
      this.testing = false;
      this.notify();
    }
  }
}
