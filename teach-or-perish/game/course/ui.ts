import type { PublicQuestion } from './api-client.js';
export const host = document;
export const clock: Window = window;
type Kid = Node | string | null | undefined | false;

/** Tiny element builder: el('div', 'box', 'text', childNode). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = host.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}

export function btn(label: string, onClick: () => void, cls = 'gold'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Render the notebook markdown: headings and "- " bullets only. Uses text nodes, so no HTML injection. */
export function mdToEl(md: string): HTMLElement {
  const root = el('div');
  let list: HTMLUListElement | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('- ')) {
      if (!list) list = root.appendChild(el('ul'));
      list.append(el('li', '', line.slice(2)));
      continue;
    }
    list = null;
    const h = /^(#+)\s*(.*)$/.exec(line);
    if (h) root.append(el(h[1].length === 1 ? 'h3' : 'h4', '', h[2]));
    else root.append(el('p', '', line));
  }
  return root;
}

/** A question with its options, for context in logs and modals. */
export function questionEl(q: PublicQuestion, showPrompt = true): HTMLElement {
  const box = el('div', showPrompt ? 'box' : 'turn-question', showPrompt ? el('b', '', q.prompt) : null);
  const opts = (items: string[]) => box.append(el('ol', '', ...items.map((o) => el('li', '', o))));
  switch (q.type) {
    case 'mcq':
    case 'multi_select':
      opts(q.payload.options);
      break;
    case 'ordering':
      opts(q.payload.items);
      break;
    case 'true_false':
      box.append(el('div', 'dim', `Statement: ${q.payload.statement}`));
      break;
    case 'numeric':
      if (q.payload.unit) box.append(el('div', 'dim', `Unit: ${q.payload.unit}`));
      break;
    default:
      break;
  }
  const names = { mcq: 'Multiple choice', true_false: 'True or false', multi_select: 'Select all that apply', numeric: 'Calculation', short_text: 'Written answer', ordering: 'Put in order', free_response: 'Explanation' };
  box.append(el('div', 'question-meta dim', `${names[q.type]} · Difficulty ${q.difficulty}/5 · Estimated time ${q.timeBudgetSec}s`));
  return box;
}



