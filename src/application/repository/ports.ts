import type { RequestCancellation } from '../models/ports';
import type { ProjectWorkspace } from '../projects/ports';
import type { GitMetadata, Inventory, ScanLimits, TruncationReason } from '../../domain/repository/inventory';
export interface RepositoryFile { readonly relativePath: string; readonly sizeBytes: number }
export interface RepositorySnapshot {
  readonly files: readonly RepositoryFile[];
  readonly metadata: ReadonlyMap<string, { readonly text: string; readonly contentHash: string }>;
  readonly discoveredFiles: number; readonly ignoredFiles: number;
  readonly reasons: readonly TruncationReason[];
  readonly limits: ScanLimits;
}
export interface RepositoryDiscovery { discover(workspace: ProjectWorkspace, token: RequestCancellation): Promise<RepositorySnapshot> }
export interface GitMetadataReader { read(workspace: ProjectWorkspace): Promise<GitMetadata> }
export interface InventoryStorage {
  read(workspace: ProjectWorkspace): Promise<Inventory | undefined>;
  write(workspace: ProjectWorkspace, inventory: Inventory, beforeCommit: () => Promise<void>): Promise<void>;
}
