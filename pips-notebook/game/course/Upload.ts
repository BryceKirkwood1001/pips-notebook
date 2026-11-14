import { Page, panel, title } from './page.js';
import { TARGET_GRADES, type PublicCourse, type TargetGrade } from './api-client.js';
import { api, call, courseSource, describeError, goTo, openCoursePicker, setCourseSource, setRun, showError, state } from './app.js';
import { btn, el, clock, inline } from './ui.js';
import { resume } from './app.js';
import { lessonGuide } from './lesson-guide.js';
import { travel } from './transition.js';
import { canPlay, describeRun, endExpedition, removeDungeon, removeExpedition } from './expedition.js';
import { setArrival } from '../art.js';

const STAGES = ['parsing', 'outline', 'style', 'concepts', 'ready'];

export class UploadScene extends Page {
  private courseId: string | null = null;
  private course: PublicCourse | null = null;
  private chosen = new Set<string>();
  private known = new Set<string>();
  private grade: TargetGrade = 'B';
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
    const archive = el('div','saved-courses',el('p','dim','Loading your archive…'));
    void call(async () => ({samples:await api.listSamples(), archive:await api.listArchive()})).then((res) => {
      if (!this.active) return;
      samples.replaceChildren();
      archive.replaceChildren();
      if (!res) return samples.append(btn('Reload archive', () => goTo('Upload')));
      for (const c of res.archive.courses) {
        const runs = res.archive.runs.filter(r=>r.courseId===c.id);
        const entry=el('article','saved-course',el('h4','',c.title),el('p','dim',`${c.rooms.length} lessons · ${c.status.stage}`),
          el('div','saved-course-actions',btn('View lessons',()=>this.begin({courseId:c.id}),'alt'),
            btn('Delete dungeon',async()=>{ if (await removeDungeon(c.id,c.title,runs.length) && this.active) openCoursePicker('Library'); },'alt remove')));
        // Every expedition on this course, most recent first: open it, end it early, or remove it.
        if (runs.length) entry.append(el('ul','saved-runs',...runs.map(r=>{
          const open=btn(r.phase==='results'?'View results':r.endedAt?'View record':'Resume',()=>void resume(r.id),r.endedAt?'alt':'gold');
          const row=el('li','',el('span','',el('strong','',r.endedAt?'Ended':r.phase==='results'?'Finished':'In progress'),el('small','dim',describeRun(r))),
            el('span','saved-run-actions',open,
              canPlay(r)?btn('End',async()=>{ if (await endExpedition(r.id) && this.active) goTo('Upload'); },'alt'):null,
              btn('Remove',async()=>{ if (await removeExpedition(r.id) && this.active) goTo('Upload'); },'alt remove')));
          if (r.endedAt) row.classList.add('ended');
          return row;
        })));
        archive.append(entry);
      }
      if (!res.archive.courses.length) archive.append(el('p','dim','Your prepared dungeons will appear here, ready to return to after a restart.'));
      for (const s of res.samples.samples) {
        samples.append(btn(s.title, async () => { this.retryUpload = null; this.begin(await call(() => api.seedCourse(s.id))); }));
      }
      if (!res.samples.samples.length) samples.append(el('div', 'dim', 'No samples available.'));
    });

    const files = el('input');
    files.type = 'file';
    files.multiple = true;
    files.accept = '.pdf,.txt,.md,.markdown';
    files.setAttribute('aria-label','Course files');
    const selection = el('span', 'file-selection', 'PDF, text, or Markdown');
    const picker = el('label', 'archive-picker', files, el('strong', '', 'Choose course files'), selection);
    files.onchange = () => {
      selection.textContent = Array.from(files.files ?? [], f => f.name).join(' · ') || 'PDF, text, or Markdown';
    };
    const text = el('textarea');
    text.rows = 6;
    text.id = 'dungeon-notes';
    text.placeholder = 'Paste course notes here';
    text.setAttribute('aria-label', 'Course notes');
    const courseTitle = el('input');
    courseTitle.type = 'text';
    courseTitle.id = 'dungeon-title';
    courseTitle.maxLength = 200;
    courseTitle.placeholder = 'Dungeon title (optional)';
    const titleLabel = el('label', 'dungeon-title-label', 'Dungeon title (optional)');
    titleLabel.htmlFor = courseTitle.id;
    const create = btn('Create dungeon', async () => {
      const list = Array.from(files.files ?? [], file => ({ name: file.name, data: file }));
      const notes = text.value;
      if (!list.length && !notes.trim()) return showError('Add at least one file or paste some notes. You can use both.');
      const title = courseTitle.value.trim() || undefined;
      this.retryUpload = async () => this.begin(await call(() => list.length
        ? api.uploadCourse(list, title, notes)
        : api.createCourseFromText(notes, title)));
      await this.retryUpload();
    });

