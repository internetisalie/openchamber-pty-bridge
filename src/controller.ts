import { applyOutput, sessionsForParent, type OutputState, type PtySession } from './model.ts';
import type { BridgeApi, CapabilityResult, FailureKind, OutputResult, SessionsResult } from './api.ts';

export type BridgeStatus = 'idle' | 'probing' | 'available' | 'absent' | 'auth' | 'unavailable';

export type ControllerSnapshot = {
  visible: boolean;
  sessionId: string | null;
  status: BridgeStatus;
  warning: FailureKind | null;
  sessions: readonly PtySession[];
  selectedId: string | null;
  selectedOutput: OutputState | null;
  outputLoading: boolean;
  outputWarning: FailureKind | null;
};

type TimerHandle = ReturnType<typeof setTimeout>;
type Timers = {
  setTimeout: (callback: () => void, delay: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

type BridgeDataApi = Pick<BridgeApi, 'capability' | 'sessions' | 'output'>;

type ControllerOptions = {
  api: BridgeDataApi;
  onChange: (snapshot: ControllerSnapshot) => void;
  timers?: Timers;
  sessionsPollMs?: number;
  outputPollMs?: number;
  capabilityPollMs?: number;
};

const defaultTimers: Timers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
};

export class PtyBridgeController {
  private readonly api: BridgeDataApi;
  private readonly onChange: (snapshot: ControllerSnapshot) => void;
  private readonly timers: Timers;
  private readonly sessionsPollMs: number;
  private readonly outputPollMs: number;
  private readonly capabilityPollMs: number;
  private generation = 0;
  private selectionGeneration = 0;
  private sessionTimer: TimerHandle | null = null;
  private outputTimer: TimerHandle | null = null;
  private capabilityTimer: TimerHandle | null = null;
  private outputInFlight = false;
  private disposed = false;
  private visible = false;
  private sessionId: string | null = null;
  private status: BridgeStatus = 'idle';
  private warning: FailureKind | null = null;
  private sessions: PtySession[] = [];
  private selectedId: string | null = null;
  private outputs = new Map<string, OutputState>();
  private outputLoading = false;
  private outputWarning: FailureKind | null = null;

  constructor(options: ControllerOptions) {
    this.api = options.api;
    this.onChange = options.onChange;
    this.timers = options.timers ?? defaultTimers;
    this.sessionsPollMs = options.sessionsPollMs ?? 2_000;
    this.outputPollMs = options.outputPollMs ?? 600;
    this.capabilityPollMs = options.capabilityPollMs ?? 5_000;
  }

  snapshot(): ControllerSnapshot {
    return {
      visible: this.visible,
      sessionId: this.sessionId,
      status: this.status,
      warning: this.warning,
      sessions: [...this.sessions],
      selectedId: this.selectedId,
      selectedOutput: this.selectedId ? this.outputs.get(this.selectedId) ?? null : null,
      outputLoading: this.outputLoading,
      outputWarning: this.outputWarning,
    };
  }

  setSession(sessionId: string | null): void {
    if (this.sessionId === sessionId || this.disposed) return;
    this.invalidate(true);
    this.sessionId = sessionId;
    this.emit();
    this.start();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible || this.disposed) return;
    this.invalidate(false);
    this.visible = visible;
    this.emit();
    this.start();
  }

  select(id: string): void {
    if (this.disposed || id === this.selectedId || !this.sessions.some((session) => session.id === id)) return;
    this.selectionGeneration += 1;
    this.clearOutputTimer();
    this.outputInFlight = false;
    this.selectedId = id;
    this.outputLoading = !this.outputs.has(id);
    this.outputWarning = null;
    this.emit();
    if (this.visible) void this.pollOutput(this.generation, this.selectionGeneration, id);
  }

  refresh(): void {
    if (this.disposed || !this.visible || !this.sessionId) return;
    this.invalidate(false);
    this.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidate(true);
    this.disposed = true;
    this.sessionId = null;
    this.visible = false;
  }

  private emit(): void {
    if (!this.disposed) this.onChange(this.snapshot());
  }

  private invalidate(clear: boolean): void {
    this.generation += 1;
    this.selectionGeneration += 1;
    this.clearTimers();
    this.outputLoading = false;
    if (!clear) return;
    this.status = 'idle';
    this.warning = null;
    this.sessions = [];
    this.selectedId = null;
    this.outputs.clear();
    this.outputWarning = null;
  }

  private start(): void {
    if (this.disposed || !this.visible || !this.sessionId) return;
    const generation = this.generation;
    if (this.status !== 'available') this.status = 'probing';
    this.emit();
    void this.probe(generation);
  }

  private async probe(generation: number): Promise<void> {
    const result: CapabilityResult = await this.api.capability();
    if (!this.current(generation)) return;
    if (result.kind === 'available') {
      this.status = 'available';
      this.warning = null;
      this.emit();
      await this.pollSessions(generation);
      return;
    }
    if (result.kind !== 'absent' && this.status === 'available') {
      this.warning = result.kind;
      this.emit();
      this.capabilityTimer = this.timers.setTimeout(() => void this.probe(generation), this.capabilityPollMs);
      return;
    }
    this.status = result.kind;
    this.warning = null;
    this.emit();
    this.capabilityTimer = this.timers.setTimeout(() => void this.probe(generation), this.capabilityPollMs);
  }

  private async pollSessions(generation: number): Promise<void> {
    const parentSessionId = this.sessionId;
    if (!parentSessionId) return;
    const result: SessionsResult = await this.api.sessions();
    if (!this.current(generation) || this.sessionId !== parentSessionId) return;
    if (result.kind === 'ok') {
      this.warning = null;
      this.sessions = sessionsForParent(result.snapshot.sessions, parentSessionId);
      const liveIds = new Set(this.sessions.map((session) => session.id));
      for (const id of this.outputs.keys()) if (!liveIds.has(id)) this.outputs.delete(id);
      const nextSelected = this.selectedId && liveIds.has(this.selectedId)
        ? this.selectedId
        : this.sessions[0]?.id ?? null;
      if (nextSelected !== this.selectedId) {
        this.selectionGeneration += 1;
        this.clearOutputTimer();
        this.outputInFlight = false;
        this.selectedId = nextSelected;
        this.outputWarning = null;
      }
      this.outputLoading = Boolean(this.selectedId && !this.outputs.has(this.selectedId));
      this.emit();
      if (this.selectedId && this.outputTimer === null && !this.outputInFlight) {
        this.startOutputPoll(generation, this.selectionGeneration, this.selectedId);
      }
    } else {
      this.warning = result.kind;
      this.emit();
    }
    if (this.current(generation)) {
      this.sessionTimer = this.timers.setTimeout(() => void this.pollSessions(generation), this.sessionsPollMs);
    }
  }

  private async pollOutput(generation: number, selectionGeneration: number, id: string): Promise<void> {
    const after = this.outputs.get(id)?.revision;
    const result: OutputResult = await this.api.output(id, after);
    if (!this.current(generation) || selectionGeneration !== this.selectionGeneration || this.selectedId !== id) return;
    this.outputInFlight = false;
    this.outputLoading = false;
    if (result.kind === 'ok') {
      this.outputs.set(id, applyOutput(this.outputs.get(id), result.snapshot));
      this.outputWarning = null;
    } else if (result.kind === 'removed') {
      this.outputs.delete(id);
      this.sessions = this.sessions.filter((session) => session.id !== id);
      this.selectedId = this.sessions[0]?.id ?? null;
      this.selectionGeneration += 1;
      this.outputWarning = null;
      this.emit();
      if (this.selectedId) this.startOutputPoll(generation, this.selectionGeneration, this.selectedId);
      return;
    } else {
      this.outputWarning = result.kind;
    }
    this.emit();
    if (this.current(generation) && selectionGeneration === this.selectionGeneration && this.selectedId === id) {
      this.outputTimer = this.timers.setTimeout(
        () => {
          this.outputTimer = null;
          this.startOutputPoll(generation, selectionGeneration, id);
        },
        this.outputPollMs,
      );
    }
  }

  private startOutputPoll(generation: number, selectionGeneration: number, id: string): void {
    if (this.outputInFlight) return;
    this.outputInFlight = true;
    void this.pollOutput(generation, selectionGeneration, id);
  }

  private current(generation: number): boolean {
    return !this.disposed && this.visible && this.generation === generation;
  }

  private clearOutputTimer(): void {
    if (this.outputTimer !== null) this.timers.clearTimeout(this.outputTimer);
    this.outputTimer = null;
  }

  private clearTimers(): void {
    if (this.sessionTimer !== null) this.timers.clearTimeout(this.sessionTimer);
    if (this.capabilityTimer !== null) this.timers.clearTimeout(this.capabilityTimer);
    this.sessionTimer = null;
    this.capabilityTimer = null;
    this.outputInFlight = false;
    this.clearOutputTimer();
  }
}
