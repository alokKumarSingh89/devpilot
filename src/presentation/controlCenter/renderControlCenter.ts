import { escapeHtml } from './escapeHtml';
export { escapeHtml } from './escapeHtml';
import { renderModels, renderCodingAgent, action } from './renderModels';
import { renderProject } from './renderProject';
import { tile } from './icons';
import type { ControlCenterState } from '../../application/controlCenterState';

interface ControlCenterResources {
  readonly stylesheetUri: string;
  readonly cspSource: string;
}

export function renderControlCenter(
  state: ControlCenterState,
  resources: ControlCenterResources,
): string {
  const workspace = state.workspaceFolderNames.length === 0
    ? '<p>No workspace open</p>'
    : `<ul>${state.workspaceFolderNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`;
  // Only the host-provided local resource origin may load styles. No scripts run.
  const policy = `default-src 'none'; style-src ${resources.cspSource}; base-uri 'none'; form-action 'none';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeHtml(resources.stylesheetUri)}">
  <title>DevPilot</title>
</head>
<body>
  <main>
    <header><h1>DevPilot</h1><p class="subtitle">AI Engineering Control Plane</p></header>
    <section class="card workspace" aria-labelledby="workspace-heading">
      <div class="card-heading">${tile('folder')}<div class="heading-copy"><h2 id="workspace-heading">Workspace</h2>${workspace}
      ${state.workspacePaths.map((path) => `<p class="workspace-path muted">${escapeHtml(path)}</p>`).join('')}</div>${action('openFolder', 'Open Folder', true)}</div>
    </section>
    ${state.reasoning ? renderModels(state.reasoning) : ''}
    ${renderCodingAgent()}
    ${renderProject(state.project, state.projectFolderName)}
    <footer><span>Build better software with AI</span></footer>
  </main>
</body>
</html>`;
}
