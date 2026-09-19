export const OUTPUT_LIMIT_BYTES = 512 * 1024;

const SESSION_STATUSES = ['running', 'killing', 'exited', 'killed'] as const;
export type PtyStatus = (typeof SESSION_STATUSES)[number];

export type PtySession = {
  id: string;
  parentSessionId: string;
  title: string;
  description?: string;
  status: PtyStatus;
  notifyOnExit: boolean;
  timeoutSeconds?: number;
  timedOut: boolean;
  exitCode?: number;
  exitSignal?: number | string;
  pid: number;
  createdAt: string;
  lineCount: number;
};

export type SessionsSnapshot = {
  revision: number;
  sessions: PtySession[];
};

export type OutputSnapshot = {
  revision: number;
  reset: boolean;
  data: string;
};

export type OutputState = {
  revision: number;
  text: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0
);

const isInteger = (value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number => (
  Number.isSafeInteger(value) && (value as number) >= minimum
);

const isOptionalInteger = (value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number | undefined => (
  value === undefined || isInteger(value, minimum)
);

const isOptionalString = (value: unknown): value is string | undefined => (
  value === undefined || typeof value === 'string'
);

const SESSION_KEYS = [
  'id', 'parentSessionId', 'title', 'description', 'command', 'args', 'workdir',
  'status', 'notifyOnExit', 'timeoutSeconds', 'timedOut', 'exitCode',
  'exitSignal', 'pid', 'createdAt', 'lineCount',
] as const;

const parseSession = (value: unknown): PtySession | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, SESSION_KEYS)) return null;
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.parentSessionId)
    || typeof value.title !== 'string'
    || !isOptionalString(value.description)
    || typeof value.command !== 'string'
    || !Array.isArray(value.args)
    || !value.args.every((arg) => typeof arg === 'string')
    || typeof value.workdir !== 'string'
    || !SESSION_STATUSES.includes(value.status as PtyStatus)
    || typeof value.notifyOnExit !== 'boolean'
    || !isOptionalInteger(value.timeoutSeconds, 0)
    || typeof value.timedOut !== 'boolean'
    || !isOptionalInteger(value.exitCode)
    || !(value.exitSignal === undefined || typeof value.exitSignal === 'string' || isInteger(value.exitSignal))
    || !isInteger(value.pid, 0)
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || !isInteger(value.lineCount, 0)
  ) return null;

  const session: PtySession = {
    id: value.id,
    parentSessionId: value.parentSessionId,
    title: value.title,
    status: value.status as PtyStatus,
    notifyOnExit: value.notifyOnExit,
    timedOut: value.timedOut,
    pid: value.pid,
    createdAt: value.createdAt,
    lineCount: value.lineCount,
  };
  if (value.description !== undefined) session.description = value.description;
  if (value.timeoutSeconds !== undefined) session.timeoutSeconds = value.timeoutSeconds;
  if (value.exitCode !== undefined) session.exitCode = value.exitCode;
  if (value.exitSignal !== undefined) session.exitSignal = value.exitSignal as number | string;
  return session;
};

export const parseCapability = (value: unknown): { opencodePtyVersion: string } | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'schemaVersion', 'opencodePtyVersion'])) return null;
  if (
    value.id !== 'opencode-pty-bridge'
    || value.schemaVersion !== 1
    || !isNonEmptyString(value.opencodePtyVersion)
  ) return null;
  return { opencodePtyVersion: value.opencodePtyVersion };
};

export const parseSessions = (value: unknown): SessionsSnapshot | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'revision', 'sessions'])) return null;
  if (value.schemaVersion !== 1 || !isInteger(value.revision, 0) || !Array.isArray(value.sessions)) return null;
  const sessions: PtySession[] = [];
  for (const item of value.sessions) {
    const session = parseSession(item);
    if (!session) return null;
    sessions.push(session);
  }
  return { revision: value.revision, sessions };
};

export const parseOutput = (value: unknown): OutputSnapshot | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'revision', 'reset', 'data'])) return null;
  if (
    value.schemaVersion !== 1
    || !isInteger(value.revision, 0)
    || typeof value.reset !== 'boolean'
    || typeof value.data !== 'string'
  ) return null;
  return { revision: value.revision, reset: value.reset, data: value.data };
};

const activeRank = (status: PtyStatus): number => (
  status === 'running' || status === 'killing' ? 0 : 1
);

export const sessionsForParent = (sessions: readonly PtySession[], parentSessionId: string): PtySession[] => (
  sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => session.parentSessionId === parentSessionId)
    .sort((left, right) => (
      activeRank(left.session.status) - activeRank(right.session.status)
      || Date.parse(left.session.createdAt) - Date.parse(right.session.createdAt)
      || left.index - right.index
    ))
    .map(({ session }) => session)
);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const boundUtf8Suffix = (text: string, limit = OUTPUT_LIMIT_BYTES): string => {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= limit) return text;
  let start = bytes.byteLength - limit;
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return decoder.decode(bytes.subarray(start));
};

export const applyOutput = (current: OutputState | undefined, next: OutputSnapshot): OutputState => {
  if (current && next.revision < current.revision) return current;
  if (current && next.revision === current.revision && !next.reset) return current;
  const text = next.reset ? next.data : `${current?.text ?? ''}${next.data}`;
  return { revision: next.revision, text: boundUtf8Suffix(text) };
};
