// The "Help me!" modal: question, difficulty, time budget, an input that fits the type, and a countdown.
import type { Answer, HelpMeTurn } from './api-client.js';
import { btn, el, questionEl, clock } from './ui.js';

const LEVELS = ['', 'Easy', 'Fair', 'Tricky', 'Tough', 'Brutal'];

/** Returns the modal content and a stop() that clears the countdown. `submit` gets the answer. */
export function buildHelp(ev: HelpMeTurn, submit: (a: Answer) => void): { el: HTMLElement; stop: () => void } {
  const q = ev.question;
  let sent = false;
  let tick = 0;
  const stop = () => clock.clearInterval(tick);

  // Each branch sets `build` (read the answer; `final` fills gaps when time runs out) and adds its input.
  let build: (final: boolean) => Answer = () => ({});
  const input = el('div', 'box');

  switch (q.type) {
    case 'mcq': {
      let pick = -1;
      const bs = q.payload.options.map((o, i) =>
        btn(`${String.fromCharCode(65 + i)}. ${o}`, () => {
          pick = i;
          bs.forEach((b, j) => (b.className = j === i ? 'sel' : 'alt'));
        }, 'alt'),
      );
      input.append(...bs.flatMap((b) => [b, el('br')]));
      build = () => ({ choiceIndex: Math.max(pick, 0) });
      break;
    }
    case 'true_false': {
      let pick: boolean | null = null;
      const t = btn('True', () => set(true), 'alt');
      const f = btn('False', () => set(false), 'alt');
      const set = (v: boolean) => {
        pick = v;
        t.className = v ? 'sel' : 'alt';
        f.className = v ? 'alt' : 'sel';
      };
      input.append(el('div', 'dim', q.payload.statement), t, f);
      build = () => ({ value: pick ?? false });
      break;
    }
    case 'multi_select': {
      const boxes = q.payload.options.map((o) => {
        const cb = el('input');
        cb.type = 'checkbox';
        input.append(el('div', '', el('label', '', cb, ` ${o}`)));
        return cb;
      });
      build = () => ({ choiceIndexes: boxes.flatMap((cb, i) => (cb.checked ? [i] : [])) });
      break;
    }
    case 'numeric': {
      const n = el('input');
      n.type = 'number';
      n.step = 'any';
      n.placeholder = 'Number';
      input.append(n, el('span', 'dim', q.payload.unit ? ` ${q.payload.unit}` : ''));
      build = () => ({ value: n.value === '' ? 0 : Number(n.value) });
      break;
    }
    case 'ordering': {
      let order: number[] = [];
      const list = el('div');
      const draw = () => {
        list.replaceChildren(
          ...q.payload.items.map((item, i) => {
            const pos = order.indexOf(i);
            return btn(pos >= 0 ? `${pos + 1}. ${item}` : item, () => {
              if (!order.includes(i)) order = [...order, i];
              draw();
            }, pos >= 0 ? 'sel' : 'alt');
          }),
        );
      };
      draw();
      input.append(el('div', 'dim', 'Click the items in the right order.'), list, btn('Reset', () => { order = []; draw(); }));
      build = (final) => {
        if (!final) return { order };
        const rest = q.payload.items.map((_, i) => i).filter((i) => !order.includes(i));
        return { order: [...order, ...rest] };
      };
      break;
    }
    default: {
      // short_text (and free_response, which never gets a help event but is handled anyway)
      const t = el('input');
      t.type = 'text';
      t.placeholder = 'Your answer';
      input.append(t);
      build = () => ({ text: t.value });
    }
  }

  const hint = el("p", "warn");
  const go = (final: boolean) => {
    if (sent) return;
    const answer = build(final);
    if (!final && ((q.type === 'mcq' && !input.querySelector('.sel')) ||
        (q.type === 'true_false' && !input.querySelector('.sel')) ||
        (q.type === 'multi_select' && !answer.choiceIndexes?.length) ||
        (q.type === 'ordering' && answer.order?.length !== q.payload.items.length) ||
        (q.type === 'numeric' && !input.querySelector('input')?.value) ||
        (q.type === 'short_text' && !answer.text?.trim()))) {
      hint.textContent = 'Complete your answer first.';
      return;
    }
    sent = true;
    stop();
    submit(answer);
  };
  const submitBtn = btn('Submit', () => go(false));

  const timer = el('div', 'warn');
  if (ev.deadline) {
    const end = Date.parse(ev.deadline);
    const update = () => {
      const left = Math.ceil((end - new Date().getTime()) / 1000);
      timer.textContent = left > 0 ? `Time left: ${left}s` : 'Time is up';
      if (left <= 0) go(true); // submit whatever is there
    };
    tick = clock.setInterval(update, 250);
    queueMicrotask(update);
  } else {
    timer.textContent = 'Untimed: take your time.';
    timer.className = 'dim';
  }

  const root = el(
    'div', '',
    el('h2', '', 'Pip needs your help!'),
    el('div', 'warn', `${LEVELS[q.difficulty] ?? 'Hard'} one: ${ev.timeBudgetSec}s`),
    questionEl(q),
    input,
    hint, el('div', '', submitBtn),
    timer,
  );
  return { el: root, stop };
}

