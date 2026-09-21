import type { ReasoningModelService } from '../../application/models/ReasoningModelService';
import type { ReasoningModel } from '../../domain/reasoningModel';
import { controlCenterActions, type ControlCenterAction } from './actions';
import { icon, tile, type IconName } from './icons';
import { escapeHtml } from './escapeHtml';
import { providerLabel } from './modelLabels';

export type ModelPresentation = Pick<ReasoningModelService, 'state' | 'notice' | 'testResult' | 'testing'>;

const actionIcons: Record<ControlCenterAction, IconName> = {
  analyzePrd: 'sparkle', openRequirements: 'document',
  selectPrd: 'document', refreshProject: 'refresh', selectWorkspace: 'folder',
  refresh: 'refresh', select: 'change', clear: 'trash', test: 'play', initialize: 'play', openFolder: 'folder',
};
export function action(actionName: ControlCenterAction, label: string, secondary = false): string {
  return `<a class="action${secondary ? ' secondary' : ''}" href="command:${controlCenterActions[actionName]}">${icon(actionIcons[actionName])}<span>${escapeHtml(label)}</span></a>`;
}

function details(model: ReasoningModel): string {
  return `<div class="selected-model">${tile('sparkle')}<dl class="model-details">
    <dt>Reasoning Model</dt><dd>${escapeHtml(model.name)}</dd>
    <dt class="sr-only">Family</dt><dd class="muted">${escapeHtml(model.family)}</dd>
  </dl><span class="badge">Selected</span></div>
  <div class="model-facts">
    <div class="fact">${icon('document')}<div><h4>Used for</h4><p>Analysis · Planning<br>Review · Validation</p></div></div>
    <div class="fact">${icon('chip')}<div><h4>Input limit</h4><p>${model.maxInputTokens === undefined ? 'Not provided' : `${escapeHtml(model.maxInputTokens.toLocaleString('en-US'))} tokens`}</p></div></div>
    <div class="fact">${icon('info')}<dl><dt>Provider</dt><dd>${escapeHtml(providerLabel(model.vendor))}</dd></dl></div>
  </div>`;
}

const purposes = `<ul class="purposes"><li>PRD analysis</li><li>planning</li><li>architecture reasoning</li><li>review and validation</li></ul>`;

export function renderModels(model: ModelPresentation): string {
  const state = model.state;
  const ready = state.status === 'READY';
  const content = state.status === 'NO_MODEL'
    ? `<h3>No reasoning models available</h3>`
    : state.status === 'SELECTION_REQUIRED'
      ? `<h3>Setup required</h3><p class="muted">${state.models.length} reasoning ${state.models.length === 1 ? 'model available' : 'models available'}.</p>`
      : `<h3 class="ready"><span class="status-dot" aria-hidden="true"></span>AI Ready</h3><p class="muted">Reasoning model configured</p>`;
  return `<section class="card models" aria-labelledby="models-heading">
    <div class="card-heading">${tile('sparkle')}<div class="heading-copy"><h2 id="models-heading">AI Configuration</h2>${content}</div>
      ${ready ? action('select', 'Change Model', true) : ''}
    </div>
    ${state.status === 'READY' ? details(state.selected) : `<div class="setup-copy"><p>${state.status === 'NO_MODEL' ? 'DevPilot needs a reasoning model for:' : 'Choose the model DevPilot should use for:'}</p>${purposes}<p class="muted">PRD analysis is available after import. Planning, architecture, review and validation follow in future releases.</p></div>`}
    <div class="actions model-actions">
      ${ready ? `${model.testing ? '' : action('test', 'Test Model')}${action('clear', 'Clear Model', true)}` : state.status === 'SELECTION_REQUIRED' ? action('select', 'Select Reasoning Model') : ''}
      ${action('refresh', 'Refresh Models', state.status !== 'NO_MODEL')}
    </div>
    ${model.testing ? '<p role="status">Testing model… Use the VS Code progress notification to cancel.</p>' : ''}
    ${model.notice ? `<p role="status">${escapeHtml(model.notice)}</p>` : ''}
    ${model.testResult ? `<h3>Actual response — ${escapeHtml(model.testResult.modelName)}</h3><pre>${escapeHtml(model.testResult.response || '(Empty response)')}</pre>` : ''}
  </section>`;
}

export function renderCodingAgent(): string {
  return `<section class="card agent" aria-labelledby="agent-heading"><div class="card-heading">${tile('terminal')}<div class="heading-copy"><h2 id="agent-heading">Coding Agent</h2><h3 class="muted"><span class="status-dot" aria-hidden="true"></span>Not configured</h3></div><button class="action secondary" disabled>${icon('settings')}<span>Configure</span></button></div><p class="muted card-description">Used for implementation, fixes and repository changes.<br>Available in a future release.</p></section>`;
}
