import { describe, expect, test } from 'bun:test';
import { PtyBridgeController } from '../src/controller.ts';
import type { CapabilityResult, OutputResult, SessionsResult } from '../src/api.ts';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe('poll controller', () => {
  test('polls only while visible and ignores a stale session generation', async () => {
    const first = deferred<CapabilityResult>();
    const second = deferred<CapabilityResult>();
    const capabilities = [first, second];
    let capabilityCalls = 0;
    let sessionCalls = 0;
    const controller = new PtyBridgeController({
      api: {
        capability: () => { capabilityCalls += 1; return capabilities.shift()!.promise; },
        sessions: async (): Promise<SessionsResult> => { sessionCalls += 1; return { kind: 'ok', snapshot: { revision: 0, sessions: [] } }; },
        output: async (): Promise<OutputResult> => ({ kind: 'removed' }),
      },
      onChange: () => {},
    });

    controller.setSession('session-a');
    expect(capabilityCalls).toBe(0);
    controller.setVisible(true);
    expect(capabilityCalls).toBe(1);
    controller.setSession('session-b');
    expect(capabilityCalls).toBe(2);
    first.resolve({ kind: 'available', opencodePtyVersion: '0.4.1' });
    await flush();
    expect(sessionCalls).toBe(0);
    controller.setVisible(false);
    second.resolve({ kind: 'available', opencodePtyVersion: '0.4.1' });
    await flush();
    expect(sessionCalls).toBe(0);
    controller.dispose();
  });

  test('keeps successful state visible after a transient capability reprobe failure', async () => {
    const capabilities: CapabilityResult[] = [
      { kind: 'available', opencodePtyVersion: '0.4.1' },
      { kind: 'unavailable' },
    ];
    const controller = new PtyBridgeController({
      api: {
        capability: async () => capabilities.shift()!,
        sessions: async (): Promise<SessionsResult> => ({
          kind: 'ok',
          snapshot: {
            revision: 1,
            sessions: [{
              id: 'pty-1', parentSessionId: 'session-a', title: 'PTY', status: 'running',
              notifyOnExit: false, timedOut: false, pid: 1,
              createdAt: '2026-01-01T00:00:00.000Z', lineCount: 0,
            }],
          },
        }),
        output: () => new Promise<OutputResult>(() => {}),
      },
      onChange: () => {},
    });

    controller.setSession('session-a');
    controller.setVisible(true);
    await flush();
    expect(controller.snapshot()).toMatchObject({ status: 'available', warning: null, selectedId: 'pty-1' });
    controller.refresh();
    await flush();
    expect(controller.snapshot()).toMatchObject({ status: 'available', warning: 'unavailable', selectedId: 'pty-1' });
    expect(controller.snapshot().sessions).toHaveLength(1);
    controller.dispose();
  });
});
