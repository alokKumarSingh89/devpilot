import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { VscodeLanguageModelGateway, VscodeModelDiscovery, WorkspaceModelSelectionStore } from '../src/infrastructure/models/vscodeModels';

const host = vi.hoisted(() => ({
  select: vi.fn(),
  sources: [] as { token: { isCancellationRequested: boolean }; cancel: () => void; dispose: ReturnType<typeof vi.fn> }[],
}));
vi.mock('vscode', () => ({
  lm: { selectChatModels: host.select },
  CancellationError: class extends Error {},
  LanguageModelError: class extends Error { constructor(readonly code: string) { super('private detail'); } },
  LanguageModelChatMessage: { User: (content: string) => ({ role: 'user', content }) },
  CancellationTokenSource: class {
    private readonly listeners = new Set<() => void>();
    token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; } };
    dispose = vi.fn();
    cancel = () => { this.token.isCancellationRequested = true; this.listeners.forEach((listener) => listener()); };
    constructor() { host.sources.push(this); }
  },
}));

function cancellation() {
  const listeners = new Set<() => void>();
  return {
    isCancellationRequested: false,
    onCancellationRequested(listener: () => void) {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    cancel() { this.isCancellationRequested = true; listeners.forEach((listener) => listener()); },
    listeners,
  };
}
function model() {
  return {
    id: 'chosen', name: 'Chosen', vendor: 'provider', family: 'reasoning', maxInputTokens: 2048,
    countTokens: vi.fn(async () => 100),
    sendRequest: vi.fn(async (): Promise<{ text: AsyncIterable<string> }> => ({ text: (async function* () { yield 'DEV PILOT '; yield 'AI READY'; })() })),
  };
}

beforeEach(() => { host.select.mockReset(); host.sources.length = 0; });

describe('VS Code model adapters', () => {
  it('maps metadata without exposing editor objects and filters denied models', async () => {
    const available = model();
    host.select.mockResolvedValue([available, { ...model(), id: 'denied' }]);
    const access = { onDidChange: () => ({ dispose() {} }), canSendRequest: (item: { id: string }) => item.id === 'denied' ? false : undefined } as vscode.LanguageModelAccessInformation;
    const result = await new VscodeModelDiscovery(access).discover();
    expect(result).toEqual([{ id: 'chosen', name: 'Chosen', vendor: 'provider', family: 'reasoning', maxInputTokens: 2048 }]);
    expect(result[0]).not.toHaveProperty('sendRequest');
  });

  it('stores only an ID in workspace state', async () => {
    const state = { get: vi.fn(() => 'chosen'), update: vi.fn(async () => undefined) };
    const store = new WorkspaceModelSelectionStore(state as unknown as vscode.Memento);
    expect(store.read()).toBe('chosen');
    await store.write('other');
    expect(state.update).toHaveBeenCalledExactlyOnceWith('devpilot.reasoningModelId', 'other');
  });

  it('resolves by ID on every request and consumes the actual stream', async () => {
    const first = model();
    const second = model();
    host.select.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);
    const gateway = new VscodeLanguageModelGateway();
    const token = cancellation();
    expect(await gateway.sendRequest('chosen', 'test', token)).toBe('DEV PILOT AI READY');
    await gateway.sendRequest('chosen', 'test', token);
    expect(host.select).toHaveBeenNthCalledWith(2, { id: 'chosen' });
    expect(first.sendRequest).toHaveBeenCalledOnce();
    expect(second.sendRequest).toHaveBeenCalledOnce();
    expect(first.sendRequest).toHaveBeenCalledWith([{ role: 'user', content: 'test' }], {}, host.sources[0]?.token);
    expect(token.listeners.size).toBe(0);
    host.sources.forEach((source) => expect(source.dispose).toHaveBeenCalledOnce());
  });

  it('rejects a missing selected model without using another model', async () => {
    const other = { ...model(), id: 'other' };
    host.select.mockResolvedValue([other]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'test', cancellation())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(other.sendRequest).not.toHaveBeenCalled();
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });

  it('propagates cancellation during streaming and disposes resources', async () => {
    const token = cancellation();
    const available = model();
    available.sendRequest.mockResolvedValue({ text: (async function* () { yield 'first'; token.cancel(); yield 'second'; })() });
    host.select.mockResolvedValue([available]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'test', token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(host.sources[0]?.token.isCancellationRequested).toBe(true);
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
    expect(token.listeners.size).toBe(0);
  });

  it('handles stream failures without returning partial text or raw errors', async () => {
    const available = model();
    available.sendRequest.mockResolvedValue({ text: (async function* () { yield 'partial'; throw new Error('raw secret'); })() });
    host.select.mockResolvedValue([available]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'test', cancellation())).rejects.toMatchObject({ code: 'PROVIDER' });
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });

  it.each([['NoPermissions', 'ACCESS'], ['Blocked', 'ACCESS'], ['NotFound', 'NOT_FOUND']])('maps %s to %s', async (code, expected) => {
    const api = await import('vscode');
    const available = model();
    available.sendRequest.mockRejectedValue(new api.LanguageModelError(code));
    host.select.mockResolvedValue([available]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'test', cancellation())).rejects.toMatchObject({ code: expected });
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });

  it('cancels in-flight work when the extension disposes the gateway', async () => {
    const gateway = new VscodeLanguageModelGateway();
    const available = model();
    available.sendRequest.mockResolvedValue({ text: (async function* () { gateway.dispose(); yield 'late'; })() });
    host.select.mockResolvedValue([available]);
    await expect(gateway.sendRequest('chosen', 'test', cancellation())).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(host.sources[0]?.token.isCancellationRequested).toBe(true);
    await expect(gateway.sendRequest('chosen', 'test', cancellation())).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

it('does not send after cancellation while resolving the selected model', async () => {
  const token = cancellation();
  const available = model();
  host.select.mockImplementation(async () => { token.cancel(); return [available]; });
  await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'test', token)).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(available.sendRequest).not.toHaveBeenCalled();
  expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  expect(token.listeners.size).toBe(0);
});

it('bounds oversized responses and cancels provider work', async () => {
  const available = model();
  available.sendRequest.mockResolvedValue({ text: (async function* () { yield 'x'.repeat(8193); })() });
  host.select.mockResolvedValue([available]);
  await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'test', cancellation())).rejects.toMatchObject({ code: 'PROVIDER' });
  expect(host.sources[0]?.token.isCancellationRequested).toBe(true);
  expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
});

