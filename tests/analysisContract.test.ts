import { reconcileRequirements } from '../src/application/analysis/RequirementsReconciler';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AnalysisValidationFailure, IDEAL_MODEL_REQUIREMENTS_CONTRACT } from '../src/domain/requirements/analysisContract';
import { validateRawModelAnalysis } from '../src/domain/requirements/validateRawModelAnalysis';
import { validateRequirementsArtifact } from '../src/domain/requirements/validateRequirements';
import { compilePrdAnalysisPrompt, describeAnalysisContract } from '../src/application/analysis/compilePrdAnalysisPrompt';
import { canonicalizeRequirements } from '../src/application/analysis/canonicalizeRequirements';
import { parseAnalysisResponse } from '../src/application/analysis/parseAnalysisResponse';
import { requirementsArtifact } from './requirementsFixture';
const prd = readFileSync('tests/fixtures/devtask-prd.md', 'utf8');
const response = readFileSync('tests/fixtures/devtask-analysis.json', 'utf8');
const raw = () => JSON.parse(response) as Record<string, unknown>;
function changed(path: string, value: unknown) {
  const result = raw(); const keys = path.split('.'); const last = keys.pop(); let node = result;
  for (const key of keys) node = node[key] as Record<string, unknown>;
  if (last) node[last] = value;
  return result;
}
function diagnostic(value: unknown) {
  try { validateRawModelAnalysis(value, prd); throw new Error('Expected validation failure'); }
  catch (error) { expect(error).toBeInstanceOf(AnalysisValidationFailure); return (error as AnalysisValidationFailure).diagnostic; }
}
describe('realistic model-content contract', () => {
  it.each([response, ` \n${response}\n `, `\`\`\`json\n${response}\n\`\`\``])('runs extraction, raw validation/normalization, canonicalization and final validation', (text) => {
    const content = validateRawModelAnalysis(parseAnalysisResponse(text), prd);
    const canonical = canonicalizeRequirements(reconcileRequirements(content).content);
    const artifact = validateRequirementsArtifact({ ...requirementsArtifact(), ...canonical, generated: { ...requirementsArtifact().generated, source: { relativePath: 'PRD.md', contentHash: createHash('sha256').update(prd).digest('hex') } } });
    expect(artifact.product.name).toBe('DevTask'); expect(artifact.actors.map((item) => item.name)).toEqual(['Project Owner', 'Team Member']);
    expect(artifact.functionalRequirements).toHaveLength(3); expect(artifact.nonFunctionalRequirements).toHaveLength(4);
    expect(artifact.constraints[0]?.description).toContain('NestJS and PostgreSQL');
    expect(artifact.nonFunctionalRequirements.filter((item) => item.category === 'OPERABILITY').map((item) => item.title)).toEqual(['Failure diagnostics', 'Application readiness']);
    expect(artifact.constraints.every((item) => item.category === 'TECHNOLOGY')).toBe(true);
    expect(artifact.outOfScope[0]?.description).toContain('Mobile'); expect(artifact.openQuestions[0]?.question).toContain('invitations');
    expect(artifact.functionalRequirements[0]?.priority).toBe('MUST'); expect(artifact.nonFunctionalRequirements[0]?.category).toBe('SECURITY');
    expect(artifact.functionalRequirements[0]?.sourceReferences[0]?.section).toBe('4. Authentication');
    expect(canonicalizeRequirements(reconcileRequirements(content).content)).toEqual(canonical);
    expect(canonical.functionalRequirements[0]?.actorIds).toEqual([canonical.actors[1]?.id]);
    expect(JSON.stringify(artifact)).not.toContain('"key":');
  });
  it('uses the identical authoritative contract in the prompt and has no model-owned provenance/IDs', () => {
    const prompt = compilePrdAnalysisPrompt(prd);
    expect(prompt).toContain(describeAnalysisContract(IDEAL_MODEL_REQUIREMENTS_CONTRACT));
    expect(prompt).toContain('There are NO optional fields'); expect(prompt).toContain('measurableTarget permits null');
    expect(raw()).not.toHaveProperty('generated'); expect(raw()).not.toHaveProperty('schemaVersion');
    expect(() => validateRawModelAnalysis({ ...raw(), generated: {} }, prd)).toThrow();
    expect(() => validateRawModelAnalysis(changed('functionalRequirements.0.id', 'FR-MODEL-ID'), prd)).toThrow();
  });
  it('normalizes surrounding whitespace and known enum casing without guessing values', () => {
    const content = validateRawModelAnalysis(changed('functionalRequirements.0.priority', ' Must '), prd);
    expect(content.functionalRequirements[0]?.priority).toBe('MUST');
    expect(diagnostic(changed('functionalRequirements.0.priority', 'HIGH'))).toMatchObject({ path: 'functionalRequirements[0].priority', expected: 'MUST | SHOULD | COULD', received: 'string(length=4) HIGH' });
    expect(diagnostic(changed('functionalRequirements.0.priority', 'SECRET_API_VALUE'))).toMatchObject({ received: 'string(length=16)' });
  });
  it('requires measurableTarget explicitly, accepting null only for this field', () => {
    const value = raw(); const nfr = (value.nonFunctionalRequirements as Record<string, unknown>[])[0];
    if (nfr) delete nfr.measurableTarget;
    expect(diagnostic(value)).toMatchObject({ path: 'nonFunctionalRequirements[0].measurableTarget', expected: 'string | null', received: 'undefined' });
    expect(validateRawModelAnalysis(raw(), prd).nonFunctionalRequirements[0]?.measurableTarget).toBeNull();
    expect(() => validateRawModelAnalysis(changed('functionalRequirements.0.acceptanceCriteria', null), prd)).toThrow();
  });
  it.each([
    ['functionalRequirements.0.sourceReferences', []],
    ['functionalRequirements.0.sourceReferences.0.quote', ''],
    ['functionalRequirements.0.sourceReferences.0.quote', 'fabricated evidence'],
    ['functionalRequirements.0.sourceReferences.0.quote', 'x'.repeat(301)],
    ['functionalRequirements.0.actorIds', ['unknown']],
    ['functionalRequirements.0.acceptanceCriteria', []],
    ['actors.1.key', 'owner'],
    ['nonFunctionalRequirements.0.category', 'FAST'],
  ])('rejects missing/invalid semantics at %s', (path, value) => {
    expect(() => validateRawModelAnalysis(changed(path, value), prd)).toThrow(AnalysisValidationFailure);
  });
  it('reports evidence bounds precisely instead of truncating', () => {
    expect(diagnostic(changed('functionalRequirements.0.sourceReferences.0.quote', 'x'.repeat(301)))).toMatchObject({ path: 'functionalRequirements[0].sourceReferences[0].quote', expected: 'nonempty string <=300 characters', received: 'string(length=301)' });
  });
  it.each(['Here is your analysis: {}', '{} trailing prose'])('rejects explanatory prose', (text) => {
    expect(() => parseAnalysisResponse(text)).toThrow(AnalysisValidationFailure);
  });
  it('distinguishes incomplete responses safely without logging JSON fragments', () => {
    try { parseAnalysisResponse('{"product":{"name":"secret'); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toMatchObject({ diagnostic: { path: '$response', reason: expect.stringContaining('incomplete or truncated') } });
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });
});
