import { describe, expect, it } from 'vitest';
import { CONSTRAINT_CATEGORIES, NFR_CATEGORIES, PRIORITIES, CONFIDENCES } from '../src/domain/requirements/requirements';
import { RAW_MODEL_REQUIREMENTS_CONTRACT, type Contract } from '../src/domain/requirements/analysisContract';
import { validateRawModelAnalysis, validateRawModelStructure } from '../src/domain/requirements/validateRawModelAnalysis';
import { compilePrdAnalysisPrompt } from '../src/application/analysis/compilePrdAnalysisPrompt';
import { EXAMPLE_PRD, REQUIREMENTS_EXAMPLE } from '../src/application/analysis/requirementsExample';
import { canonicalizeRequirements } from '../src/application/analysis/canonicalizeRequirements';
import { validateRequirementsArtifact } from '../src/domain/requirements/validateRequirements';
import { requirementsArtifact } from './requirementsFixture';

function category(collection: 'constraints' | 'nonFunctionalRequirements', value: string) {
  return { ...REQUIREMENTS_EXAMPLE, [collection]: REQUIREMENTS_EXAMPLE[collection].map((item, index) => index === 0 ? { ...item, category: value } : item) };
}
function field(collection: string, name: string): Contract {
  const root = RAW_MODEL_REQUIREMENTS_CONTRACT;
  if (root.type !== 'object') throw new Error('Object expected');
  const array = root.properties[collection];
  if (array?.type !== 'array' || array.items.type !== 'object') throw new Error('Collection expected');
  const value = array.items.properties[name]; if (!value) throw new Error('Field expected'); return value;
}
describe('collection-specific classifications', () => {
  it.each(['OPERABILITY', 'SECURITY', 'PERFORMANCE', 'operability'])('accepts NFR category %s with only casing normalization', (value) => {
    const result = validateRawModelStructure(category('nonFunctionalRequirements', value));
    expect(result.nonFunctionalRequirements[0]?.category).toBe(value.toUpperCase());
  });
  it.each(['TECHNOLOGY', 'technology'])('accepts constraint category %s', (value) => {
    expect(validateRawModelStructure(category('constraints', value)).constraints[0]?.category).toBe('TECHNOLOGY');
  });
  it.each(['OPERABILITY', 'operability', 'SECURITY', 'PERFORMANCE'])('rejects misplaced %s without mapping or moving the item', (value) => {
    const raw = category('constraints', value); const before = JSON.stringify(raw);
    expect(() => validateRawModelStructure(raw)).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ path: 'constraints[0].category', expected: CONSTRAINT_CATEGORIES.join(' | '), reason: expect.stringContaining('No mapping or relocation') }) }));
    expect(JSON.stringify(raw)).toBe(before);
  });
  it('reports the fifth misplaced constraint with fixed safe hints, never raw descriptions', () => {
    const item = { category: 'OPERABILITY', description: 'Log unexpected failures; health readiness. private credential value', sourceReferences: [{ section: 'Operations', quote: 'private source quote' }] };
    const raw = { ...REQUIREMENTS_EXAMPLE, constraints: [...Array.from({ length: 4 }, () => REQUIREMENTS_EXAMPLE.constraints[0]), item] };
    try { validateRawModelStructure(raw); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toMatchObject({ diagnostic: { path: 'constraints[4].category', constraintIndex: 4, classificationSignals: 'logging, health/readiness' } });
      expect(JSON.stringify(error)).not.toContain('private');
    }
  });
  it('keeps enum types, validator schema and generated prompt tied to authoritative constants', () => {
    const prompt = compilePrdAnalysisPrompt('Example PRD');
    for (const [collection, key, values] of [
      ['constraints', 'category', CONSTRAINT_CATEGORIES], ['nonFunctionalRequirements', 'category', NFR_CATEGORIES],
      ['functionalRequirements', 'priority', PRIORITIES], ['functionalRequirements', 'confidence', CONFIDENCES],
    ] as const) {
      const contract = field(collection, key); expect(contract.type).toBe('string');
      if (contract.type === 'string') expect(contract.enum).toBe(values);
      expect(prompt).toContain(values.join(' | '));
    }
    expect(CONSTRAINT_CATEGORIES).not.toContain('OPERABILITY');
    for (const value of CONSTRAINT_CATEGORIES) expect(validateRawModelStructure(category('constraints', value)).constraints[0]?.category).toBe(value);
    for (const value of NFR_CATEGORIES) expect(validateRawModelStructure(category('nonFunctionalRequirements', value)).nonFunctionalRequirements[0]?.category).toBe(value);
  });
  it('teaches semantics with an example that passes the exact quote and artifact pipeline', () => {
    const prompt = compilePrdAnalysisPrompt('An unrelated PRD.');
    for (const phrase of ['observable product/system behavior', 'quality attribute or operational characteristic', 'restriction or boundary', 'Never use NFR categories for constraints', 'two independent concepts', 'NOT requirements for the supplied PRD']) expect(prompt).toContain(phrase);
    expect(prompt).toContain(JSON.stringify(REQUIREMENTS_EXAMPLE));
    const verified = validateRawModelAnalysis(REQUIREMENTS_EXAMPLE, EXAMPLE_PRD);
    const artifact = validateRequirementsArtifact({ ...requirementsArtifact(), ...canonicalizeRequirements(verified) });
    expect(artifact.nonFunctionalRequirements.map((item) => item.category)).toEqual(['SECURITY', 'OPERABILITY']);
    expect(artifact.constraints[0]?.category).toBe('TECHNOLOGY');
    expect(() => validateRawModelAnalysis(REQUIREMENTS_EXAMPLE, 'An unrelated PRD.')).toThrow();
  });
});
