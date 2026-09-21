export const DEFAULT_MAX_DOCUMENT_BYTES = 1024 * 1024;
export const HARD_MAX_DOCUMENT_BYTES = 16 * DEFAULT_MAX_DOCUMENT_BYTES;
export const MAX_DISCOVERY_FILES = 500;
export const MAX_DOCUMENT_CANDIDATES = 50;
export const EXCLUDED_DOCUMENT_DIRECTORIES = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'vendor', '.devpilot'] as const;
export type DocumentFormat = 'markdown' | 'text';
export interface DocumentCandidate {
  readonly relativePath: string;
  readonly fileName: string;
  readonly kind: DocumentFormat;
  readonly score: number;
  readonly reasons: readonly string[];
}
export interface PrdInput {
  readonly relativePath: string;
  readonly format: DocumentFormat;
  readonly sizeBytes: number;
  readonly importedAt: string;
  readonly contentHash: string;
}
export type PrdState =
  | { readonly status: 'NOT_SELECTED' }
  | { readonly status: 'SELECTED' | 'MISSING' | 'CHANGED'; readonly input: PrdInput }
  | { readonly status: 'ERROR'; readonly input: PrdInput; readonly message: string };

export function documentSizeLimit(configured: unknown): number {
  return typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0 && configured <= HARD_MAX_DOCUMENT_BYTES
    ? configured : DEFAULT_MAX_DOCUMENT_BYTES;
}
