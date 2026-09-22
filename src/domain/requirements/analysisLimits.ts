/** Domain-owned output contract. Counts are per collection/item; strings use UTF-16 code units. */
export const TOP_LEVEL_LIMITS = {
  actors: { min: 0, max: 200 }, functionalRequirements: { min: 0, max: 200 },
  nonFunctionalRequirements: { min: 0, max: 200 }, constraints: { min: 0, max: 200 },
  outOfScope: { min: 0, max: 200 }, openQuestions: { min: 0, max: 200 },
} as const;
export const ITEM_LIMITS = {
  sourceReferences: { min: 1, max: 3 }, acceptanceCriteria: { min: 1, max: 20 }, actorIds: { min: 0, max: 50 },
} as const;
export const TEXT_LIMITS = {
  name: 160, title: 160, description: 2000, question: 2000, summary: 3000,
  actorKey: 100, canonicalId: 100, acceptanceCriterion: 1000, measurableTarget: 1000,
  section: 200, quote: 300,
} as const;
/** Read-only compatibility for artifacts written before the bounded-output hardening. Never used for model output/new writes. */
export const LEGACY_ARTIFACT_LIMITS = { sourceReferences: { min: 1, max: 5 }, acceptanceCriteria: { min: 1, max: 20 } } as const;

/** Only provenance metadata has a larger raw ceiling; semantic collections must never be reduced. */
export const RAW_SOURCE_REFERENCE_LIMITS = { min: 1, max: 10 } as const;
