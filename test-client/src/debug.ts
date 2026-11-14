// Debug overlay (D key). The ONLY place hidden state from getDebug is ever shown.
import { ApiError } from '@top/shared/api-client';
import { api, state } from './app';

function isTyping(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

async function render(box: HTMLElement) {
  box.replaceChildren();
  const head = document.createElement('div');
  head.innerHTML = '<b>Debug overlay</b> (press D to close) ';
  const refresh = document.createElement('button');
  refresh.textContent = 'Refresh';
  refresh.onclick = () => void render(box);
  head.append(refresh);
  box.append(head);

  const add = (t: string, cls = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = t;
    box.append(d);
  };
  if (!state.run) return add('No run yet. Start a run first.', 'dim');
  add('Loading...', 'dim');
  try {
    const data = await api.getDebug(state.run.id);
    box.lastChild?.remove();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // One collapsible section per top-level key (misconception states, answer keys, provenance, time budget...).
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        const d = document.createElement('details');
        d.open = true;
        const s = document.createElement('summary');
        s.textContent = k;
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(v, null, 2);
        d.append(s, pre);
        box.append(d);
      }
    } else {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(data, null, 2);
      box.append(pre);
    }
  } catch (err) {
    box.lastChild?.remove();
    if (err instanceof ApiError && err.status === 404) add('Debug is off: the server answered 404 (DEBUG=false).', 'warn');
    else add(`Could not load debug: ${err instanceof Error ? err.message : String(err)}`, 'bad');
  }
}

export function installDebug() {
  const box = document.getElementById('debug');
  if (!box) return;
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'd' || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
    if (box.style.display === 'block') {
      box.style.display = 'none';
    } else {
      box.style.display = 'block';
      void render(box);
    }
  });
}
