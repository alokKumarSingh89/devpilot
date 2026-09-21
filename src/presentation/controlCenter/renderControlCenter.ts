import type { ControlCenterState } from '../../application/controlCenterState';

interface ControlCenterResources {
  readonly stylesheetUri: string;
  readonly cspSource: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    <h1>DevPilot</h1>
    <p class="subtitle">AI Engineering Control Plane</p>
    <section class="workspace" aria-labelledby="workspace-heading">
      <h2 id="workspace-heading">Workspace</h2>
      ${workspace}
    </section>
    <p class="status">${escapeHtml(state.projectStatus)}</p>
  </main>
</body>
</html>`;
}
