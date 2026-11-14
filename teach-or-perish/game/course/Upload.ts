import { Page, panel, title } from './page.js';
import { STUDENT_EMOJIS, TARGET_GRADES, type PublicCourse, type StudentEmoji, type TargetGrade } from './api-client.js';
import { api, call, describeError, goTo, setRun, showError, state } from './app.js';
import { btn, el, clock } from './ui.js';

const STAGES = ['parsing', 'outline', 'style', 'concepts', 'ready'];

export class UploadScene extends Page {
  private courseId: string | null = null;
  private course: PublicCourse | null = null;
  private chosen = new Set<string>();
  private known = new Set<string>();
  private grade: TargetGrade = 'B';
  private emoji: StudentEmoji = STUDENT_EMOJIS[0];
  private timer = 0;
  private polling = false;
  private retryUpload: (() => Promise<void>) | null = null;
  private sourceEl!: HTMLElement;
  private courseEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private roomsEl!: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private hintEl!: HTMLElement;

  constructor() {
    super();
  }

  create() {
    this.courseId = null;
    this.course = null;
    this.chosen.clear();
    this.known.clear();
    this.sourceEl = el('div');
    this.courseEl = el('div');
    this.progressEl = el('div');
    this.roomsEl = el('div');
    this.startBtn = btn('Start run', () => void this.start());
    this.startBtn.disabled = true;
    this.hintEl = el('div', 'dim');
    this.polling = false;
    this.retryUpload = null;
    title(this, 'Lesson preparation');
    const root = el('div', '', this.sourceEl, this.courseEl);
    panel(this, root);
    this.courseEl.style.display = 'none';
    this.buildSource();
    this.buildCourse();
    this.onClose = () => clock.clearInterval(this.timer);
  }

  // ── Step 1: where does the course come from ───────────────────────────────

  private buildSource() {
    const samples = el('div', 'box', el('div', 'dim', 'Loading samples...'));
    void call(() => api.listSamples()).then((res) => {
      samples.replaceChildren();
      if (!res) return samples.append(btn('Reload samples', () => goTo('Upload')));
      for (const s of res.samples) {
        samples.append(btn(s.title, async () => { this.retryUpload = null; this.begin(await call(() => api.seedCourse(s.id))); }));
      }
      if (!res.samples.length) samples.append(el('div', 'dim', 'No samples available.'));
    });

    const files = el('input');
    files.type = 'file';
    files.multiple = true;
    files.accept = '.pdf,.txt,.md,.markdown';
    files.setAttribute('aria-label','Course files');
    const fileTitle = el('input');
    fileTitle.type = 'text';
    fileTitle.placeholder = 'Course title (optional)';
    const upload = btn('Upload files', async () => {
      const list = Array.from(files.files ?? []);
      if (!list.length) return showError('Choose at least one .pdf, .txt or .md file.');
      const title = fileTitle.value || undefined;
      this.retryUpload = async () => this.begin(await call(() => api.uploadCourse(list.map((f) => ({ name: f.name, data: f })), title)));
      await this.retryUpload();
    });

    const text = el('textarea');
    text.rows = 6;
    text.placeholder = 'Paste course notes here';
    const textTitle = el('input');
    textTitle.type = 'text';
    textTitle.maxLength = fileTitle.maxLength = 200;
    textTitle.placeholder = 'Course title (optional)';
    const create = btn('Create from text', async () => {
      if (!text.value.trim()) return showError('Paste some text first.');
      const notes = text.value, title = textTitle.value || undefined;
      this.retryUpload = async () => this.begin(await call(() => api.createCourseFromText(notes, title)));
      await this.retryUpload();
    });

    this.sourceEl.append(
      el('h2', '', 'Pick a course'),
      el('h3', '', '1. Sample course (instant)'),
      samples,
      el('h3', '', '2. Upload files'),
      el('div', 'box', files, fileTitle, upload),
      el('h3', '', '3. Paste text'),
      el('div', 'box', text, textTitle, create),
    );
  }

  private begin(res: { courseId: string } | undefined) {
    if (!this.active || !res) return;
    clock.clearInterval(this.timer);
    this.course = null; this.chosen.clear(); this.known.clear();
    this.roomsEl.replaceChildren(); this.startBtn.disabled = true;
    this.hintEl.textContent = 'Preparing your course…';
    this.courseId = res.courseId;
    this.sourceEl.style.display = 'none';
    this.courseEl.style.display = 'block';
    this.timer = clock.setInterval(() => void this.poll(), 1000);
    void this.poll();
  }

  // ── Step 2: ingest progress plus the setup form ───────────────────────────

  private buildCourse() {
    const grade = el('select');
    for (const g of TARGET_GRADES) grade.append(new Option(g, g, false, g === this.grade));
    grade.onchange = () => (this.grade = grade.value as TargetGrade);

    const emojis = el('div');
    const drawEmojis = () => {
      emojis.replaceChildren(
        ...STUDENT_EMOJIS.map((e) =>
          btn(e, () => {
            this.emoji = e;
            drawEmojis();
          }, e === this.emoji ? 'sel' : 'alt'),
        ),
      );
    };
    drawEmojis();

    const setup = el(
      'div', '',
      el('h3', '', 'Scope (rooms to play)'), this.roomsEl,
      el('h3', '', 'Target grade'), grade,
      el('h3', '', 'Your student'), emojis,
      el('div', '', this.startBtn), this.hintEl,
    );
    this.courseEl.append(btn('Change course', () => goTo('Upload'), 'alt'),
      el('h2', '', 'Ingest and setup'),
      el('div', 'cols', el('div', 'box', this.progressEl), el('div', 'box', setup)),
    );
  }

