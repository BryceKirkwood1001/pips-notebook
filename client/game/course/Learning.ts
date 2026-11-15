import { atWorld, Page, panel, RoomView, title } from './page.js';
import type { PublicRun, PublicRunRoom, PublicStudentQuestion } from '../../../shared/src/api-client.js';
import { api, call, goTo, sceneForPhase, setRun, state } from './app.js';
import { btn, clock, el, inline, mdToEl } from './ui.js';
import { DANGER_LEVELS, encounterFor, POS, setArrival, teachingPose } from '../art.js';
import { micButton, stopDictation } from './dictation.js';
import { notesByTitle, reportBook, reportCard } from './report.js';
import { travel } from './transition.js';

/** Where Pip's speech bubble sits: above Pip's head at the desk, in world units. */
const BUBBLE_Y = POS.desk.y - 117;
/** Characters a single topic explanation may hold (the backend accepts 8000). */
const EXPLANATION_MAX = 4000;
/** Pip's floating reaction is removed after this long even without animation events. */
const POP_MS = 1300;

type Concept = PublicRunRoom['concepts'][number];

/** Scrolls the open book (not the whole stage) so a new message is in view. */
function reveal(node: HTMLElement) {
  const book = node.closest<HTMLElement>('.room-folio');
  if (book) book.scrollTo({ top: Math.max(0, node.offsetTop - 90), behavior: 'smooth' });
}

/**
 * The lesson is a short book of steps: an overview of the room, one page per topic, then a review. Each topic has
 * its own explanation box, so the player teaches in small chunks and Pip's notes and questions land beside them.
 */
export class LearningScene extends Page {
  private view!: RoomView;
  private lessonEl!: HTMLElement;
  private notebookEl!: HTMLElement;
  private reportEl!: HTMLElement;
  private talk!: HTMLButtonElement;
  private reportBookButton!: HTMLButtonElement;
  private step = 0;
  /** Unsent explanations and answers survive page turns and closing the book. */
  private drafts = new Map<string, string>();
  /** This visit's lesson conversation, per topic. */
  private threads = new Map<string, HTMLElement>();
  private questions: PublicStudentQuestion[] = [];

  constructor() {
    super();
    this.onClose = () => stopDictation();
  }

  create() {
    const run = state.run;
    if (!run) return goTo('Upload');
    const room = run.currentRoom;
    title(this, `Room ${run.roomIndex + 1} of ${run.rooms.length} · ${room?.title ?? 'Lesson'}`);
    this.view = new RoomView();
    this.lessonEl = el('div', 'lesson-steps');
    this.notebookEl = el('div');
    this.questions = run.learning.pendingQuestions;
    const concepts = room?.concepts ?? [];
    const notes = notesByTitle(run.notebookMd);
    // Start on the first topic Pip has no notes on yet, once the overview has been read.
    const firstGap = concepts.findIndex(c => !(notes.get(c.title)?.length));
    this.step = run.learning.teachCount ? (firstGap < 0 ? concepts.length + 1 : firstGap + 1) : 0;

    this.talk = this.view.entry('Talk to Pip', 'A lesson with Pip', this.lessonEl, 'pip-bubble');
    atWorld(this.talk, POS.desk.x, BUBBLE_Y);
    this.talk.addEventListener('click', () => this.renderStep());
    this.reportBookButton = this.view.entry('Report', 'Expedition report', el('div'));
    this.reportBookButton.addEventListener('click', () => this.refreshReportBook());
    this.view.inventory.append(this.view.entry('Notebook', 'Pip’s notebook', this.notebookEl), this.reportBookButton);
    this.view.root.append(this.talk);
    this.reportEl = el('div', 'report-slot');
    this.view.root.append(this.reportEl);
    this.view.actions.append(btn('Ready: go fight →', () => void this.ready(), 'gold'));
    panel(this, this.view.root);
    this.setNotebook(run.notebookMd);
    this.renderStep();
    this.updatePose();
  }

  private get run(): PublicRun { return state.run!; }
  private get concepts(): Concept[] { return this.run.currentRoom?.concepts ?? []; }

  private setNotebook(md: string) {
    if (state.run) state.run.notebookMd = md;
    this.notebookEl.replaceChildren(mdToEl(md));
    this.reportEl.replaceChildren(reportCard(this.run, () => { if (!this.isReportOpen()) this.reportBookButton.click(); }));
  }

