import { renderInventory } from './renderInventory';
import { renderAnalysis } from './renderAnalysis';
import type { PrdState } from '../../domain/document';
import type { ProjectSource, ProjectState } from '../../domain/project';
import { action } from './renderModels';
import { escapeHtml } from './escapeHtml';
import { tile } from './icons';

const sourceLabels: Record<ProjectSource, string> = { PRD: 'PRD', CODEBASE: 'Existing Code', PRD_AND_CODEBASE: 'PRD + Existing Code' };

export function renderProject(state: ProjectState, folderName?: string, modelReady = false): string {
  let title: string;
  let description: string;
  let details = '';
  switch (state.status) {
    case 'WORKSPACE_SELECTION_REQUIRED': title = 'Choose project folder'; description = 'Multiple workspace folders are open. Explicitly select the DevPilot project root.'; break;
    case 'NO_WORKSPACE': title = 'No workspace open'; description = 'Open a folder to start using DevPilot.'; break;
    case 'AI_NOT_READY': title = 'No project initialized'; description = 'Model configuration required. Project initialization is unavailable until a reasoning model is selected and available.'; break;
    case 'NOT_INITIALIZED': title = 'No project initialized'; description = modelReady ? 'Initialize DevPilot to record how your project should be understood.' : 'Project initialization is unavailable until a reasoning model is selected and available.'; break;
    case 'LOADING': title = 'Checking project'; description = 'Reading workspace project state…'; break;
    case 'ERROR': title = 'Project unavailable'; description = state.message; break;
    case 'INITIALIZING':
    case 'READY': {
      title = state.manifest.project.name;
      description = state.status === 'READY' ? 'Project is ready.' : 'Project initialized. Project intelligence has not yet been generated. No analysis has run.';
      if (state.status === 'INITIALIZING' && state.analysis) {
        description = state.analysis.status === 'ANALYZING'
          ? 'PRD analysis is running. Project initialization is not complete.'
          : 'artifact' in state.analysis && state.analysis.artifact
            ? 'Requirements intelligence is available for review. Project initialization is not complete.'
            : 'No validated requirements artifact is available yet. The project remains Initializing.';
      }
      details = `<dl class="project-details"><dt>Status</dt><dd>${state.status === 'INITIALIZING' ? 'Initializing' : 'Ready'}</dd><dt>Source</dt><dd>${sourceLabels[state.manifest.project.source]}</dd></dl>`;
      if (state.manifest.project.source !== 'CODEBASE' || state.manifest.inputs?.prd) {
        const prd = state.prd ?? { status: 'NOT_SELECTED' };
        details += renderPrd(prd, state.status === 'INITIALIZING' && state.manifest.project.source !== 'CODEBASE');
        if (state.analysis) details += renderAnalysis(state.analysis, modelReady && prd.status === 'SELECTED' && state.status === 'INITIALIZING' && state.manifest.project.source !== 'CODEBASE');
      }
      if (state.inventory) details += renderInventory(state.inventory, state.status === 'INITIALIZING' && state.manifest.project.source !== 'PRD');
      if (state.status === 'INITIALIZING' && state.inventory && state.inventory.status !== 'NOT_SCANNED') description = 'Project initialization is not complete. Review the available intelligence and scan coverage.';
      break;
    }
  }
  return `<section class="card project" aria-labelledby="project-heading"><div class="card-heading">${tile('layers')}<div class="heading-copy"><h2 id="project-heading">Project</h2><h3>${escapeHtml(title)}</h3></div>${state.status === 'NOT_INITIALIZED' && modelReady ? action('initialize', 'Initialize Project') : ''}</div>
    <div class="card-description">${folderName ? `<p class="muted">Project folder: ${escapeHtml(folderName)}</p>` : ''}${details}<p class="muted">${escapeHtml(description)}</p>
    ${state.status !== 'NO_WORKSPACE' && state.status !== 'LOADING' ? `<div class="actions project-actions">${action('refreshProject', 'Refresh Project', true)}${action('selectWorkspace', 'Choose Project Folder', true)}</div>` : ''}</div></section>`;
}


function renderPrd(state: PrdState, canImport: boolean): string {
  const labels = { NOT_SELECTED: 'Not selected', SELECTED: 'Selected', MISSING: 'Missing', CHANGED: 'Changed', ERROR: 'Unavailable' };
  const name = state.status === 'NOT_SELECTED' ? 'Not selected' : state.input.relativePath.split('/').pop() ?? state.input.relativePath;
  return `<div class="prd-input"><h4>Requirements document</h4><p>${escapeHtml(name)}</p>
    ${state.status === 'NOT_SELECTED' ? '' : `<dl class="project-details"><dt>Path</dt><dd>${escapeHtml(state.input.relativePath)}</dd><dt>State</dt><dd>${labels[state.status]}</dd></dl>`}
    ${state.status === 'ERROR' ? `<p role="status">${escapeHtml(state.message)}</p>` : ''}
    ${canImport ? `<div class="actions">${action('selectPrd', state.status === 'CHANGED' ? 'Re-import PRD' : state.status === 'SELECTED' ? 'Change PRD' : 'Select PRD')}</div>` : ''}
  </div>`;
}
