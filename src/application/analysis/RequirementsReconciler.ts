import { ITEM_LIMITS } from '../../domain/requirements/analysisLimits';
import type { SourceReference, VerifiedRequirementsAnalysis } from '../../domain/requirements/requirements';

export interface ReconciliationEvent {
  readonly path: string;
  readonly raw: number;
  readonly verified: number;
  readonly deduplicated: number;
  readonly canonical: number;
  readonly action: 'DEDUPLICATED' | 'REDUCED_TO_CANONICAL_LIMIT';
}
/** Call only after ALL candidates have been source-verified. Does not modify semantic content. */
export function reconcileRequirements(content: VerifiedRequirementsAnalysis): {
  readonly content: VerifiedRequirementsAnalysis; readonly events: readonly ReconciliationEvent[];
} {
  const events: ReconciliationEvent[] = [];
  const reconcile = <T extends { readonly sourceReferences: readonly SourceReference[] }>(items: readonly T[], collection: string) => items.map((item, index) => {
    const seen = new Set<string>();
    const distinct = item.sourceReferences.filter((reference) => {
      // Verification already produced whitespace-normalized excerpts. Section is navigation only.
      if (seen.has(reference.evidence)) return false;
      seen.add(reference.evidence); return true;
    });
    const references = distinct.slice(0, ITEM_LIMITS.sourceReferences.max);
    if (references.length !== item.sourceReferences.length) events.push({
      path: `${collection}[${index}].sourceReferences`, raw: item.sourceReferences.length,
      verified: item.sourceReferences.length, deduplicated: distinct.length, canonical: references.length,
      action: distinct.length > references.length ? 'REDUCED_TO_CANONICAL_LIMIT' : 'DEDUPLICATED',
    });
    return { ...item, sourceReferences: references };
  });
  const result = { ...content,
    functionalRequirements: reconcile(content.functionalRequirements, 'functionalRequirements'),
    nonFunctionalRequirements: reconcile(content.nonFunctionalRequirements, 'nonFunctionalRequirements'),
    constraints: reconcile(content.constraints, 'constraints'), outOfScope: reconcile(content.outOfScope, 'outOfScope'),
    openQuestions: reconcile(content.openQuestions, 'openQuestions'),
  };
  return { content: result, events };
}
