import { describe, expect, it } from 'vitest';
import { resolveModelState } from '../src/domain/reasoningModel';
import { renderModels, renderProject } from '../src/presentation/controlCenter/renderModels';

const model = { id: 'chosen', name: 'GPT-5 mini', vendor: 'copilot', family: 'gpt-5-mini' };
const view = (models = [model], selected?: string) => ({
  state: resolveModelState(models, selected), notice: undefined, testResult: undefined, testing: false,
});

describe('AI configuration hierarchy', () => {
  it('explains zero models without showing selection or project actions', () => {
    const state = view([]);
    const html = renderModels(state);
    expect(html).toContain('AI Configuration');
    expect(html).toContain('No reasoning models available');
    expect(html).toContain('Refresh Models');
    expect(html).not.toContain('command:devpilot.selectModel');
    expect(html).not.toContain('command:devpilot.clearModel');
    expect(html).not.toContain('NO_MODEL');
    expect(renderProject('No project initialized', state.state)).toContain('until an AI model is configured');
    expect(renderProject('No project initialized', state.state)).not.toContain('command:');
  });

  it('shows setup guidance and a count instead of a dense catalog', () => {
    const state = view([model, { ...model, id: 'second' }]);
    const html = renderModels(state);
    expect(html).toContain('Setup required');
    expect(html).toContain('2 reasoning models available.');
    expect(html).toContain('Select Reasoning Model');
    expect(html).toContain('architecture reasoning');
    expect(html).not.toContain('GPT-5 mini');
    expect(html).not.toContain('SELECTION_REQUIRED');
    expect(renderProject('No project initialized', state.state)).toContain('until a reasoning model is selected');
  });

  it('identifies the selected model and exposes change, clear, test, and the gated project entry', () => {
    const state = view([model], model.id);
    const html = renderModels(state);
    expect(html).toContain('AI Ready');
    expect(html).toContain('<dt>Reasoning Model</dt><dd>GPT-5 mini</dd>');
    expect(html).toContain('<dt>Provider</dt><dd>GitHub Copilot</dd>');
    expect(html).toContain('<dt class="sr-only">Family</dt><dd class="muted">gpt-5-mini</dd>');
    for (const command of ['testModel', 'selectModel', 'clearModel', 'refreshModels']) {
      expect(html).toContain(`command:devpilot.${command}`);
    }
    expect(renderProject('No project initialized', state.state)).toContain('command:devpilot.initializeProject');
    expect(renderProject('No project initialized', state.state)).toContain('not implemented in this version');
  });
});
