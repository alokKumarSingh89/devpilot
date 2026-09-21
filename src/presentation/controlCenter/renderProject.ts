import type { PrdState } from '../../domain/document';
import type { ProjectSource, ProjectState } from '../../domain/project';
import { action } from './renderModels';
import { escapeHtml } from './escapeHtml';
import { tile } from './icons';

const sourceLabels: Record<ProjectSource, string> = { PRD: 'PRD', CODEBASE: 'Existing Code', PRD_AND_CODEBASE: 'PRD + Existing Code' };

export function renderProject(state: ProjectState, folderName?: string): string {
  let title: string;
  let description: string;
  let details = '';
  switch (state.status) {
    case 'WORKSPACE_SELECTION_REQUIRED': title = 'Choose project folder'; description = 'Multiple workspace folders are open. Explicitly select the DevPilot project root.'; break;
    case 'NO_WORKSPACE': title = 'No workspace open'; description = 'Open a folder to start using DevPilot.'; break;
    case 'AI_NOT_READY': title = 'No project initialized'; description = 'Model configuration required. Project initialization is unavailable until a reasoning model is selected and available.'; break;
    case 'NOT_INITIALIZED': title = 'No project initialized'; description = 'Initialize DevPilot to record how your project should be understood.'; break;
    case 'LOADING': title = 'Checking project'; description = 'Reading workspace project state…'; break;
    case 'ERROR': title = 'Project unavailable'; description = state.message; break;
    case 'INITIALIZING':
    case 'READY': {
      title = state.manifest.project.name;
      description = state.status === 'INITIALIZING'
        ? 'Project initialized. Project intelligence has not yet been generated. No analysis has run.'
        : 'Project is ready.';
      details = `<dl class="project-details"><dt>Status</dt><dd>${state.status === 'INITIALIZING' ? 'Initializing' : 'Ready'}</dd><dt>Source</dt><dd>${sourceLabels[state.manifest.project.source]}</dd></dl>`;
      if (state.manifest.project.source !== 'CODEBASE' || state.manifest.inputs?.prd) {
        const prd = state.prd ?? { status: 'NOT_SELECTED' };
        details += renderPrd(prd, state.status === 'INITIALIZING' && state.manifest.project.source !== 'CODEBASE');
      }
      break;
    }
  }
  return `<section class="card project" aria-labelledby="project-heading"><div class="card-heading">${tile('layers')}<div class="heading-copy"><h2 id="project-heading">Project</h2><h3>${escapeHtml(title)}</h3></div>${state.status === 'NOT_INITIALIZED' ? action('initialize', 'Initialize Project') : ''}</div>
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
