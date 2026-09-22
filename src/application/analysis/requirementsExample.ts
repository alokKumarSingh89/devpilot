import type { RawModelRequirementsAnalysis } from '../../domain/requirements/requirements';

/** Synthetic teaching example, never a source of requirements for the user's PRD. */
export const EXAMPLE_PRD = 'Users must be able to log out. Passwords must be securely hashed. Unexpected failures should be logged with sufficient diagnostic context. The backend should use NestJS. Mobile applications are out of scope. Should project invitations expire?';
const refs = (quote: string) => [{ section: 'Example', quote }];
export const REQUIREMENTS_EXAMPLE: RawModelRequirementsAnalysis = {
  product: { name: 'Example', summary: 'Illustrative contract only.' }, actors: [],
  functionalRequirements: [{ title: 'Log out', description: 'Allow users to log out.', priority: 'MUST', actorIds: [], acceptanceCriteria: ['Users can log out.'], sourceReferences: refs('Users must be able to log out.'), confidence: 'HIGH' }],
  nonFunctionalRequirements: [
    { title: 'Password protection', description: 'Securely hash passwords.', category: 'SECURITY', measurableTarget: null, sourceReferences: refs('Passwords must be securely hashed.'), confidence: 'HIGH' },
    { title: 'Failure diagnostics', description: 'Log unexpected failures with diagnostic context.', category: 'OPERABILITY', measurableTarget: null, sourceReferences: refs('Unexpected failures should be logged with sufficient diagnostic context.'), confidence: 'HIGH' },
  ],
  constraints: [{ category: 'TECHNOLOGY', description: 'Use NestJS for the backend.', sourceReferences: refs('The backend should use NestJS.') }],
  outOfScope: [{ description: 'Mobile applications.', sourceReferences: refs('Mobile applications are out of scope.') }],
  openQuestions: [{ question: 'Should project invitations expire?', sourceReferences: refs('Should project invitations expire?') }],
};
