import type { ReasoningModel } from '../../domain/reasoningModel';

export interface ModelDiscovery {
  discover(): Promise<readonly ReasoningModel[]>;
}

export interface ModelSelectionStore {
  read(): string | undefined;
  write(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface RequestCancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface LanguageModelGateway {
  sendRequest(modelId: string, prompt: string, cancellation: RequestCancellation): Promise<string>;
}
