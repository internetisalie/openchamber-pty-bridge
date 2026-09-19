import type { GuestRequestResult } from '@openchamber/sdk';
import { parseCapability, parseOutput, parseSessions, type OutputSnapshot, type SessionsSnapshot } from './model.ts';
import type { OpenCodeRequest } from './protocol.ts';

export const OPENCODE_PLUGIN_ID = 'opencode-pty-bridge';

export type OpenCodeRequester = {
  openCodeRequest: (request: OpenCodeRequest) => Promise<GuestRequestResult>;
};

export type FailureKind = 'auth' | 'unavailable';
export type CapabilityResult =
  | { kind: 'available'; opencodePtyVersion: string }
  | { kind: 'absent' }
  | { kind: FailureKind };

export type SessionsResult =
  | { kind: 'ok'; snapshot: SessionsSnapshot }
  | { kind: FailureKind };

export type OutputResult =
  | { kind: 'ok'; snapshot: OutputSnapshot }
  | { kind: 'removed' }
  | { kind: FailureKind };

const statusFailure = (status: number): FailureKind => (
  status === 401 || status === 403 ? 'auth' : 'unavailable'
);

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

const get = (requester: OpenCodeRequester, path: string, query?: Record<string, string>): Promise<GuestRequestResult> => (
  requester.openCodeRequest({ pluginId: OPENCODE_PLUGIN_ID, method: 'GET', path, ...(query ? { query } : {}) })
);

export const outputRequest = (id: string, after?: number): Pick<OpenCodeRequest, 'path' | 'query'> => ({
  path: `/sessions/${encodeURIComponent(id)}/output`,
  ...(after === undefined ? {} : { query: { after: String(after) } }),
});

export class BridgeApi {
  constructor(private readonly requester: OpenCodeRequester) {}

  async capability(): Promise<CapabilityResult> {
    let response: GuestRequestResult;
    try {
      response = await get(this.requester, '/');
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status === 404) return { kind: 'absent' };
    if (response.status !== 200) return { kind: statusFailure(response.status) };
    const capability = parseCapability(parseJson(response.body));
    return capability ? { kind: 'available', ...capability } : { kind: 'unavailable' };
  }

  async sessions(): Promise<SessionsResult> {
    let response: GuestRequestResult;
    try {
      response = await get(this.requester, '/sessions');
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status !== 200) return { kind: statusFailure(response.status) };
    const snapshot = parseSessions(parseJson(response.body));
    return snapshot ? { kind: 'ok', snapshot } : { kind: 'unavailable' };
  }

  async output(id: string, after?: number): Promise<OutputResult> {
    const request = outputRequest(id, after);
    let response: GuestRequestResult;
    try {
      response = await get(this.requester, request.path, request.query);
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status === 404) return { kind: 'removed' };
    if (response.status !== 200) return { kind: statusFailure(response.status) };
    const snapshot = parseOutput(parseJson(response.body));
    return snapshot ? { kind: 'ok', snapshot } : { kind: 'unavailable' };
  }
}
