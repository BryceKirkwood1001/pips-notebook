import { Page, panel, title } from './page.js';
import type { PublicStudentQuestion } from './api-client.js';
import { api, call, goTo, sceneForPhase, setRun, state } from './app.js';
import { btn, el, mdToEl } from './ui.js';
import { teachingPose } from '../art.js';

interface QBlock {
  status: HTMLElement;
  controls: HTMLElement;
}

export class LearningScene extends Page {
  private notebookEl!: HTMLElement;
  private questionsEl!: HTMLElement;
  private teachInfo!: HTMLElement;
  private blocks = new Map<string, QBlock>();

  constructor() {
    super();
  }

  create() {
    const run = state.run;
    if (!run) return goTo('Upload');
    const room = run.currentRoom;
    title(this, `${run.studentEmoji}  Learning: ${room?.title ?? ''}  (room ${run.roomIndex + 1}/${run.rooms.length}, target ${run.targetGrade})`);

    this.blocks = new Map();
    this.notebookEl = el('div');
    this.questionsEl = el('div');
    this.teachInfo = el('div', 'dim');

    const explain = el('textarea');
    explain.rows = 3;
    explain.maxLength = 8000;
    explain.placeholder = 'Explain this room to your student...';
    const teach = btn('Teach', async () => {
      if (!explain.value.trim()) return;
      const res = await call(() => api.teach(run.id, explain.value));
      if (!res || !this.active) return;
      this.setNotebook(res.notebookMd);
      run.learning.pendingQuestions = res.questions;
      this.syncQuestions(res.questions);
      run.learning.teachCount += 1;
      this.teachInfo.textContent = `Taught ${run.learning.teachCount} time(s). Teach again to fix things, or press Ready.`;
    });
    const ready = btn('Ready: go fight', async () => {
      const next = await call(() => api.ready(run.id));
      if (!next) return;
      setRun(next);
      goTo(sceneForPhase(next.phase));
    }, 'alt');

    const concepts = el('ul', '', ...(room?.concepts ?? []).map((c) => el('li', '', c.title)));
    const left = el(
      'div', '',
      el('h3', '', 'Concepts in this room'), concepts,
      el('h3', '', 'Your explanation'), explain,
      el('div', '', teach, ready), this.teachInfo,
      el('h3', '', `The student's questions (max ${run.rules.maxStudentQuestions} open)`), this.questionsEl,
    );
    const right = el('div', '', el('h3', '', 'Student notebook'), el('div', 'box', this.notebookEl));
    panel(this, el('div', 'cols', left, right));

    this.setNotebook(run.notebookMd);
    this.syncQuestions(run.learning.pendingQuestions);
    if (run.learning.teachCount) this.teachInfo.textContent = `Taught ${run.learning.teachCount} time(s).`;
  }

  private setNotebook(md: string) {
    if (state.run) state.run.notebookMd = md;
    this.notebookEl.replaceChildren(mdToEl(md));
  }

  /** Create a block per question once; afterwards only update its status. */
  private syncQuestions(list: PublicStudentQuestion[]) {
    for (const q of list) {
      const known = this.blocks.get(q.id);
      if (known) {
        if (known.status.dataset.st !== q.status) this.setStatus(q.id, q.status);
        continue;
      }
      const status = el('div');
      const controls = el('div');
      const input = el('textarea');
      input.rows = 2;
    input.maxLength = 4000;
      input.placeholder = 'Your answer...';
      controls.append(
        input,
        btn('Answer', async () => {
          if (!state.run || !input.value.trim()) return;
          const res = await call(() => api.answerQuestion(state.run!.id, q.id, input.value));
          if (!res || !this.active) return;
          this.setNotebook(res.notebookMd);
          q.status = 'answered'; this.setStatus(q.id, 'answered', res.resolved);
          this.updatePose(res.resolved);
        }),
        btn('Skip', async () => {
          if (!state.run) return;
          const res = await call(() => api.skipQuestion(state.run!.id, q.id));
          if (!res || !this.active) return;
          this.setNotebook(res.notebookMd);
          q.status = 'skipped'; this.setStatus(q.id, 'skipped');
          this.updatePose();
        }, 'alt'),
      );
      this.questionsEl.append(el('div', 'box', el('div', '', `❓ ${q.text}`), status, controls));
      this.blocks.set(q.id, { status, controls });
      this.setStatus(q.id, q.status);
    }
    this.updatePose();
  }

  private updatePose(understood = false) {
    const hasQuestion = Array.from(this.blocks.values()).some(b => b.status.dataset.st === 'open');
    teachingPose(hasQuestion, understood);
  }

  private setStatus(id: string, st: 'open' | 'answered' | 'skipped', resolved?: boolean) {
    const b = this.blocks.get(id);
    if (!b) return;
    b.status.dataset.st = st;
    b.controls.style.display = st === 'open' ? 'block' : 'none';
    if (st === 'open') b.status.replaceChildren(el('span', 'warn', 'open'));
    else if (st === 'skipped') b.status.replaceChildren(el('span', 'bad', 'skipped (risky: the student keeps its belief)'));
    else if (resolved === undefined) b.status.replaceChildren(el('span', 'dim', 'answered'));
    else b.status.replaceChildren(el('span', resolved ? 'ok' : 'bad', resolved ? 'answered: resolved, the student understands' : 'answered: NOT resolved, the student is still confused'));
  }
}