    const methods = [
      { name: 'Library', body: el('div', '', el('h3', '', 'Your saved dungeons'), archive, el('h3', '', 'Sample lessons'), samples) },
      { name: 'Create New Dungeon', body: el('div', 'create-dungeon', el('h3', '', 'Create New Dungeon'),
        el('p', '', 'Upload files, paste notes, or use both. All your sources become one dungeon.'),
        el('div', 'dungeon-sources',
          el('fieldset', 'dungeon-source', el('legend', '', 'Files (optional)'), picker,
            el('p', 'dim', 'PDF, text, and Markdown files are supported.')),
          el('fieldset', 'dungeon-source', el('legend', '', 'Notes (optional)'), text,
            el('p', 'dim', 'Use notes alone, or add context to your files.'))),
        titleLabel, courseTitle, create) },
    ] as const;
    const bookmarks = el('div', 'bookmarks');
    bookmarks.setAttribute('role', 'group');
    bookmarks.setAttribute('aria-label', 'Course source');
    const buttons = methods.map(({ name }, i) => btn(name, () => select(i), 'bookmark'));
    const select = (current: number) => {
      setCourseSource(methods[current]!.name);
      this.sourceEl.closest('section')?.classList.toggle('creating', methods[current]!.name === 'Create New Dungeon');
      methods.forEach(({ body }, i) => {
        body.hidden = i !== current;
        buttons[i]!.setAttribute('aria-pressed', String(i === current));
      });
    };
    bookmarks.append(...buttons);
    this.sourceEl.append(el('h2', '', 'My archive'), bookmarks, ...methods.map(m => m.body));
    select(methods.findIndex(method => method.name === courseSource));
  }

  private begin(res: { courseId: string } | undefined) {
    if (!this.active || !res) return;
    clock.clearInterval(this.timer);
    this.course = null; this.chosen.clear(); this.known.clear();
    this.roomsEl.replaceChildren(); this.startBtn.disabled = true;
    this.hintEl.textContent = 'Preparing your course…';
    this.courseId = res.courseId;
    this.courseEl.closest('section')?.classList.add('planning');
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

    const setup = el(
      'div', '',
      el('h3', '', 'Target grade'), grade,
      el('h3', '', 'Scope (rooms to play)'), this.roomsEl,
    );
    this.courseEl.append(btn('Change course', () => goTo('Upload'), 'alt'),
      el('h2', '', 'Plan your expedition'),
      el('div', 'cols course-setup-layout', el('div', 'box', this.progressEl), el('div', 'box', setup)),
      el('div', 'expedition-start', this.startBtn, this.hintEl),
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
    for (const file of c.files) this.progressEl.append(el('p', 'dim', file.name + ' · ' + file.type + ' · ' + file.pages + ' pages'));
    const count=c.rooms.filter(r=>r.ready).length;
    const progress=el('progress');progress.max=c.rooms.length||1;progress.value=count;progress.setAttribute('aria-label','Lessons prepared');
    this.progressEl.append(el('h4','',`${count} of ${c.rooms.length} lessons prepared`),progress);
  }

  private renderRooms() {
    const c = this.course;
    if (!c) return;
    const open = new Set(Array.from(this.roomsEl.querySelectorAll<HTMLDetailsElement>('details[open]'),node=>node.dataset.roomId));
    this.roomsEl.replaceChildren();
    for (const r of c.rooms) {
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = this.chosen.has(r.id);
      cb.onchange = () => {
        if (cb.checked) this.chosen.add(r.id);
        else this.chosen.delete(r.id);
        this.updateStart();
      };
      const label = el('label', 'room-choice', cb, el('strong','',r.title), el('small', r.ready ? 'ok' : 'warn', r.ready ? 'ready' : 'preparing'));
      const concepts=c.units.flatMap(u=>u.concepts).filter(k=>r.conceptIds.includes(k.id));
      const guide=el('details','room-preview',el('summary','','What will I teach?'),lessonGuide({...r,concepts},false));
      guide.dataset.roomId=r.id;guide.open=open.has(r.id);
      this.roomsEl.append(el('div', 'scope-room', label, r.description?el('p','',inline(r.description)):null,guide));
    }
    this.updateStart();
  }

  private updateStart() {
    const c=this.course;
    if(!c)return;
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
    const rooms = this.course.rooms.filter((r) => this.chosen.has(r.id));
    const roomIds = rooms.map((r) => r.id);
    await travel({ kicker: `Room 1 of ${rooms.length}`, title: rooms[0]?.title ?? this.course.title,
      detail: 'Pip settles into the library. Teach one topic at a time.' }, async () => {
      const run = await call(() =>
        api.createRun({ courseId: this.courseId!, targetGrade: this.grade, scope: { roomIds } }),
      );
      if (!run) return false; // a 425 shows "Not ready yet" in the banner
      setRun(run);
      state.results = null;
      setArrival('study');
      goTo('Learning');
      return true;
    });
  }
}



