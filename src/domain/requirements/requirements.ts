export const REQUIREMENTS_SCHEMA_VERSION = 1;
export const MAX_EVIDENCE_LENGTH = 300;
export const MAX_REQUIREMENTS_BYTES = 1024 * 1024;
export const MAX_ANALYSIS_RESPONSE_CHARACTERS = 256 * 1024;
export const PRIORITIES = ['MUST', 'SHOULD', 'COULD'] as const;
export const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const NFR_CATEGORIES = ['SECURITY', 'PERFORMANCE', 'RELIABILITY', 'SCALABILITY', 'USABILITY', 'OPERABILITY', 'MAINTAINABILITY', 'COMPLIANCE', 'OTHER'] as const;
export const CONSTRAINT_CATEGORIES = ['TECHNOLOGY', 'BUSINESS', 'REGULATORY', 'RESOURCE', 'OTHER'] as const;
export interface SourceReference { readonly section: string; readonly evidence: string }
export interface Actor { readonly id: string; readonly name: string; readonly description: string }
interface TracedItem { readonly id: string; readonly sourceReferences: readonly SourceReference[] }
export interface FunctionalRequirement extends TracedItem {
  readonly title: string; readonly description: string;
  readonly priority: typeof PRIORITIES[number]; readonly confidence: typeof CONFIDENCES[number];
  readonly actorIds: readonly string[]; readonly acceptanceCriteria: readonly string[];
}
export interface NonFunctionalRequirement extends TracedItem {
  readonly category: typeof NFR_CATEGORIES[number]; readonly title: string; readonly description: string;
  readonly measurableTarget: string | null; readonly confidence: typeof CONFIDENCES[number];
}
export interface Constraint extends TracedItem { readonly category: typeof CONSTRAINT_CATEGORIES[number]; readonly description: string }
export interface OutOfScope extends TracedItem { readonly description: string }
export interface OpenQuestion extends TracedItem { readonly question: string }
export interface RequirementsContent {
  readonly product: { readonly name: string; readonly summary: string };
  readonly actors: readonly Actor[];
  readonly functionalRequirements: readonly FunctionalRequirement[];
  readonly nonFunctionalRequirements: readonly NonFunctionalRequirement[];
  readonly constraints: readonly Constraint[];
  readonly outOfScope: readonly OutOfScope[];
  readonly openQuestions: readonly OpenQuestion[];
}
export interface RequirementsArtifact extends RequirementsContent {
  readonly schemaVersion: typeof REQUIREMENTS_SCHEMA_VERSION;
  readonly generated: {
    readonly generatedAt: string;
    readonly projectId: string;
    readonly model: { readonly id: string; readonly vendor: string; readonly family: string };
    readonly source: { readonly relativePath: string; readonly contentHash: string };
  };
}
export type AnalysisState =
  | { readonly status: 'NOT_ANALYZED' | 'ANALYZING' }
  | { readonly status: 'ANALYZED' | 'STALE'; readonly artifact: RequirementsArtifact }
  | { readonly status: 'FAILED'; readonly message: string; readonly artifact?: RequirementsArtifact };
