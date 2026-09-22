import { createHash } from 'node:crypto';
import type { RequirementsContent, VerifiedRequirementsAnalysis } from '../../domain/requirements/requirements';
import { validateRequirementsContent } from '../../domain/requirements/validateRequirements';

/** Content-derived IDs survive array reordering and model-proposed ID changes, but not semantic rewording. */
function canonicalId(prefix: string, identity: string): string {
  const normalized = identity.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const slug = normalized.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'ITEM';
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12).toUpperCase();
  return `${prefix}-${slug}-${hash}`;
}
export function canonicalizeRequirements(content: RequirementsContent | VerifiedRequirementsAnalysis): RequirementsContent {
  const actors = content.actors.map((actor) => ({ name: actor.name, description: actor.description, id: canonicalId('ACTOR', actor.name) }));
  const actorIds = new Map(content.actors.map((actor, index) => ['key' in actor ? actor.key : actor.id, actors[index]?.id ?? '']));
  const result: RequirementsContent = {
    ...content, actors,
    functionalRequirements: content.functionalRequirements.map((item) => ({ ...item, id: canonicalId('FR', item.title), actorIds: item.actorIds.map((id) => actorIds.get(id) ?? id) })),
    nonFunctionalRequirements: content.nonFunctionalRequirements.map((item) => ({ ...item, id: canonicalId('NFR', `${item.category} ${item.title}`) })),
    constraints: content.constraints.map((item) => ({ ...item, id: canonicalId('CONSTRAINT', `${item.category} ${item.description}`) })),
    outOfScope: content.outOfScope.map((item) => ({ ...item, id: canonicalId('OOS', item.description) })),
    openQuestions: content.openQuestions.map((item) => ({ ...item, id: canonicalId('QUESTION', item.question) })),
  };
  // Reject canonical collisions/duplicate semantic identities rather than silently dropping entries.
  return validateRequirementsContent(result);
}
