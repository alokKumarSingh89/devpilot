import { describe, expect, it, vi } from 'vitest';
import { ReasoningModelService } from '../src/application/models/ReasoningModelService';
import { ModelFailure } from '../src/application/models/ModelFailure';
import type { ReasoningModel } from '../src/domain/reasoningModel';
import { renderModels } from '../src/presentation/controlCenter/renderModels';

const model: ReasoningModel = { id: 'reasoner', name: 'Reasoner', vendor: 'vendor', family: 'family', maxInputTokens: 4096 };
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

function setup(available: readonly ReasoningModel[], saved?: string) {
  let selected = saved;
  const discovery = { discover: vi.fn(async () => available) };
  const store = { clear: vi.fn(async () => { selected = undefined; }), read: () => selected, write: vi.fn(async (id: string) => { selected = id; }) };
  const gateway = { sendRequest: vi.fn(async () => 'DEV PILOT AI READY') };
  return { service: new ReasoningModelService(discovery, store, gateway), discovery, store, gateway };
}

describe('reasoning model gate', () => {
  it.each([
    [[], undefined, 'NO_MODEL'],
    [[model], undefined, 'SELECTION_REQUIRED'],
    [[model], model.id, 'READY'],
    [[model], 'missing', 'SELECTION_REQUIRED'],
  ] as const)('resolves models %j and selection %s to %s', async (models, id, expected) => {
    const { service, store } = setup(models, id);
    await service.refresh();
    expect(service.state.status).toBe(expected);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('persists only an explicitly selected valid ID', async () => {
    const { service, store } = setup([model]);
    await service.select(model.id);
    expect(store.write).toHaveBeenCalledExactlyOnceWith(model.id);
    expect(service.state.status).toBe('READY');
  });

  it('rejects an invalid selection without persistence', async () => {
    const { service, store } = setup([model]);
    await expect(service.select('forged')).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
    expect(store.write).not.toHaveBeenCalled();
  });

  it.each([{ models: [] }, { models: [model] }])('blocks direct tests without valid selection: %j', async ({ models }) => {
    const { service, gateway } = setup(models);
    await expect(service.testModel(token)).rejects.toBeInstanceOf(ModelFailure);
    expect(gateway.sendRequest).not.toHaveBeenCalled();
  });

  it('revalidates a persisted selection before sending', async () => {
    const { service, discovery, gateway } = setup([model], model.id);
    await service.refresh();
    discovery.discover.mockResolvedValue([{ ...model, id: 'replacement' }]);
    await expect(service.testModel(token)).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
    expect(gateway.sendRequest).not.toHaveBeenCalled();
    expect(service.state.status).toBe('SELECTION_REQUIRED');
  });

  it('shows the actual response, even when the model does not follow instructions', async () => {
    const { service, gateway } = setup([model], model.id);
    gateway.sendRequest.mockResolvedValue('Something else <script>bad</script>');
    await service.testModel(token);
    expect(gateway.sendRequest).toHaveBeenCalledWith(model.id, 'Reply with exactly DEV PILOT AI READY and nothing else.', token);
    expect(service.testResult?.response).toBe('Something else <script>bad</script>');
    expect(renderModels(service)).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(renderModels(service)).not.toContain('<script>');
  });

  it('does not send a request when already cancelled', async () => {
    const { service, gateway } = setup([model], model.id);
    await expect(service.testModel({ ...token, isCancellationRequested: true })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(gateway.sendRequest).not.toHaveBeenCalled();
    expect(service.testing).toBe(false);
  });

  it('closes the gate when a model disappears during a request', async () => {
    const { service, gateway } = setup([model, { ...model, id: 'other' }], model.id);
    gateway.sendRequest.mockRejectedValue(new ModelFailure('NOT_FOUND'));
    await expect(service.testModel(token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(service.state.status).toBe('SELECTION_REQUIRED');
  });

  it('sanitizes unexpected provider failures', async () => {
    const { service, gateway } = setup([model], model.id);
    gateway.sendRequest.mockRejectedValue(new Error('secret raw stack'));
    await expect(service.testModel(token)).rejects.toMatchObject({ code: 'PROVIDER' });
    expect(renderModels(service)).not.toContain('secret raw stack');
    expect(service.testing).toBe(false);
  });

  it('closes the gate on discovery failure and exposes a safe message', async () => {
    const { service, discovery } = setup([model], model.id);
    await service.refresh();
    discovery.discover.mockRejectedValue(new Error('private endpoint'));
    await expect(service.refresh()).rejects.toMatchObject({ code: 'PROVIDER' });
    expect(service.state.status).toBe('NO_MODEL');
    expect(service.notice).not.toContain('private endpoint');
  });

  it('does not mark a selection READY if saving fails', async () => {
    const { service, store } = setup([model]);
    store.write.mockRejectedValue(new Error('disk error'));
    await expect(service.select(model.id)).rejects.toMatchObject({ code: 'PERSISTENCE' });
    expect(service.state.status).toBe('SELECTION_REQUIRED');
  });

  it('escapes model metadata and presents all three states', async () => {
    const { service, discovery } = setup([]);
    expect(renderModels(service)).toContain('Refresh Models');
    expect(renderModels(service)).toContain('No reasoning models available');
    expect(renderModels(service)).not.toContain('command:devpilot.selectModel');
    discovery.discover.mockResolvedValue([{ ...model, name: '<img>', vendor: '<vendor>', family: '<family>' }]);
    await service.refresh();
    expect(renderModels(service)).toContain('Select Reasoning Model');
    expect(renderModels(service)).toContain('1 reasoning model available.');
    await service.select(model.id);
    expect(renderModels(service)).toContain('AI Ready');
    expect(renderModels(service)).toContain('4,096 tokens');
    expect(renderModels(service)).toContain('&lt;img&gt;');
    expect(renderModels(service)).toContain('&lt;vendor&gt;');
    expect(renderModels(service)).toContain('Change Model');
  });
});

describe('model operation concurrency', () => {
  it('rejects overlapping tests without sending a second request', async () => {
    const { service, gateway } = setup([model], model.id);
    let finish: (response: string) => void = () => undefined;
    gateway.sendRequest.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = service.testModel(token);
    await vi.waitFor(() => expect(gateway.sendRequest).toHaveBeenCalledOnce());
    await expect(service.testModel(token)).rejects.toMatchObject({ code: 'BUSY' });
    finish('actual response');
    await running;
    expect(service.testResult?.response).toBe('actual response');
  });

  it('does not invalidate a newly selected model when an older request fails', async () => {
    const { service, gateway } = setup([model, { ...model, id: 'new' }], model.id);
    let fail: (error: Error) => void = () => undefined;
    gateway.sendRequest.mockImplementation(() => new Promise<string>((_resolve, reject) => { fail = reject; }));
    const running = service.testModel(token);
    const rejection = expect(running).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await vi.waitFor(() => expect(gateway.sendRequest).toHaveBeenCalledOnce());
    await service.select('new');
    fail(new ModelFailure('NOT_FOUND'));
    await rejection;
    expect(service.state).toMatchObject({ status: 'READY', selected: { id: 'new' } });
  });
});

describe('clearing the DevPilot preference', () => {
  it('transitions READY to SELECTION_REQUIRED immediately without changing discovery', async () => {
    const { service, store, discovery } = setup([model], model.id);
    await service.refresh();
    await service.testModel(token);
    const listener = vi.fn();
    service.onDidChange(listener);
    const discoveryCalls = discovery.discover.mock.calls.length;
    await service.clear();
    expect(store.clear).toHaveBeenCalledOnce();
    expect(store.read()).toBeUndefined();
    expect(service.state).toEqual({ status: 'SELECTION_REQUIRED', models: [model] });
    expect(service.testResult).toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
    expect(discovery.discover).toHaveBeenCalledTimes(discoveryCalls);
    await service.refresh();
    expect(service.state.status).toBe('SELECTION_REQUIRED');
    await expect(service.requireReady()).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
  });

  it('does not clear the visible selection when persistence fails', async () => {
    const { service, store } = setup([model], model.id);
    await service.refresh();
    store.clear.mockRejectedValue(new Error('private disk details'));
    await expect(service.clear()).rejects.toMatchObject({ code: 'PERSISTENCE' });
    expect(service.state.status).toBe('READY');
  });

  it('retains NO_MODEL when cleared with an empty catalog', async () => {
    const { service } = setup([], 'stale');
    await service.clear();
    expect(service.state.status).toBe('NO_MODEL');
    await expect(service.requireReady()).rejects.toMatchObject({ code: 'NO_MODEL' });
  });

  it('does not repopulate a cleared model test result when the old response arrives', async () => {
    const { service, gateway } = setup([model], model.id);
    let finish: (response: string) => void = () => undefined;
    gateway.sendRequest.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = service.testModel(token);
    await vi.waitFor(() => expect(gateway.sendRequest).toHaveBeenCalledOnce());
    await service.clear();
    finish('late response');
    await running;
    expect(service.state.status).toBe('SELECTION_REQUIRED');
    expect(service.testResult).toBeUndefined();
  });
});
