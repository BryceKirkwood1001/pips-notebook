import Phaser from 'phaser';
import type { PublicQuestion } from '@top/shared/api-client';

export const GAME_W = 1100;
export const GAME_H = 720;
export const EMOJI_FONT = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

type Kid = Node | string | null | undefined | false;

/** Tiny element builder: el('div', 'box', 'text', childNode). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}

export function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
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
export function questionEl(q: PublicQuestion): HTMLElement {
  const box = el('div', 'box', el('b', '', q.prompt));
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
  box.append(el('div', 'dim', `${q.type}, difficulty ${q.difficulty}/5, budget ${q.timeBudgetSec}s`));
  return box;
}

/** Put an HTML element into the scene as a Phaser DOM element with the shared panel look. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, content: HTMLElement) {
  // Phaser sets `display: block` inline on the node it manages, which would undo a flex layout such
  // as `.cols`. So the managed node is a plain wrapper and the content keeps its own display.
  const wrap = document.createElement('div');
  wrap.classList.add('panel');
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
  wrap.appendChild(content);
  return scene.add.dom(x, y, wrap).setOrigin(0, 0);
}

export function title(scene: Phaser.Scene, text: string) {
  return scene.add.text(20, 12, text, { fontSize: '24px', color: '#ffffff', fontFamily: EMOJI_FONT });
}
