import { describe, expect, test } from 'bun:test';
import { OPENCHAMBER_SDK_API_VERSION, OPENCHAMBER_SDK_CHANNEL } from '@openchamber/sdk';
import { connectOpenCodeProtocol, type ProtocolTarget } from '../src/protocol.ts';

class FakeTarget implements ProtocolTarget {
  posted: unknown[] = [];
  listeners = new Set<(event: MessageEvent) => void>();
  parent = {
    postMessage: (message: unknown): void => { this.posted.push(message); },
  };

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void { this.listeners.delete(listener); }
  answer(data: unknown, source: unknown = this.parent): void {
    for (const listener of this.listeners) listener({ data, source } as MessageEvent);
  }
}

describe('additive OpenCode protocol adapter', () => {
  test('posts only opencode-request and resolves host result semantics', async () => {
    const target = new FakeTarget();
    const protocol = connectOpenCodeProtocol({ target, idPrefix: 'test', acceptSource: () => true });
    const pending = protocol.openCodeRequest({ pluginId: 'opencode-pty-bridge', method: 'GET', path: '/sessions' });
    const posted = target.posted[0] as { id: string; type: string; payload: unknown };
    expect(posted).toMatchObject({ type: 'opencode-request', payload: { pluginId: 'opencode-pty-bridge', method: 'GET', path: '/sessions' } });
    target.answer({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: 'result',
      id: posted.id,
      ok: true,
      payload: { status: 200, body: '{}' },
    });
    expect(await pending).toEqual({ status: 200, body: '{}' });
    protocol.dispose();
  });

  test('preserves host errors and refuses bad paths and malformed results', async () => {
    const target = new FakeTarget();
    const protocol = connectOpenCodeProtocol({ target, idPrefix: 'test', acceptSource: () => true });
    await expect(protocol.openCodeRequest({ pluginId: 'opencode-pty-bridge', method: 'GET', path: '/../secret' }))
      .rejects.toMatchObject({ code: 'BAD_PATH' });

    const denied = protocol.openCodeRequest({ pluginId: 'opencode-pty-bridge', method: 'GET', path: '/' });
    const deniedMessage = target.posted.at(-1) as { id: string };
    target.answer({ channel: OPENCHAMBER_SDK_CHANNEL, v: 1, type: 'result', id: deniedMessage.id, ok: false, code: 'NOT_GRANTED', error: 'Denied' });
    await expect(denied).rejects.toMatchObject({ code: 'NOT_GRANTED', message: 'Denied' });

    const malformed = protocol.openCodeRequest({ pluginId: 'opencode-pty-bridge', method: 'GET', path: '/' });
    const malformedMessage = target.posted.at(-1) as { id: string };
    target.answer({ channel: OPENCHAMBER_SDK_CHANNEL, v: 1, type: 'result', id: malformedMessage.id, ok: true, payload: { status: '200' } });
    await expect(malformed).rejects.toMatchObject({ code: 'HOST_REJECTED' });
    protocol.dispose();
  });
});
