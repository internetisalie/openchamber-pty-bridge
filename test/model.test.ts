import { describe, expect, test } from 'bun:test';
import { OUTPUT_LIMIT_BYTES, applyOutput, boundUtf8Suffix, parseOutput, parseSessions, sessionsForParent } from '../src/model.ts';

const session = (id: string, parentSessionId: string, status: 'running' | 'killing' | 'exited' | 'killed', createdAt: string) => ({
  id,
  parentSessionId,
  title: id,
  command: 'redacted',
  args: [],
  workdir: 'redacted',
  status,
  notifyOnExit: false,
  timedOut: false,
  pid: 1,
  createdAt,
  lineCount: 0,
});

describe('bridge schema and session projection', () => {
  test('validates schema v1 and filters by exact parentSessionId before sorting', () => {
    const parsed = parseSessions({
      schemaVersion: 1,
      revision: 3,
      sessions: [
        session('old-exit', 'session-1', 'exited', '2026-01-01T00:00:00.000Z'),
        session('other', 'session-10', 'running', '2025-01-01T00:00:00.000Z'),
        session('new-run', 'session-1', 'running', '2026-01-03T00:00:00.000Z'),
        session('old-kill', 'session-1', 'killing', '2026-01-02T00:00:00.000Z'),
      ],
    });
    expect(parsed).not.toBeNull();
    expect(sessionsForParent(parsed!.sessions, 'session-1').map((item) => item.id)).toEqual([
      'old-kill', 'new-run', 'old-exit',
    ]);
  });

  test('rejects malformed and extra schema fields', () => {
    expect(parseSessions({ schemaVersion: 2, revision: 0, sessions: [] })).toBeNull();
    expect(parseSessions({ schemaVersion: 1, revision: 0, sessions: [], available: true })).toBeNull();
    expect(parseOutput({ schemaVersion: 1, revision: 1, reset: false, data: 42 })).toBeNull();
  });
});

describe('output revisions', () => {
  test('applies reset and append revisions per PTY', () => {
    const reset = applyOutput(undefined, { revision: 4, reset: true, data: 'hello' });
    expect(applyOutput(reset, { revision: 6, reset: false, data: '!!' })).toEqual({ revision: 6, text: 'hello!!' });
    expect(applyOutput(reset, { revision: 3, reset: false, data: 'stale' })).toBe(reset);
  });

  test('bounds output to a UTF-8-safe 512 KiB suffix', () => {
    const prefix = 'x'.repeat(OUTPUT_LIMIT_BYTES - 1);
    const state = applyOutput(undefined, { revision: OUTPUT_LIMIT_BYTES + 6, reset: true, data: `${prefix}€€` });
    const bytes = new TextEncoder().encode(state.text);
    expect(bytes.byteLength).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES);
    expect(state.text.endsWith('€€')).toBe(true);
    expect(state.text.includes('\uFFFD')).toBe(false);
    expect(boundUtf8Suffix(`€${'x'.repeat(OUTPUT_LIMIT_BYTES)}`).startsWith('x')).toBe(true);
  });
});
