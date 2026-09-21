import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { RequirementsArtifact, RequirementsContent } from '../src/domain/requirements/requirements';
import { projectFixture } from './projectFixture';

export const prdText = readFileSync('tests/fixtures/requirements-prd.md', 'utf8');
export const prdHash = createHash('sha256').update(prdText).digest('hex');
export const importedPrd = { relativePath: 'PRD.md', format: 'markdown' as const, sizeBytes: Buffer.byteLength(prdText), importedAt: '2026-09-21T11:00:00.000Z', contentHash: prdHash };
export const analysisModel = { id: 'reasoner', name: 'Reasoner', vendor: 'vendor', family: 'reasoning', maxInputTokens: 32000 };
const reference = (section: string, evidence: string) => [{ section, evidence }];
export function requirementsContent(): RequirementsContent {
  return {
    product: { name: 'Tiny Tasks', summary: 'A small task tracker for registered users.' },
    actors: [{ id: 'ACTOR-USER', name: 'User', description: 'A registered user of the task tracker.' }],
    functionalRequirements: [
      { id: 'FR-AUTH-001', title: 'Registration and sign-in', description: 'Users can create an account and sign in.', priority: 'MUST', actorIds: ['ACTOR-USER'], acceptanceCriteria: ['A user can register and sign in.'], sourceReferences: reference('Authentication', 'Users must be able to create an account and sign in.'), confidence: 'HIGH' },
      { id: 'FR-TASK-001', title: 'Task creation', description: 'Users can create tasks with a title.', priority: 'MUST', actorIds: ['ACTOR-USER'], acceptanceCriteria: ['A user can create a titled task.'], sourceReferences: reference('Tasks', 'Users must be able to create tasks with a title.'), confidence: 'HIGH' },
    ],
    nonFunctionalRequirements: [
      { id: 'NFR-SEC-001', category: 'SECURITY', title: 'Password storage', description: 'Store passwords as salted hashes.', measurableTarget: null, sourceReferences: reference('Security', 'Passwords must be stored as salted hashes.'), confidence: 'HIGH' },
      { id: 'NFR-PERF-001', category: 'PERFORMANCE', title: 'Task list response', description: 'Task lists should load promptly.', measurableTarget: '500 ms for 100 tasks', sourceReferences: reference('Performance', 'Task lists should load within 500 ms for 100 tasks.'), confidence: 'HIGH' },
    ],
    constraints: [{ id: 'CONSTRAINT-TECH-001', category: 'TECHNOLOGY', description: 'The backend must use Node.js.', sourceReferences: reference('Technical constraints', 'The backend must use Node.js.') }],
    outOfScope: [{ id: 'OOS-001', description: 'Mobile applications', sourceReferences: reference('Out of scope', 'Mobile applications are out of scope for V1.') }],
    openQuestions: [{ id: 'QUESTION-001', question: 'Should task titles have a maximum length?', sourceReferences: reference('Open questions', 'Should task titles have a maximum length?') }],
  };
}
export function requirementsArtifact(): RequirementsArtifact {
  return { schemaVersion: 1,
    generated: { generatedAt: '2026-09-21T12:00:00.000Z', projectId: projectFixture().project.id,
      model: { id: analysisModel.id, vendor: analysisModel.vendor, family: analysisModel.family },
      source: { relativePath: importedPrd.relativePath, contentHash: prdHash } },
    ...requirementsContent(),
  };
}
