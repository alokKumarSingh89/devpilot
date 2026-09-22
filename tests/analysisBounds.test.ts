import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { ITEM_LIMITS, TOP_LEVEL_LIMITS, TEXT_LIMITS } from '../src/domain/requirements/analysisLimits';
import { RAW_MODEL_REQUIREMENTS_CONTRACT, validateContract } from '../src/domain/requirements/analysisContract';
import { validateRawModelAnalysis, validateRawModelStructure } from '../src/domain/requirements/validateRawModelAnalysis';
import { compilePrdAnalysisPrompt } from '../src/application/analysis/compilePrdAnalysisPrompt';
import { parseRequirementsYaml, serializeRequirementsYaml } from '../src/infrastructure/requirements/requirementsYaml';
import { prdText, rawRequirementsContent, requirementsArtifact } from './requirementsFixture';

const collections = ['functionalRequirements', 'nonFunctionalRequirements', 'constraints', 'outOfScope', 'openQuestions'] as const;
function refs(collection: typeof collections[number], count: number) {
  const raw = rawRequirementsContent();
  return { ...raw, [collection]: raw[collection].map((item, index) => index === 0 ? { ...item, sourceReferences: Array.from({ length: count }, () => item.sourceReferences[0]) } : item) };
}
function fail(value: unknown, path: string, min: number, max: number, count: number) {
  expect(() => validateRawModelStructure(value)).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ path, minimum: min, maximum: max, actualLength: count }) }));
}
describe('bounded contract consistency', () => {
  it.each(collections)('%s permits one or three verified references, rejects zero and four without truncation', (collection) => {
    for (const count of [1, 3]) expect(validateRawModelAnalysis(refs(collection, count), prdText)[collection][0]?.sourceReferences).toHaveLength(count);
    for (const count of [0, 4]) { const raw = refs(collection, count); const before = JSON.stringify(raw); fail(raw, `${collection}[0].sourceReferences`, 1, 3, count); expect(JSON.stringify(raw)).toBe(before); }
  });
  it('accepts 1..8 acceptance criteria and rejects 0/9 with precise diagnostics', () => {
    const raw = rawRequirementsContent();
    for (const count of [0, 1, 8, 9]) {
      const value = { ...raw, functionalRequirements: raw.functionalRequirements.map((item, index) => index === 0 ? { ...item, acceptanceCriteria: Array.from({ length: count }, () => 'Users can sign in.') } : item) };
      if (count === 1 || count === 8) expect(validateRawModelStructure(value).functionalRequirements[0]?.acceptanceCriteria).toHaveLength(count);
      else fail(value, 'functionalRequirements[0].acceptanceCriteria', 1, 8, count);
    }
  });
  it.each(Object.keys(TOP_LEVEL_LIMITS) as (keyof typeof TOP_LEVEL_LIMITS)[])('%s keeps generous declared top-level limits', (collection) => {
    const raw = rawRequirementsContent(); const bounds = TOP_LEVEL_LIMITS[collection];
    for (const count of [bounds.min, bounds.max]) {
      // Shape validation isolates count boundaries from actor cross-links and canonical identity uniqueness.
      expect(validateContract({ ...raw, [collection]: Array.from({ length: count }, () => raw[collection][0]) }, RAW_MODEL_REQUIREMENTS_CONTRACT)).toBeDefined();
    }
    fail({ ...raw, [collection]: Array.from({ length: bounds.max + 1 }, () => raw[collection][0]) }, collection, bounds.min, bounds.max, bounds.max + 1);
    expect(compilePrdAnalysisPrompt('')).toContain(`${collection}: ${bounds.min}..${bounds.max}`);
  });
  it('retains 50 distinct actor links, rejects 51 and does not permit dangling references', () => {
    const raw = rawRequirementsContent(); const actors = Array.from({ length: 51 }, (_, i) => ({ key: `actor-${i}`, name: `Actor ${i}`, description: 'An actor.' }));
    const value = (count: number) => ({ ...raw, actors, functionalRequirements: raw.functionalRequirements.map((item) => ({ ...item, actorIds: actors.slice(0, count).map((actor) => actor.key) })) });
    expect(validateRawModelStructure(value(50)).functionalRequirements[0]?.actorIds).toHaveLength(50);
    fail(value(51), 'functionalRequirements[0].actorIds', 0, 50, 51);
    expect(() => validateRawModelStructure({ ...value(50), actors: [] })).toThrow();
  });
  it('states exact item limits and prefers one strong reference', () => {
    const prompt = compilePrdAnalysisPrompt('');
    expect(prompt).toContain('STRICT COLLECTION LIMITS'); expect(prompt).toContain('prefer exactly 1');
    for (const [key, bounds] of Object.entries(ITEM_LIMITS)) expect(prompt).toContain(`${key}: ${bounds.min}..${bounds.max}`);
    expect(prompt).toContain('never more than 3'); expect(prompt).toContain('normally 2-5'); expect(prompt).toContain('never more than 8');
    expect(prompt).not.toContain('hard maximum 5'); expect(prompt).not.toContain('1..20');
  });
  it('enforces all declared string bounds without truncation', () => {
    function check(contract: typeof RAW_MODEL_REQUIREMENTS_CONTRACT) {
      if (contract.type === 'object') Object.values(contract.properties).forEach(check);
      else if (contract.type === 'array') check(contract.items);
      else if (!contract.enum) {
        expect(validateContract('x'.repeat(contract.maxLength), contract)).toHaveLength(contract.maxLength);
        expect(() => validateContract('x'.repeat(contract.maxLength + 1), contract)).toThrow();
        expect(() => validateContract('', contract)).toThrow();
        expect(validateContract('  valid  ', contract, '$', true)).toBe('valid');
      }
    }
    check(RAW_MODEL_REQUIREMENTS_CONTRACT);
    expect(TEXT_LIMITS.quote).toBe(300);
  });
  it('allows legacy schema-v1 reads but applies new bounds to writes', () => {
    const base = requirementsArtifact();
    const legacy = { ...base, functionalRequirements: base.functionalRequirements.map((item) => ({ ...item, acceptanceCriteria: Array.from({ length: 20 }, () => 'A user can sign in.'), sourceReferences: item.sourceReferences.flatMap((ref) => Array.from({ length: 5 }, () => ({ ...ref }))) })) };
    expect(parseRequirementsYaml(stringify(legacy))).toEqual(legacy);
    expect(() => serializeRequirementsYaml(legacy)).toThrow();
    const invalid = { ...legacy, constraints: base.constraints.map((item) => ({ ...item, sourceReferences: item.sourceReferences.flatMap((ref) => Array.from({ length: 6 }, () => ({ ...ref }))) })) };
    expect(() => parseRequirementsYaml(stringify(invalid))).toThrow();
  });
});

describe('adversarial oversized model response', () => {
  const response = JSON.parse(readFileSync('tests/fixtures/oversized-analysis.json', 'utf8')) as Record<string, unknown>;
  it('rejects each independent overrun deterministically rather than keeping a prefix', () => {
    fail(response, 'actors', 0, 200, 201);
    const raw = rawRequirementsContent();
    fail({ ...raw, constraints: response.constraints }, 'constraints[0].sourceReferences', 1, 3, 6);
    fail({ ...raw, functionalRequirements: response.functionalRequirements }, 'functionalRequirements[0].acceptanceCriteria', 1, 8, 9);
  });
  it('accepts the realistic DevTask fixture with the new limits and traceability checks', () => {
    const value: unknown = JSON.parse(readFileSync('tests/fixtures/devtask-analysis.json', 'utf8'));
    expect(validateRawModelAnalysis(value, readFileSync('tests/fixtures/devtask-prd.md', 'utf8'))).toBeDefined();
  });
});
