import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountBanner, mountButton, mountEmpty, mountSpinner } from '@openchamber/sdk/ui';
import { BridgeApi } from './api.ts';
import { PtyBridgeController, type ControllerSnapshot } from './controller.ts';
import { connectOpenCodeProtocol } from './protocol.ts';
import { observePanelVisibility } from './visibility.ts';

const STYLE = `
  * { box-sizing: border-box; }
  body { background: var(--oc-bg); color: var(--oc-fg); font-family: var(--oc-font); }
  button { font: inherit; }
  .shell { height: 100%; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
  .masthead { padding: 18px 18px 13px; border-bottom: 1px solid var(--oc-border); display: flex; align-items: end; justify-content: space-between; gap: 12px; }
  .eyebrow { margin: 0 0 3px; color: var(--oc-muted); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0; font-size: 18px; line-height: 1.15; letter-spacing: -.02em; }
  .session-context { max-width: 45%; overflow: hidden; color: var(--oc-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .notice { padding: 10px 14px 0; }
  .workspace { min-height: 0; display: grid; grid-template-columns: minmax(180px, 34%) minmax(0, 1fr); }
  .pty-list { min-height: 0; overflow: auto; padding: 10px; border-right: 1px solid var(--oc-border); background: var(--oc-muted-surface); }
  .pty-button { width: 100%; margin: 0 0 7px; padding: 10px; border: 1px solid transparent; border-radius: var(--oc-radius); background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .pty-button:hover { background: var(--oc-hover); }
  .pty-button[aria-selected="true"] { border-color: var(--oc-border); background: var(--oc-selection); color: var(--oc-selection-fg); }
  .pty-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pty-title { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .pty-description { margin-top: 4px; overflow: hidden; color: var(--oc-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .pty-button[aria-selected="true"] .pty-description { color: inherit; opacity: .72; }
  .terminal { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--oc-bg); }
  .terminal-bar { min-height: 42px; padding: 9px 13px; border-bottom: 1px solid var(--oc-border); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .terminal-title { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .output { min-height: 0; margin: 0; overflow: auto; padding: 14px; color: var(--oc-fg); font: 12px/1.5 var(--oc-mono); tab-size: 4; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .output-empty { color: var(--oc-muted); }
  .state { min-height: 0; overflow: auto; padding: 18px; }
  .state .oc-sdk-spinner { justify-content: center; }
  .state-actions { margin-top: 14px; display: flex; justify-content: center; }
  @media (max-width: 520px) {
    .masthead { padding: 14px; }
    .session-context { display: none; }
    .workspace { grid-template-columns: 1fr; grid-template-rows: minmax(96px, 32%) minmax(0, 1fr); }
    .pty-list { border-right: 0; border-bottom: 1px solid var(--oc-border); }
  }
`;

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing panel root.');
const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);

const host = connectHost();
const protocol = connectOpenCodeProtocol();
const api = new BridgeApi(protocol);
let hostSessionTitle = '';

const toneForStatus = (status: string): 'success' | 'warning' | 'neutral' => {
  if (status === 'running') return 'success';
  if (status === 'killing') return 'warning';
  return 'neutral';
};

const addRefresh = (container: Element, refresh: () => void): void => {
  const actions = document.createElement('div');
  actions.className = 'state-actions';
  container.append(actions);
  mountButton(actions, { label: 'Try again', variant: 'outline', size: 'sm', onClick: refresh });
};

