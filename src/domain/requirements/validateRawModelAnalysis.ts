import { AnalysisValidationFailure, diagnosticFailure, RAW_MODEL_REQUIREMENTS_CONTRACT, validateContract } from './analysisContract';
import { NFR_CATEGORIES, CONSTRAINT_CATEGORIES } from './requirements';
import { SourceTraceabilityVerifier } from './SourceTraceabilityVerifier';
import type { RawModelRequirementsAnalysis, RawModelSourceReference, VerifiedRequirementsAnalysis } from './requirements';

/** Validate shape and semantics while applying only contract-authorized whitespace/enum normalization. */
export function validateRawModelStructure(value: unknown): RawModelRequirementsAnalysis {
  let content: RawModelRequirementsAnalysis;
  try { content = validateContract(value, RAW_MODEL_REQUIREMENTS_CONTRACT, '$', true) as RawModelRequirementsAnalysis; }
  catch (error) {
    if (error instanceof AnalysisValidationFailure) {
      const match = /^constraints\[(\d+)\]\.category$/.exec(error.diagnostic.path);
      const root = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
      const index = match ? Number(match[1]) : undefined;
      const item: unknown = index !== undefined && Array.isArray(root?.constraints) ? root.constraints[index] : undefined;
      if (typeof item === 'object' && item !== null && 'category' in item && typeof item.category === 'string') {
        const category = item.category.trim().toUpperCase();
        if ((NFR_CATEGORIES as readonly string[]).includes(category) && !(CONSTRAINT_CATEGORIES as readonly string[]).includes(category)) {
          const description = 'description' in item && typeof item.description === 'string' ? item.description.slice(0, 2000) : '';
          // Fixed labels only: no response text, secrets or quotes enter diagnostics. These are hints, not reclassification.
          const signals = [/\blog(?:ged|ging|s)?\b/i.test(description) ? 'logging' : '', /\bhealth\b|\breadiness\b|\bready\b/i.test(description) ? 'health/readiness' : '', /\bmonitor(?:ing)?\b|\bobservability\b/i.test(description) ? 'monitoring/observability' : ''].filter(Boolean);
          throw new AnalysisValidationFailure({ ...error.diagnostic, constraintIndex: index ?? 0,
            reason: 'NFR category used in constraints; model must classify the item correctly. No mapping or relocation performed',
            classificationSignals: signals.join(', ') || 'No recognized operational terms in bounded description; inspect the source statement',
          });
        }
      }
    }
    throw error;
  }
  const actorKeys = new Set<string>();
  content.actors.forEach((actor, index) => {
    if (actorKeys.has(actor.key)) diagnosticFailure(`actors[${index}].key`, 'unique actor key', actor.key, 'Duplicate actor key');
    actorKeys.add(actor.key);
  });
  content.functionalRequirements.forEach((item, index) => {
    const seen = new Set<string>();
    item.actorIds.forEach((key, actorIndex) => {
      if (!actorKeys.has(key) || seen.has(key)) diagnosticFailure(`functionalRequirements[${index}].actorIds[${actorIndex}]`, 'unique reference to an existing actor key', key, 'Unknown or duplicate actor reference');
      seen.add(key);
    });
  });
  return content;
}

export function verifyModelSourceReferences(content: RawModelRequirementsAnalysis, prd: string): VerifiedRequirementsAnalysis {
  const verifier = new SourceTraceabilityVerifier(prd);
  const verify = <T extends { readonly sourceReferences: readonly RawModelSourceReference[] }>(items: readonly T[], collection: string) => items.map((item, index) => ({
    ...item, sourceReferences: item.sourceReferences.map((reference, refIndex) => {
      const verification = verifier.verifyQuote(reference.quote);
      if (verification.result !== 'VERIFIED') throw new AnalysisValidationFailure({
        path: `${collection}[${index}].sourceReferences[${refIndex}].quote`,
        expected: 'contiguous verbatim quote present in the imported PRD (whitespace normalized)',
        received: `string(length=${verification.quoteLength})`, reason: 'Candidate quote is not traceable to the source',
        quoteLength: verification.quoteLength, normalizedQuoteLength: verification.normalizedQuoteLength, result: verification.result,
      });
      return { section: reference.section, evidence: verification.evidence };
    }),
  }));
  return { ...content,
    functionalRequirements: verify(content.functionalRequirements, 'functionalRequirements'),
    nonFunctionalRequirements: verify(content.nonFunctionalRequirements, 'nonFunctionalRequirements'),
    constraints: verify(content.constraints, 'constraints'), outOfScope: verify(content.outOfScope, 'outOfScope'),
    openQuestions: verify(content.openQuestions, 'openQuestions'),
  };
}

/** Only verified references reach canonicalization; invalid references are never dropped. */
export function validateRawModelAnalysis(value: unknown, prd: string): VerifiedRequirementsAnalysis {
  return verifyModelSourceReferences(validateRawModelStructure(value), prd);
}
