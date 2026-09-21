import type { DocumentCandidate, DocumentFormat } from '../../domain/document';
import type { ProjectWorkspace } from '../projects/ports';
export interface DocumentDiscovery {
  discover(workspace: ProjectWorkspace): Promise<{ readonly candidates: readonly DocumentCandidate[]; readonly limited: boolean }>;
}
export interface ReadDocument {
  readonly relativePath: string;
  readonly format: DocumentFormat;
  readonly text: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
}
export interface DocumentReader {
  read(workspace: ProjectWorkspace, relativePath: string): Promise<ReadDocument>;
}
