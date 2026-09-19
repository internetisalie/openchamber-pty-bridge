import { describe, expect, test } from 'bun:test';
import { BridgeApi, outputRequest, type OpenCodeRequester } from '../src/api.ts';
import type { OpenCodeRequest } from '../src/protocol.ts';

const requester = (...responses: Array<{ status: number; body: string } | Error>): OpenCodeRequester & { seen: OpenCodeRequest[] } => {
  const seen: OpenCodeRequest[] = [];
  return {
    seen,
    openCodeRequest: async (request) => {
      seen.push(request);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('missing response');
      return response;
    },
  };
};

describe('bridge response classification', () => {
  test('distinguishes absent, auth, malformed, server, and network capability failures', async () => {
    expect(await new BridgeApi(requester({ status: 404, body: '' })).capability()).toEqual({ kind: 'absent' });
    expect(await new BridgeApi(requester({ status: 401, body: '' })).capability()).toEqual({ kind: 'auth' });
    expect(await new BridgeApi(requester({ status: 403, body: '' })).capability()).toEqual({ kind: 'auth' });
    expect(await new BridgeApi(requester({ status: 500, body: '' })).capability()).toEqual({ kind: 'unavailable' });
    expect(await new BridgeApi(requester({ status: 200, body: '{}' })).capability()).toEqual({ kind: 'unavailable' });
    expect(await new BridgeApi(requester(new Error('offline'))).capability()).toEqual({ kind: 'unavailable' });
  });

  test('accepts the exact capability and marks only output 404 as removal', async () => {
    const available = new BridgeApi(requester({
      status: 200,
      body: JSON.stringify({ id: 'opencode-pty-bridge', schemaVersion: 1, opencodePtyVersion: '0.4.1' }),
    }));
    expect(await available.capability()).toEqual({ kind: 'available', opencodePtyVersion: '0.4.1' });
    expect(await new BridgeApi(requester({ status: 404, body: '' })).sessions()).toEqual({ kind: 'unavailable' });
    expect(await new BridgeApi(requester({ status: 404, body: '' })).output('gone')).toEqual({ kind: 'removed' });
  });

  test('encodes PTY IDs as one path segment and sends byte revisions as query', () => {
    expect(outputRequest('pty/a ?#', 17)).toEqual({
      path: '/sessions/pty%2Fa%20%3F%23/output',
      query: { after: '17' },
    });
  });
});
