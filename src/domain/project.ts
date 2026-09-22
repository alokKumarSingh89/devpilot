import type { InventoryState } from './repository/inventory';
import type { AnalysisState } from './requirements/requirements';
import type { PrdInput, PrdState } from './document';
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_SOURCES = ['PRD', 'CODEBASE', 'PRD_AND_CODEBASE'] as const;
export type ProjectSource = typeof PROJECT_SOURCES[number];
export type ProjectLifecycleStatus = 'INITIALIZING' | 'READY';

export interface ProjectManifest {
  readonly inputs?: { readonly prd?: PrdInput };
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly status: ProjectLifecycleStatus;
    readonly source: ProjectSource;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly workspace: { readonly relativeRoot: '.' };
  readonly ai: { readonly reasoningModel: { readonly id: string; readonly vendor: string; readonly family: string } };
}

export type ProjectState =
  | { readonly status: 'NO_WORKSPACE' | 'AI_NOT_READY' | 'NOT_INITIALIZED' | 'LOADING' | 'WORKSPACE_SELECTION_REQUIRED' }
  | { readonly status: ProjectLifecycleStatus; readonly manifest: ProjectManifest; readonly prd?: PrdState; readonly analysis?: AnalysisState; readonly inventory?: InventoryState }
  | { readonly status: 'ERROR'; readonly message: string };