const render = (snapshot: ControllerSnapshot): void => {
  root.replaceChildren();
  const shell = document.createElement('section');
  shell.className = 'shell';
  const masthead = document.createElement('header');
  masthead.className = 'masthead';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Read-only terminal archive';
  const title = document.createElement('h1');
  title.textContent = 'Agent PTYs';
  heading.append(eyebrow, title);
  const context = document.createElement('div');
  context.className = 'session-context';
  context.textContent = hostSessionTitle || 'No OpenCode session';
  masthead.append(heading, context);
  shell.append(masthead);

  const notice = document.createElement('div');
  notice.className = 'notice';
  if (snapshot.warning) {
    mountBanner(notice, {
      tone: snapshot.warning === 'auth' ? 'error' : 'warning',
      title: snapshot.warning === 'auth' ? 'OpenCode access denied' : 'Refresh interrupted',
      body: 'Showing the last successful PTY state while the connection recovers.',
    });
  }
  shell.append(notice);

  if (!snapshot.sessionId) {
    const state = document.createElement('div');
    state.className = 'state';
    mountEmpty(state, { title: 'Open an OpenCode session', body: 'Agent PTYs are scoped to the active session.' });
    shell.append(state);
  } else if (snapshot.status === 'idle' || snapshot.status === 'probing') {
    const state = document.createElement('div');
    state.className = 'state';
    mountSpinner(state, { label: 'Checking for the OpenCode PTY bridge' });
    shell.append(state);
  } else if (snapshot.status === 'absent') {
    const state = document.createElement('div');
    state.className = 'state';
    mountEmpty(state, {
      title: 'PTY bridge not found',
      body: 'Configure @internetisalie/opencode-pty-bridge@0.1.0 in this OpenCode runtime.',
    });
    addRefresh(state, () => controller.refresh());
    shell.append(state);
  } else if (snapshot.status === 'auth' || snapshot.status === 'unavailable') {
    const state = document.createElement('div');
    state.className = 'state';
    mountBanner(state, {
      tone: snapshot.status === 'auth' ? 'error' : 'warning',
      title: snapshot.status === 'auth' ? 'OpenCode authorization failed' : 'PTY bridge unavailable',
      body: snapshot.status === 'auth'
        ? 'Reconnect or update this runtime’s authentication, then try again.'
        : 'The runtime did not return a valid bridge schema v1 response.',
    });
    addRefresh(state, () => controller.refresh());
    shell.append(state);
  } else if (snapshot.sessions.length === 0) {
    const state = document.createElement('div');
    state.className = 'state';
    mountEmpty(state, { title: 'No agent PTYs', body: 'PTYs created by this OpenCode session will appear here.' });
    shell.append(state);
  } else {
    const workspace = document.createElement('div');
    workspace.className = 'workspace';
    const list = document.createElement('nav');
    list.className = 'pty-list';
    list.setAttribute('aria-label', 'PTY sessions');
    for (const session of snapshot.sessions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pty-button';
      button.setAttribute('aria-selected', String(snapshot.selectedId === session.id));
      button.addEventListener('click', () => controller.select(session.id));
      const row = document.createElement('div');
      row.className = 'pty-title-row';
      const sessionTitle = document.createElement('span');
      sessionTitle.className = 'pty-title';
      sessionTitle.textContent = session.title || 'Untitled PTY';
      const badge = document.createElement('span');
      row.append(sessionTitle, badge);
      mountBadge(badge, { label: session.status, tone: toneForStatus(session.status) });
      button.append(row);
      if (session.description) {
        const description = document.createElement('div');
        description.className = 'pty-description';
        description.textContent = session.description;
        button.append(description);
      }
      list.append(button);
    }

    const terminal = document.createElement('section');
    terminal.className = 'terminal';
    const selected = snapshot.sessions.find((session) => session.id === snapshot.selectedId);
    const bar = document.createElement('header');
    bar.className = 'terminal-bar';
    const terminalTitle = document.createElement('span');
    terminalTitle.className = 'terminal-title';
    terminalTitle.textContent = selected?.title || 'PTY output';
    const readOnly = document.createElement('span');
    bar.append(terminalTitle, readOnly);
    mountBadge(readOnly, { label: 'read only', tone: 'info' });
    const output = document.createElement('pre');
    output.className = 'output';
    output.setAttribute('aria-label', 'Selected PTY output');
    if (snapshot.outputLoading && !snapshot.selectedOutput) {
      output.classList.add('output-empty');
      output.textContent = 'Loading output…';
    } else if (!snapshot.selectedOutput?.text) {
      output.classList.add('output-empty');
      output.textContent = snapshot.outputWarning ? 'Output refresh interrupted.' : 'No output yet.';
    } else {
      output.textContent = snapshot.selectedOutput.text;
    }
    terminal.append(bar, output);
    workspace.append(list, terminal);
    shell.append(workspace);
  }
  root.append(shell);
};

const controller = new PtyBridgeController({ api, onChange: render });
const stopVisibility = observePanelVisibility(root, (visible) => controller.setVisible(visible));

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  hostSessionTitle = context.session?.title ?? '';
  controller.setSession(context.session?.id ?? null);
  render(controller.snapshot());
});
host.onSession((session) => {
  hostSessionTitle = session?.title ?? '';
  controller.setSession(session?.id ?? null);
  render(controller.snapshot());
});

const dispose = (): void => {
  stopVisibility();
  controller.dispose();
  protocol.dispose();
  host.dispose();
};
window.addEventListener('pagehide', dispose, { once: true });
