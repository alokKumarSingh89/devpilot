export type ModelFailureCode = 'NO_MODEL' | 'SELECTION_REQUIRED' | 'NOT_FOUND' | 'ACCESS' | 'CANCELLED' | 'PROVIDER' | 'PERSISTENCE' | 'BUSY' | 'CONTEXT_LIMIT' | 'RESPONSE_LIMIT';

const messages: Record<ModelFailureCode, string> = {
  CONTEXT_LIMIT: 'The PRD analysis prompt cannot safely fit this model. Choose a model with a larger input limit; DevPilot will not truncate the PRD.',
  RESPONSE_LIMIT: 'The analysis response exceeded the supported limit. No requirements were saved.',
  NO_MODEL: 'No reasoning model is available. Refresh Models after enabling a model provider in VS Code.',
  SELECTION_REQUIRED: 'Select a DevPilot reasoning model before continuing.',
  NOT_FOUND: 'The selected model is no longer available. Refresh Models and select a model.',
  ACCESS: 'Model access was denied or blocked. Check provider permissions, sign-in, and quota, then refresh models.',
  CANCELLED: 'Model test cancelled.',
  PROVIDER: 'The model provider could not complete the operation. Try again or refresh models.',
  PERSISTENCE: 'The model preference could not be updated. Please try again.',
  BUSY: 'A model test is already running. Cancel it or wait for it to finish.',
};

export class ModelFailure extends Error {
  constructor(readonly code: ModelFailureCode) {
    super(messages[code]);
    this.name = 'ModelFailure';
  }
}

export function safeModelFailure(error: unknown): ModelFailure {
  return error instanceof ModelFailure ? error : new ModelFailure('PROVIDER');
}

export function checkCancellation(token: { readonly isCancellationRequested: boolean }): void {
  if (token.isCancellationRequested) throw new ModelFailure('CANCELLED');
}
