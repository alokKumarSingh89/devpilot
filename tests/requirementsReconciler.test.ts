import { describe, expect, it } from 'vitest';
import { reconcileRequirements } from '../src/application/analysis/RequirementsReconciler';
import { validateRawModelStructure, verifyModelSourceReferences } from '../src/domain/requirements/validateRawModelAnalysis';
import { canonicalizeRequirements } from '../src/application/analysis/canonicalizeRequirements';
import { validateRequirementsArtifact } from '../src/domain/requirements/validateRequirements';
import { compilePrdAnalysisPrompt } from '../src/application/analysis/compilePrdAnalysisPrompt';
import { prdText, rawRequirementsContent, requirementsArtifact } from './requirementsFixture';

const quotes = Array.from({ length: 11 }, (_, i) => `Source fact number ${i}.`);
const source = `${prdText}\n${quotes.join('\n')}`;
function response(count: number) {
  const raw = rawRequirementsContent();
  return { ...raw, functionalRequirements: raw.functionalRequirements.map((item, index) => index === 0 ? { ...item, sourceReferences: quotes.slice(0, count).map((quote) => ({ section: 'Facts', quote })) } : item) };
}
function pipeline(value: unknown) {
  const candidate = validateRawModelStructure(value);
  const verified = verifyModelSourceReferences(candidate, source);
  const reconciled = reconcileRequirements(verified);
  const canonical = canonicalizeRequirements(reconciled.content);
  return { artifact: validateRequirementsArtifact({ ...requirementsArtifact(), ...canonical }), events: reconciled.events };
}
describe('verified provenance reconciliation', () => {
  it.each([1, 3, 4, 10])('accepts %s raw references and produces strict canonical output deterministically', (count) => {
    expect(validateRawModelStructure(response(count))).toBeDefined();
    const first = pipeline(response(count)); const second = pipeline(response(count));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.artifact.functionalRequirements[0]?.sourceReferences.map((ref) => ref.evidence)).toEqual(quotes.slice(0, Math.min(count, 3)));
    if (count > 3) expect(first.events).toContainEqual({ path: 'functionalRequirements[0].sourceReferences', raw: count, verified: count, deduplicated: count, canonical: 3, action: 'REDUCED_TO_CANONICAL_LIMIT' });
  });
  it('rejects eleven references before verification', () => {
    expect(() => pipeline(response(11))).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ minimum: 1, maximum: 10, actualLength: 11 }) }));
  });
  it('deduplicates whitespace-normalized quotes, preserving first section and stable model order', () => {
    const raw = response(4); const item = raw.functionalRequirements[0]; if (!item) throw new Error('Missing fixture');
    const references = [item.sourceReferences[1], item.sourceReferences[0], { section: 'Alternate heading', quote: ' Source  fact number 1. ' }, item.sourceReferences[2]];
    const candidate = { ...raw, functionalRequirements: [{ ...item, sourceReferences: references }] };
    const before = JSON.stringify(candidate); const result = pipeline(candidate);
    expect(result.artifact.functionalRequirements[0]?.sourceReferences.map((ref) => ref.evidence)).toEqual([quotes[1], quotes[0], quotes[2]]);
    expect(result.artifact.functionalRequirements[0]?.sourceReferences[0]?.section).toBe('Facts');
    expect(result.events[0]).toMatchObject({ raw: 4, verified: 4, deduplicated: 3, canonical: 3, action: 'DEDUPLICATED' });
    expect(JSON.stringify(candidate)).toBe(before);
  });
  it('verifies the fourth and tenth candidates before reduction; fabricated tails cannot be hidden', () => {
    for (const count of [4, 10]) {
      const raw = response(count);
      const bad = { ...raw, functionalRequirements: raw.functionalRequirements.map((item, index) => index === 0 ? { ...item, sourceReferences: item.sourceReferences.map((ref, i) => i === count - 1 ? { ...ref, quote: 'Fabricated source evidence.' } : ref) } : item) };
      expect(() => pipeline(bad)).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ path: `functionalRequirements[0].sourceReferences[${count - 1}].quote`, result: 'NOT_FOUND' }) }));
    }
  });
  it.each(['functionalRequirements', 'nonFunctionalRequirements', 'constraints', 'outOfScope', 'openQuestions'] as const)('reconciles only references in %s, never item meaning or item count', (collection) => {
    const raw = rawRequirementsContent();
    const candidate = { ...raw, [collection]: raw[collection].map((item) => ({ ...item, sourceReferences: quotes.slice(0, 4).map((quote) => ({ section: 'Facts', quote })) })) };
    const verified = verifyModelSourceReferences(validateRawModelStructure(candidate), source);
    const result = reconcileRequirements(verified);
    expect(result.content[collection]).toHaveLength(raw[collection].length);
    result.content[collection].forEach((item, index) => {
      const { sourceReferences, ...meaning } = item;
      const original = verified[collection][index]; if (!original) throw new Error('Missing item');
      const { sourceReferences: _refs, ...expected } = original;
      expect(meaning).toEqual(expected); expect(sourceReferences).toHaveLength(3);
    });
  });
  it('keeps the ideal prompt at 1..3 while canonical validation rejects unreconciled four-reference content', () => {
    expect(compilePrdAnalysisPrompt('')).toContain('sourceReferences: 1..3');
    expect(compilePrdAnalysisPrompt('')).not.toContain('array[1..10]');
    const verified = verifyModelSourceReferences(validateRawModelStructure(response(4)), source);
    expect(() => canonicalizeRequirements(verified)).toThrow();
  });
  it('does not reduce 20 unique acceptance criteria, rejects 21 instead', () => {
    const raw = response(4);
    const value = (count: number) => ({ ...raw, functionalRequirements: raw.functionalRequirements.map((item) => ({ ...item, acceptanceCriteria: Array.from({ length: count }, (_, i) => `Unique criterion ${i}`) })) });
    expect(pipeline(value(20)).artifact.functionalRequirements[0]?.acceptanceCriteria).toHaveLength(20);
    expect(() => pipeline(value(21))).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ actualLength: 21, maximum: 20 }) }));
  });
});