it('clear removes only DevPilot workspace-state selection', async () => {
  const values = new Map<string, unknown>([
    ['devpilot.reasoningModelId', 'chosen'], ['unrelated.preference', 'keep'],
  ]);
  const state = {
    get: (key: string) => values.get(key),
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    }),
  };
  const store = new WorkspaceModelSelectionStore(state as unknown as vscode.Memento);
  await store.clear();
  expect(state.update).toHaveBeenCalledExactlyOnceWith('devpilot.reasoningModelId', undefined);
  expect(store.read()).toBeUndefined();
  expect([...values]).toEqual([['unrelated.preference', 'keep']]);
  expect(host.select).not.toHaveBeenCalled();
});

const analysisOptions = { purpose: 'prdAnalysis' as const, expectedModel: { vendor: 'provider', family: 'reasoning' }, maxResponseCharacters: 262144, outputHeadroomTokens: 4096 };
describe('analysis transport limits and cancellation', () => {
  it('counts the actual message on the freshly resolved model and permits bounded analysis output beyond Test Model limits', async () => {
    const available = { ...model(), maxInputTokens: 32000 };
    available.sendRequest.mockResolvedValue({ text: (async function* () { yield 'x'.repeat(9000); })() });
    host.select.mockResolvedValue([available]);
    const result = await new VscodeLanguageModelGateway().sendRequest('chosen', 'PRD prompt', cancellation(), analysisOptions);
    expect(result).toHaveLength(9000);
    expect(available.countTokens).toHaveBeenCalledWith({ role: 'user', content: 'PRD prompt' }, host.sources[0]?.token);
    expect(available.sendRequest).toHaveBeenCalledWith([{ role: 'user', content: 'PRD prompt' }], { justification: expect.any(String) }, host.sources[0]?.token);
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
  it.each([0, Number.NaN, 4096, 10000])('rejects unsafe input capacity %s before sending', async (capacity) => {
    const available = { ...model(), maxInputTokens: capacity };
    available.countTokens.mockResolvedValue(8000);
    host.select.mockResolvedValue([available]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'prompt', cancellation(), analysisOptions)).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    expect(available.sendRequest).not.toHaveBeenCalled();
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
  it('rejects unknown token counts and changed generating metadata', async () => {
    const available = { ...model(), maxInputTokens: 32000 };
    available.countTokens.mockResolvedValue(Number.NaN); host.select.mockResolvedValue([available]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'prompt', cancellation(), analysisOptions)).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    host.select.mockResolvedValue([{ ...available, family: 'different' }]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'prompt', cancellation(), analysisOptions)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(available.sendRequest).not.toHaveBeenCalled();
  });
  it('rejects oversized analysis output and cancels the provider without returning a partial response', async () => {
    const available = { ...model(), maxInputTokens: 32000 };
    available.sendRequest.mockResolvedValue({ text: (async function* () { yield 'x'.repeat(262145); })() });
    host.select.mockResolvedValue([available]);
    await expect(new VscodeLanguageModelGateway().sendRequest('chosen', 'prompt', cancellation(), analysisOptions)).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    expect(host.sources[0]?.token.isCancellationRequested).toBe(true);
  });
  it('cancels immediately during token counting even if the provider does not settle', async () => {
    const available = { ...model(), maxInputTokens: 32000 };
    available.countTokens.mockImplementation(() => new Promise<number>(() => undefined));
    host.select.mockResolvedValue([available]);
    const token = cancellation(); const gateway = new VscodeLanguageModelGateway();
    const running = gateway.sendRequest('chosen', 'prompt', token, analysisOptions);
    const rejection = expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(available.countTokens).toHaveBeenCalledOnce()); token.cancel(); await rejection;
    expect(available.sendRequest).not.toHaveBeenCalled(); expect(token.listeners.size).toBe(0);
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
  it('stops waiting on a stalled stream and closes its iterator on cancellation', async () => {
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const next = vi.fn(() => new Promise<IteratorResult<string>>(() => undefined));
    const available = { ...model(), maxInputTokens: 32000 };
    available.sendRequest.mockResolvedValue({ text: { [Symbol.asyncIterator]: () => ({ next, return: close }) } });
    host.select.mockResolvedValue([available]);
    const token = cancellation(); const running = new VscodeLanguageModelGateway().sendRequest('chosen', 'prompt', token, analysisOptions);
    const rejection = expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce()); token.cancel(); await rejection;
    expect(next).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
});
