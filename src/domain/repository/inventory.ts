export const INVENTORY_PATH = '.devpilot/codebase/inventory.yaml';
export const MAX_TOTAL_METADATA_BYTES = 4 * 1024 * 1024;
export const MAX_REPOSITORY_PATH_DEPTH = 32;
export const MAX_INVENTORY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_SCAN_LIMITS = { maxFiles: 5000, maxManifests: 200, maxImportantFiles: 100, maxMetadataBytes: 128 * 1024, maxPackages: 100 } as const;
export type ScanLimits = { readonly [K in keyof typeof DEFAULT_SCAN_LIMITS]: number };
export const HARD_SCAN_LIMITS: ScanLimits = { maxFiles: 20000, maxManifests: 500, maxImportantFiles: 300, maxMetadataBytes: 512 * 1024, maxPackages: 200 };
export const TRUNCATION_REASONS = ['MAX_FILE_COUNT', 'MAX_MANIFEST_COUNT', 'MAX_IMPORTANT_FILES', 'MAX_PACKAGE_COUNT', 'METADATA_SIZE_LIMIT', 'UNREADABLE_FILE', 'INVALID_METADATA', 'UNSAFE_PATH'] as const;
export type TruncationReason = typeof TRUNCATION_REASONS[number];
export const MANIFEST_TYPES = ['NPM_PACKAGE', 'LOCKFILE', 'WORKSPACE_CONFIG', 'TYPESCRIPT_CONFIG', 'PYTHON_PROJECT', 'PYTHON_REQUIREMENTS', 'MAVEN', 'GRADLE', 'GO_MODULE', 'RUST_PACKAGE', 'DOCKER', 'CI_WORKFLOW', 'TOOL_CONFIG'] as const;
export type ManifestType = typeof MANIFEST_TYPES[number];
export const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Rust'] as const;
export const FRAMEWORKS = ['NestJS', 'React', 'Next.js', 'Angular', 'Vue', 'FastAPI', 'Django', 'Spring Boot', 'VS Code Extension'] as const;
export const TEST_FRAMEWORKS = ['Vitest', 'Jest', 'Pytest', 'JUnit'] as const;
export const BUILD_TOOLS = ['esbuild', 'Vite', 'Webpack', 'TypeScript', 'Turbo', 'Nx', 'Maven', 'Gradle', 'Go', 'Cargo'] as const;
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'poetry', 'uv', 'UNKNOWN'] as const;
export interface Evidence { readonly relativePath: string; readonly signal: string }
export type GitMetadata = { readonly available: false } | { readonly available: true; readonly branch: string | null; readonly headCommit: string | null; readonly dirty: boolean };
export interface Inventory {
  readonly schemaVersion: 1;
  readonly generated: { readonly generatedAt: string; readonly projectId: string; readonly repositoryFingerprint: string };
  readonly repository: { readonly workspaceName: string; readonly type: 'SINGLE_PACKAGE' | 'MONOREPO' | 'UNKNOWN'; readonly evidence: readonly Evidence[] };
  readonly languages: readonly { readonly name: typeof LANGUAGES[number]; readonly fileCount: number }[];
  readonly manifests: readonly { readonly relativePath: string; readonly type: ManifestType; readonly contentHash: string | null }[];
  readonly packages: readonly { readonly id: string; readonly name: string; readonly relativePath: string; readonly kind: 'APPLICATION' | 'LIBRARY' | 'SERVICE' | 'PACKAGE' | 'UNKNOWN'; readonly manifestPath: string }[];
  readonly frameworks: readonly { readonly name: typeof FRAMEWORKS[number]; readonly evidence: readonly Evidence[] }[];
  readonly testing: { readonly frameworks: readonly typeof TEST_FRAMEWORKS[number][]; readonly testFileCount: number };
  readonly tooling: { readonly packageManager: { readonly name: typeof PACKAGE_MANAGERS[number]; readonly conflict: boolean; readonly evidence: readonly Evidence[] }; readonly buildTools: readonly typeof BUILD_TOOLS[number][] };
  readonly git: GitMetadata;
  readonly importantFiles: readonly { readonly relativePath: string; readonly reason: string }[];
  readonly statistics: { readonly discoveredFiles: number; readonly consideredFiles: number; readonly ignoredFiles: number };
  readonly scan: { readonly truncated: boolean; readonly truncationReasons: readonly TruncationReason[]; readonly limits: ScanLimits };
}
export type InventoryState =
  | { readonly status: 'NOT_SCANNED' | 'SCANNING' }
  | { readonly status: 'SCANNED' | 'STALE'; readonly inventory: Inventory; readonly checked: boolean }
  | { readonly status: 'FAILED'; readonly message: string; readonly inventory?: Inventory };
