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

// ── Markdown ──
// A small, safe Markdown renderer for questions, answers, explanations, notes and chat. It builds DOM nodes from text
// (never innerHTML), so course or model text cannot inject markup. Supported: ``` fenced code ``` (anywhere in the
// text, with an optional language), `inline code`, **bold**, *italic*, "- " / "1. " lists, blank-line paragraphs and
// single line breaks. Underscore emphasis is deliberately not supported: it would mangle snake_case identifiers.
/** `code`, **bold** and *italic* within one run of text. */
function inlineNodes(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const pattern = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|\*(?=[^\s*])([^*\n]*?[^\s*])\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(el('code', '', m[2]!.replace(/^ (.*) $/s, '$1')));
    else if (m[3] !== undefined) out.push(el('strong', '', ...inlineNodes(m[3])));
    else out.push(el('em', '', ...inlineNodes(m[4]!)));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline Markdown for one-line places (buttons, list items, summaries). Fenced code becomes inline code. */
export function inline(text: string): DocumentFragment {
  const flat = text.replace(/```[\w+#.-]*[ \t]*\n?([\s\S]*?)\n?```/g, (_, code: string) => '`' + code.replace(/\s*\n\s*/g, ' ').trim() + '`');
  const frag = host.createDocumentFragment();
  frag.append(...inlineNodes(flat));
  return frag;
}

/** Paragraphs, lists and line breaks for prose between code fences. */
function prose(text: string, into: HTMLElement) {
  let paragraph: string[] = [];
  let list: HTMLOListElement | HTMLUListElement | null = null;
  const flush = () => {
    if (!paragraph.length) return;
    const p = el('p');
    paragraph.forEach((line, i) => { if (i) p.append(el('br')); p.append(...inlineNodes(line)); });
    into.append(p);
    paragraph = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !!item[2];
      if (!list || (list.tagName === 'OL') !== ordered) { list = ordered ? el('ol') : el('ul'); into.append(list); }
      list.append(el('li', '', ...inlineNodes(item[3]!)));
      continue;
    }
    list = null;
    if (!line.trim()) { flush(); continue; }
    paragraph.push(line.trim());
  }
  flush();
}

/** Block Markdown for questions, explanations and notes. Returns a `.md` container. */
export function markdown(text: string, cls = ''): HTMLElement {
  const root = el('div', cls ? `md ${cls}` : 'md');
  const fence = /```([\w+#.-]*)[ \t]*\n?([\s\S]*?)\n?```/g;
  const src = text.replace(/\r\n?/g, '\n');
  let last = 0;
  for (const m of src.matchAll(fence)) {
    prose(src.slice(last, m.index), root);
    const code = el('code', m[1] ? `language-${m[1]}` : '', m[2]!.replace(/^\n+|\n+$/g, ''));
    root.append(el('pre', '', code));
    last = m.index! + m[0].length;
  }
  prose(src.slice(last), root);
  return root;
}

/** Render the notebook markdown: headings and "- " bullets (each with inline Markdown). Text nodes only. */
export function mdToEl(md: string): HTMLElement {
  const root = el('div');
  let list: HTMLUListElement | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('- ')) {
      if (!list) list = root.appendChild(el('ul'));
      list.append(el('li', '', inline(line.slice(2))));
      continue;
    }
    list = null;
    const h = /^(#+)\s*(.*)$/.exec(line);
    if (h) root.append(el(h[1].length === 1 ? 'h3' : 'h4', '', h[2]));
    else root.append(el('p', '', inline(line)));
  }
  return root;
}

/** A question with its options, for context in logs and modals. */
export function questionEl(q: PublicQuestion, showPrompt = true): HTMLElement {
  const box = el('div', showPrompt ? 'box' : 'turn-question', showPrompt ? markdown(q.prompt, 'question-prompt') : null);
  const opts = (items: string[]) => box.append(el('ol', 'question-options', ...items.map((o) => el('li', '', inline(o)))));
  switch (q.type) {
    case 'mcq':
    case 'multi_select':
      opts(q.payload.options);
      break;
    case 'ordering':
      opts(q.payload.items);
      break;
    case 'true_false':
      box.append(el('div', 'dim', 'Statement: ', inline(q.payload.statement)));
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



