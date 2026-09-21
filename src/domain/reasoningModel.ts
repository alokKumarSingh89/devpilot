/** A reasoning model is not a coding agent. */
export interface ReasoningModel {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
  readonly maxInputTokens?: number;
}

export type ModelState =
  | { readonly status: 'NO_MODEL'; readonly models: readonly ReasoningModel[] }
  | { readonly status: 'SELECTION_REQUIRED'; readonly models: readonly ReasoningModel[] }
  | { readonly status: 'READY'; readonly models: readonly ReasoningModel[]; readonly selected: ReasoningModel };

export function resolveModelState(models: readonly ReasoningModel[], selectedId: string | undefined): ModelState {
  if (models.length === 0) return { status: 'NO_MODEL', models };
  const selected = models.find((model) => model.id === selectedId);
  return selected ? { status: 'READY', models, selected } : { status: 'SELECTION_REQUIRED', models };
}
