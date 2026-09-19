import {
  GUEST_REQUEST_TIMEOUT_MS,
  HostRequestError,
  OPENCHAMBER_SDK_API_VERSION,
  OPENCHAMBER_SDK_CHANNEL,
  isGuestRequestPath,
  resolveHostRequestErrorCode,
  type GuestRequestMethod,
  type GuestRequestResult,
} from '@openchamber/sdk';

export type OpenCodeRequest = {
  pluginId: string;
  method: GuestRequestMethod;
  path: string;
  query?: Record<string, string>;
  body?: string;
};

type ParentTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void;
};

export type ProtocolTarget = {
  parent: ParentTarget;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
};

type Pending = {
  resolve: (result: GuestRequestResult) => void;
  reject: (error: HostRequestError) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type OpenCodeProtocol = {
  openCodeRequest: (request: OpenCodeRequest) => Promise<GuestRequestResult>;
  dispose: () => void;
};

type ProtocolOptions = {
  target?: ProtocolTarget;
  requestTimeoutMs?: number;
  idPrefix?: string;
  acceptSource?: (source: MessageEvent['source']) => boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isResult = (value: unknown): value is GuestRequestResult => (
  isRecord(value)
  && Number.isInteger(value.status)
  && typeof value.body === 'string'
);

export const connectOpenCodeProtocol = (options: ProtocolOptions = {}): OpenCodeProtocol => {
  const target = options.target ?? (
    typeof window === 'undefined' ? undefined : window as unknown as ProtocolTarget
  );
  if (!target) {
    throw new HostRequestError('HOST_UNAVAILABLE', 'No window. The OpenCode protocol runs in a browser frame.');
  }

  const timeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
  const prefix = options.idPrefix ?? `oc-pty-${crypto.randomUUID()}`;
  const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
  const pending = new Map<string, Pending>();
  let sequence = 0;
  let disposed = false;

  const onMessage = (event: MessageEvent): void => {
    if (!acceptSource(event.source) || !isRecord(event.data)) return;
    const message = event.data;
    if (
      message.channel !== OPENCHAMBER_SDK_CHANNEL
      || message.v !== OPENCHAMBER_SDK_API_VERSION
      || message.type !== 'result'
      || typeof message.id !== 'string'
    ) return;

    const waiter = pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(message.id);

    if (message.ok === true) {
      if (isResult(message.payload)) waiter.resolve(message.payload);
      else waiter.reject(new HostRequestError('HOST_REJECTED', 'Host OpenCode request result was empty.'));
      return;
    }
    if (message.ok === false && typeof message.error === 'string' && message.error.length > 0) {
      waiter.reject(new HostRequestError(
        resolveHostRequestErrorCode(typeof message.code === 'string' ? message.code : undefined),
        message.error,
      ));
    }
  };

  target.addEventListener('message', onMessage);

  return {
    openCodeRequest: (request) => {
      if (!isGuestRequestPath(request.path)) {
        return Promise.reject(new HostRequestError(
          'BAD_PATH',
          'Request path must start with "/" and stay on the declared origin.',
        ));
      }
      if (disposed || target.parent === target as unknown as ParentTarget) {
        return Promise.reject(new HostRequestError('HOST_UNAVAILABLE', 'No host frame.'));
      }
      sequence += 1;
      const id = `${prefix}-${sequence}`;
      return new Promise<GuestRequestResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new HostRequestError('HOST_TIMEOUT', 'Host did not answer in time.'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        target.parent.postMessage({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: 'opencode-request',
          id,
          payload: request,
        }, '*');
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('message', onMessage);
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new HostRequestError('HOST_UNAVAILABLE', 'Host connection was disposed.'));
      }
      pending.clear();
    },
  };
};
