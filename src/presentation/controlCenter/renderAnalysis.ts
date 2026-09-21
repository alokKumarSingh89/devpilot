import type { AnalysisState } from '../../domain/requirements/requirements';
import { action } from './renderModels';
import { escapeHtml } from './escapeHtml';

export function renderAnalysis(state: AnalysisState, canAnalyze: boolean): string {
  const labels = { NOT_ANALYZED: 'Not analyzed', ANALYZING: 'Analyzing…', ANALYZED: 'Analyzed', STALE: 'Stale', FAILED: 'Analysis failed' };
  const artifact = 'artifact' in state ? state.artifact : undefined;
  return `<div class="prd-input"><h4>Requirements intelligence</h4><p role="status">${labels[state.status]}</p>
    ${state.status === 'FAILED' ? `<p>${escapeHtml(state.message)}</p>` : ''}
    ${state.status === 'STALE' ? '<p>The saved analysis refers to an earlier project or imported PRD version.</p>' : ''}
    ${state.status === 'ANALYZING' ? '<p>Use the VS Code progress notification to cancel.</p>' : ''}
    ${artifact ? `<dl class="project-details"><dt>Functional requirements</dt><dd>${artifact.functionalRequirements.length}</dd><dt>Non-functional requirements</dt><dd>${artifact.nonFunctionalRequirements.length}</dd><dt>Constraints</dt><dd>${artifact.constraints.length}</dd><dt>Open questions</dt><dd>${artifact.openQuestions.length}</dd><dt>Generated with</dt><dd>${escapeHtml(artifact.generated.model.family)}</dd></dl><p class="muted">Review generated requirements and source evidence before relying on them.</p>` : ''}
    <div class="actions">${artifact ? action('openRequirements', 'View Requirements', true) : ''}
    ${canAnalyze && state.status !== 'ANALYZING' ? action('analyzePrd', state.status === 'FAILED' ? 'Retry Analysis' : artifact ? 'Re-analyze PRD' : 'Analyze PRD') : ''}</div>
    ${!canAnalyze && state.status !== 'ANALYZING' ? '<p class="muted">Analysis requires an unchanged imported PRD, an initializing PRD project, and a ready reasoning model.</p>' : ''}
  </div>`;
}