  private async poll() {
    if (this.polling || !this.courseId) return;
    this.polling = true;
    try {
      this.course = await api.getCourse(this.courseId);
      if (!this.active) return;
      for (const r of this.course.rooms) {
        if (!this.known.has(r.id)) {
          this.known.add(r.id);
          this.chosen.add(r.id); // default scope: every room
        }
      }
      this.renderProgress();
      this.renderRooms();
      const stage = this.course.status.stage;
      if (stage === 'ready' || stage === 'error') clock.clearInterval(this.timer);
    } catch (err) {
      showError(describeError(err));
    } finally {
      this.polling = false;
    }
  }

  private renderProgress() {
    const c = this.course;
    if (!c) return;
    const mark = (ok: boolean) => (ok ? '✅' : '⏳');
    const stage = c.status.stage;
    const stageLine = el('div', '', 'Stage: ');
    for (const s of STAGES) stageLine.append(el('span', s === stage ? 'warn' : 'dim', (s === stage ? `[${s}]` : s) + ' > '));
    this.progressEl.replaceChildren(el('h3', '', c.title), stageLine);
    const fallback: Record<string, string> = {
      parsing: 'Reading and indexing your document…', outline: 'Finding the main ideas in your document…',
      style: 'Matching the style of your material…', concepts: 'Preparing lessons and checking questions…',
      ready: 'Your course is ready.', error: 'Preparation stopped. You can retry the upload.',
    };
    const thinking = el('div', 'ingest-thinking', el('small', 'thinking-label', stage === 'ready' ? 'Ready' : stage === 'error' ? 'Preparation stopped' : 'Thinking'),
      el('p', 'thinking-activity', c.status.activity?.message ?? fallback[stage] ?? 'Preparing your course…'));
    thinking.setAttribute('role', 'status'); thinking.setAttribute('aria-live', 'polite');
    if (c.status.activity?.summary) thinking.append(el('small', 'thinking-source', 'Latest OpenAI reasoning summary'), el('p', 'thinking-summary', c.status.activity.summary));
    this.progressEl.append(thinking);
    if (stage === 'error') {
      this.progressEl.append(el('div', 'bad', `Course preparation failed: ${c.status.error ?? 'unknown'}`));
      if (/timed out|timeout/i.test(c.status.error ?? '')) this.progressEl.append(el('p', 'dim', 'Try again, or increase the course preparation timeout in Settings.'));
      if (this.retryUpload) this.progressEl.append(btn('Retry preparation', () => void this.retryUpload?.()));
    }
    this.progressEl.append(el('h4', '', 'Concepts'));
    for (const u of c.units) {
      this.progressEl.append(el('div', 'dim', u.title));
      for (const k of u.concepts) this.progressEl.append(el('div', '', `${mark(k.ready)} ${k.title}`));
    }
    for (const file of c.files) this.progressEl.append(el('p', 'dim', file.name + ' · ' + file.type + ' · ' + file.pages + ' pages'));
    this.progressEl.append(el('h4', '', 'Rooms'));
    for (const r of c.rooms) this.progressEl.append(el('div', '', `${mark(r.ready)} ${r.title}`));
  }

  private renderRooms() {
    const c = this.course;
    if (!c) return;
    this.roomsEl.replaceChildren();
    for (const r of c.rooms) {
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = this.chosen.has(r.id);
      cb.onchange = () => {
        if (cb.checked) this.chosen.add(r.id);
        else this.chosen.delete(r.id);
        this.renderRooms();
      };
      const label = el('label', '', cb, ` ${r.title} `, el('span', r.ready ? 'ok' : 'warn', r.ready ? 'ready' : 'pending'));
      this.roomsEl.append(el('div', '', label));
    }
    const first = c.rooms.find((r) => this.chosen.has(r.id));
    this.startBtn.disabled = !first || !first.ready || c.status.stage === 'error';
    this.hintEl.textContent = c.status.stage === 'error'
      ? 'Course preparation stopped. Retry before starting a run.'
      : !first
      ? c.rooms.length ? 'Choose at least one room.' : 'Preparing your first room…'
      : first.ready
        ? ''
        : `Waiting for "${first.title}" to finish ingesting.`;
  }

  private async start() {
    if (!this.courseId || !this.course) return;
    const roomIds = this.course.rooms.filter((r) => this.chosen.has(r.id)).map((r) => r.id);
    const run = await call(() =>
      api.createRun({ courseId: this.courseId!, targetGrade: this.grade, studentEmoji: this.emoji, scope: { roomIds } }),
    );
    if (!run) return; // a 425 shows "Not ready yet" in the banner
    setRun(run);
    state.results = null;
    goTo('Learning');
  }
}