  private isReportOpen() { return this.reportBookButton.getAttribute('aria-expanded') === 'true'; }

  private refreshReportBook() {
    const leaf = this.view.root.querySelector('.room-folio .folio-leaf');
    if (leaf && this.isReportOpen()) leaf.replaceChildren(reportBook(this.run));
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  private stepper() {
    const labels = ['Overview', ...this.concepts.map((c, i) => `${i + 1}`), 'Review'];
    const notes = notesByTitle(this.run.notebookMd);
    const nav = el('nav', 'lesson-stepper');
    nav.setAttribute('aria-label', 'Lesson steps');
    labels.forEach((label, i) => {
      const concept = this.concepts[i - 1];
      const taught = !!concept && !!notes.get(concept.title)?.length;
      const asking = !!concept && this.questions.some(q => q.status === 'open' && q.conceptId === concept.id);
      const b = btn(label, () => { this.step = i; this.renderStep(); }, 'step-dot');
      if (concept) b.title = concept.title;
      if (taught) b.classList.add('taught');
      if (asking) b.classList.add('asking');
      if (i === this.step) b.setAttribute('aria-current', 'step');
      nav.append(b);
    });
    return nav;
  }

  private renderStep() {
    stopDictation();
    const last = this.concepts.length + 1;
    this.step = Math.max(0, Math.min(this.step, last));
    const page = this.step === 0 ? this.overview() : this.step === last ? this.review() : this.topic(this.concepts[this.step - 1]!);
    page.classList.add('lesson-page');
    this.lessonEl.replaceChildren(this.stepper(), page);
  }

  private nav(back: boolean, nextLabel: string, next: () => void) {
    return el('div', 'lesson-nav',
      back ? btn('← Back', () => { this.step -= 1; this.renderStep(); }, 'alt') : el('span'),
      btn(nextLabel, next));
  }

  private overview() {
    const room = this.run.currentRoom;
    const page = el('div', '', el('small', 'lesson-kicker', `${this.concepts.length} topic${this.concepts.length === 1 ? '' : 's'} to teach`),
      el('h3', '', room?.title ?? 'This room'));
    if (room?.description) page.append(el('p', 'lesson-description', inline(room.description)));
    if (room?.learningObjectives?.length) page.append(el('h4', '', 'By the end, Pip should be able to'),
      el('ul', 'teaching-goals', ...room.learningObjectives.map(goal => el('li', '', inline(goal)))));
    page.append(el('p', 'lesson-tip', 'Teach one topic at a time in a few sentences. Pip writes notes and asks about anything that confuses it. In battle, Pip can only use those notes.'));
    const loose = this.questions.filter(q => !q.conceptId || !this.concepts.some(c => c.id === q.conceptId));
    if (loose.length) page.append(el('h4', '', 'Pip’s questions'), this.questionList(loose));
    page.append(this.nav(false, this.concepts.length ? `Start with “${this.concepts[0]!.title}” →` : 'Review →', () => { this.step = 1; this.renderStep(); }));
    return page;
  }

  private topic(concept: Concept) {
    const index = this.concepts.indexOf(concept);
    const notes = notesByTitle(this.run.notebookMd).get(concept.title) ?? [];
    const thread = this.threads.get(concept.id) ?? el('div', 'lesson-thread');
    this.threads.set(concept.id, thread);
    const asked = this.questions.filter(q => q.conceptId === concept.id);
    // Taught = Pip has notes on it. Then the box below is optional, and the page says the player can move on.
    const taught = notes.length > 0;
    const asking = asked.some(q => q.status === 'open');
    const last = index === this.concepts.length - 1;
    const nextLabel = last ? 'Review the lesson →' : `Next: ${this.concepts[index + 1]!.title} →`;
    const goNext = () => { this.step += 1; this.renderStep(); };
    const box = el('textarea');
    box.rows = taught ? 2 : 4; box.maxLength = EXPLANATION_MAX;
    box.placeholder = taught
      ? 'Optional: add an example, or correct something in Pip’s notes…'
      : `Explain ${concept.title} in your own words: a definition, why it matters, an example…`;
    box.value = this.drafts.get(concept.id) ?? '';
    box.setAttribute('aria-label', `Teach Pip about ${concept.title}`);
    box.addEventListener('input', () => this.drafts.set(concept.id, box.value));
    const status = el('p', 'lesson-status');
    status.setAttribute('role', 'status');
    const teach = btn(taught ? 'Teach more' : 'Teach this topic', () => void this.teach(concept, box, thread, status, teach), taught ? 'alt' : 'gold');
    const progress = taught && !asking
      ? el('div', 'topic-done', el('p', '', el('b', '', '✓ Topic taught. '),
          `Pip has ${notes.length} note${notes.length === 1 ? '' : 's'} on it. ${last ? 'Review the lesson when you are ready.' : 'Move on to the next topic.'}`),
        btn(nextLabel, goNext))
      : asking
        ? el('p', 'topic-hint', 'Pip asked a question above. Answer it, or move on: if you skip it, Pip keeps that idea.')
        : null;
    const page = el('div', '',
      el('small', 'lesson-kicker', `Topic ${index + 1} of ${this.concepts.length}`),
      el('h3', '', concept.title),
      el('p', 'topic-summary', inline(concept.summary || `Explain ${concept.title.toLowerCase()} using the definitions, reasoning and examples in your material.`)),
      el('details', 'topic-notes', el('summary', '', notes.length ? `Pip’s notes on this topic (${notes.length})` : 'Pip has no notes on this topic yet'),
        notes.length ? el('ul', '', ...notes.map(n => el('li', '', inline(n)))) : el('p', 'dim', 'Teach it below.')),
      thread,
      asked.length ? el('h4', '', 'Pip asks') : null, asked.length ? this.questionList(asked) : null,
      progress,
      el('label', 'teach-label', taught ? 'Teach Pip more (optional)' : `Teach Pip about ${concept.title}`), box,
      el('div', 'teach-row', teach, micButton(box, value => this.drafts.set(concept.id, value), message => { status.textContent = message; })),
      status,
      this.nav(true, nextLabel, goNext));
    return page;
  }

  private review() {
    const notes = notesByTitle(this.run.notebookMd);
    const open = this.questions.filter(q => q.status === 'open');
    const page = el('div', '', el('small', 'lesson-kicker', 'Before the battle'), el('h3', '', 'Is Pip ready?'),
      el('ul', 'review-list', ...this.concepts.map((c, i) => {
        const count = notes.get(c.title)?.length ?? 0;
        const item = el('li', count ? 'ok' : 'bad', el('b', '', count ? '✓' : '✗'), ` ${c.title}: `, count ? `${count} note${count === 1 ? '' : 's'}` : 'not taught yet');
        item.append(btn('Open', () => { this.step = i + 1; this.renderStep(); }, 'link'));
        return item;
      })));
    if (open.length) page.append(el('p', 'warn', `Pip still has ${open.length} open question${open.length === 1 ? '' : 's'}. Going now skips ${open.length === 1 ? 'it' : 'them'}, and Pip keeps that idea.`),
      this.questionList(open));
    page.append(el('p', 'dim', 'In battle Pip answers alone, using only the notebook.'),
      el('div', 'lesson-nav', btn('← Back', () => { this.step -= 1; this.renderStep(); }, 'alt'), btn('Ready: go fight →', () => void this.ready())));
    return page;
  }

  // ── Teaching and Pip's questions ─────────────────────────────────────────

  private async teach(concept: Concept, box: HTMLTextAreaElement, thread: HTMLElement, status: HTMLElement, button: HTMLButtonElement) {
    const text = box.value.trim();
    if (!text) { status.textContent = 'Write (or dictate) an explanation first.'; return; }
    stopDictation();
    const before = notesByTitle(this.run.notebookMd).get(concept.title) ?? [];
    const pending = el('div', 'bubble pip typing', el('i'), el('i'), el('i'));
    thread.append(el('div', 'bubble you', text), pending);
    reveal(pending);
    button.disabled = true; status.textContent = 'Pip is reading your explanation…';
    teachingPose(false);
    const res = await call(() => api.teach(this.run.id, text, concept.id));
    button.disabled = false;
    if (!this.active) return;
    if (!res) { pending.remove(); thread.lastElementChild?.remove(); status.textContent = 'That lesson did not reach Pip. Your text is still here.'; return; }
    this.drafts.delete(concept.id); box.value = '';
    this.run.learning.teachCount += 1;
    this.questions = res.questions;
    this.run.learning.pendingQuestions = res.questions;
    this.setNotebook(res.notebookMd);
    const after = notesByTitle(res.notebookMd).get(concept.title) ?? [];
    const fresh = after.filter(n => !before.includes(n));
    const asking = res.questions.filter(q => q.status === 'open' && q.conceptId === concept.id);
    pending.className = 'bubble pip';
    const reply = res.feedback?.trim() || (fresh.length ? 'I wrote down what you taught me:'
      : after.length ? 'That idea may already be in my notes. Can you add a detail or show me an example?'
      : `I still need a statement about ${concept.title.toLowerCase()} to write down. What does one part of it mean?`);
    pending.replaceChildren(el('span', '', inline(reply)));
    if (fresh.length) pending.append(el('ul', '', ...fresh.map(n => el('li', '', inline(n)))));
    if (asking.length) pending.append(el('span', 'bubble-ask', `I have ${asking.length === 1 ? 'a question' : `${asking.length} questions`} below.`));
    status.textContent = '';
    this.renderStep(); // the thread node is kept per topic, so the conversation stays on the page
    reveal(pending);
    this.updatePose(fresh.length > 0);
  }

  private questionList(list: PublicStudentQuestion[]) {
    return el('div', 'pip-questions', ...list.map(q => this.questionCard(q)));
  }

  private questionCard(q: PublicStudentQuestion) {
    const card = el('div', `box pip-question ${q.status}`, el('p', 'pip-question-text', inline(q.text)));
    if (q.status !== 'open') {
      card.append(el('small', q.status === 'answered' ? 'ok' : 'bad', q.status === 'answered' ? 'Answered' : 'Skipped: Pip keeps this idea'));
      return card;
    }
    const key = 'q:' + q.id;
    const box = el('textarea');
    box.rows = 2; box.maxLength = 4000; box.placeholder = 'Answer Pip…';
    box.value = this.drafts.get(key) ?? '';
    box.setAttribute('aria-label', `Answer Pip: ${q.text}`);
    box.addEventListener('input', () => this.drafts.set(key, box.value));
    const status = el('p', 'lesson-status');
    const answer = btn('Answer', async () => {
      if (!box.value.trim()) { status.textContent = 'Write (or dictate) an answer first.'; return; }
      stopDictation();
      const res = await call(() => api.answerQuestion(this.run.id, q.id, box.value));
      if (!res || !this.active) return;
      this.drafts.delete(key);
      q.status = 'answered';
      this.setNotebook(res.notebookMd);
      this.flash(res.resolved ? 'That makes sense now!' : 'I’m still confused about that…', res.resolved);
      this.renderStep();
      this.updatePose(res.resolved);
    });
    const skip = btn('Skip', async () => {
      const res = await call(() => api.skipQuestion(this.run.id, q.id));
      if (!res || !this.active) return;
      q.status = 'skipped';
      this.setNotebook(res.notebookMd);
      this.renderStep();
      this.updatePose();
    }, 'alt');
    card.append(box, el('div', 'teach-row', answer, micButton(box, value => this.drafts.set(key, value), message => { status.textContent = message; }), skip), status);
    return card;
  }

  /** Pip's reaction floats over its head for a moment. */
  private flash(text: string, good: boolean) {
    const pop = atWorld(el('div', `float-pop ${good ? 'good' : 'bad'}`, text), POS.desk.x, BUBBLE_Y - 40);
    this.view.root.append(pop);
    pop.addEventListener('animationend', () => pop.remove());
    clock.setTimeout(() => pop.remove(), POP_MS);
  }

  private updatePose(understood = false) {
    const asking = this.questions.some(q => q.status === 'open');
    this.talk.textContent = asking ? 'Pip has a question!' : 'Talk to Pip';
    this.talk.classList.toggle('asking', asking);
    teachingPose(asking, understood);
  }

  private async ready() {
    const run = this.run;
    stopDictation();
    const foe = encounterFor(run.roomIndex, run.rooms.length, false);
    await travel({ kicker: `Room ${run.roomIndex + 1} of ${run.rooms.length} · Battle · Danger ${(foe.danger ?? 0) + 1} of ${DANGER_LEVELS}`,
      title: run.currentRoom?.title ?? 'Into battle',
      detail: `A ${foe.name} guards this room. Pip faces ${run.rules.roomQuestions} questions alone, with ${run.rules.roomHearts} hearts and only the notebook.` }, async () => {
      const next = await call(() => api.ready(run.id));
      if (!next) return false;
      setRun(next);
      setArrival('fight');
      goTo(sceneForPhase(next.phase));
      return true;
    });
  }
}
