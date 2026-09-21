import { describe, expect, it } from 'vitest';
import { getControlCenterState } from '../src/application/controlCenterState';
import { escapeHtml, renderControlCenter } from '../src/presentation/controlCenter/renderControlCenter';

const resources = {
  stylesheetUri: 'https://local.vscode-resource.vscode-cdn.net/media/controlCenter.css',
  cspSource: 'https://*.vscode-cdn.net',
};

describe('Control Center rendering', () => {
  it('shows the product and uninitialized state without a workspace', () => {
    const html = renderControlCenter(getControlCenterState(undefined), resources);
    expect(html).toContain('<h1>DevPilot</h1>');
    expect(html).toContain('AI Engineering Control Plane');
    expect(html).toContain('No project initialized');
    expect(html).toContain('<h2 id="workspace-heading">Workspace</h2>');
    expect(html).toContain('No workspace open');
    expect(html).not.toContain('undefined');
  });

  it('shows the supplied workspace name without implying project initialization', () => {
    const html = renderControlCenter(getControlCenterState([{ name: 'Engineering' }]), resources);
    expect(html).toContain('<li>Engineering</li>');
    expect(html).toContain('No project initialized');
  });

  it('renders malicious workspace names as text', () => {
    const maliciousName = '<script>alert("x")</script> & \'team\'';
    const html = renderControlCenter(getControlCenterState([{ name: maliciousName }]), resources);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;team&#39;');
    expect(html).not.toContain('<script');
  });

  it('escapes resource attributes so they cannot create new attributes or elements', () => {
    const html = renderControlCenter(getControlCenterState(undefined), {
      stylesheetUri: 'local?x=" onload="bad&y=<tag>',
      cspSource: 'source"><script>bad</script>',
    });
    expect(html).toContain('href="local?x=&quot; onload=&quot;bad&amp;y=&lt;tag&gt;"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('source&quot;&gt;&lt;script&gt;bad&lt;/script&gt;');
  });

  it('denies resources by default and permits only host-provided local styles', () => {
    const html = renderControlCenter(getControlCenterState(undefined), resources);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(escapeHtml(
      "default-src 'none'; style-src https://*.vscode-cdn.net; base-uri 'none'; form-action 'none';",
    ));
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<link'));
    expect(html).not.toMatch(/<script\b|<style\b|unsafe-inline|unsafe-eval/);
    expect(html).toContain(`href="${resources.stylesheetUri}"`);
  });
});

describe('HTML escaping', () => {
  it.each([
    ['', ''],
    ['DevPilot 日本語', 'DevPilot 日本語'],
    ['&<>"\'', '&amp;&lt;&gt;&quot;&#39;'],
    ['&lt;script&gt;', '&amp;lt;script&amp;gt;'],
  ])('escapes %j without interpreting existing entities', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });
});


describe('workspace folder state', () => {
  it('treats an empty folder list as no workspace open', () => {
    const html = renderControlCenter(getControlCenterState([]), resources);
    expect(html).toContain('No workspace open');
  });

  it('shows every folder in a multi-root workspace in workspace order', () => {
    const state = getControlCenterState([{ name: 'api' }, { name: 'web' }]);
    const html = renderControlCenter(state, resources);
    expect(html).toContain('<ul><li>api</li><li>web</li></ul>');
    expect(html).not.toContain('No workspace open');
  });
});


it('escapes workspace paths and keeps coding-agent configuration unavailable', () => {
  const state = getControlCenterState([{ name: 'workspace', path: '/projects/<untrusted>&team' }]);
  const html = renderControlCenter(state, resources);
  expect(html).toContain('/projects/&lt;untrusted&gt;&amp;team');
  expect(html).toContain('command:devpilot.openFolder');
  expect(html).toContain('Coding Agent');
  expect(html).toContain('<button class="action secondary" disabled>');
  expect(html).not.toContain('command:devpilot.configureAgent');
});
