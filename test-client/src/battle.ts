// Shared fight code for FightScene (room) and BossScene (boss): sprites, animation, log, "Help me!" modal.
import Phaser from 'phaser';
import type { Answer, HelpMeTurn, HelpResultTurn, PublicRun, RunPhase, StudentAnswerTurn, TurnResult } from '@top/shared/api-client';
import { api, call, goTo, sceneForPhase, setRun, state } from './app';
import { buildHelp } from './helpModal';
import { EMOJI_FONT, GAME_H, GAME_W, btn, el, panel, questionEl, title } from './ui';

const MONSTERS = ['👹', '🦇', '🕷️', '🐍'];
type Kind = 'room' | 'boss';

export abstract class BattleScene extends Phaser.Scene {
  private student!: Phaser.GameObjects.Text;
  private monster!: Phaser.GameObjects.Text;
  private fx!: Phaser.GameObjects.Text;
  private statText!: Phaser.GameObjects.Text;
  private bar?: Phaser.GameObjects.Graphics;
  private logEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private endEl!: HTMLElement;
  private nextBtn!: HTMLButtonElement;
  private modal?: Phaser.GameObjects.DOMElement;
  private stopHelp?: () => void;
  private hearts = 0;
  private maxHearts = 0;
  private health = 100;
  private answered = 0;
  private total = 0;

  constructor(key: string, private kind: Kind) {
    super(key);
  }

  create() {
    const run = state.run;
    if (!run) return goTo('Upload');
    const boss = this.kind === 'boss';
    const fight = boss ? run.boss : run.room;
    this.total = fight?.totalTurns ?? 0;
    this.answered = 0;
    this.modal = undefined;
    this.stopHelp = undefined;
    this.maxHearts = run.room?.maxHearts ?? run.rules.roomHearts;
    this.hearts = run.room?.hearts ?? this.maxHearts;
    this.health = run.boss?.health ?? 100;

    title(this, boss ? `${run.studentEmoji}  vs  🐉  BOSS` : `${run.studentEmoji}  Fight: ${run.currentRoom?.title ?? ''}`);
    this.student = this.add.text(220, 215, run.studentEmoji, { fontSize: '96px', fontFamily: EMOJI_FONT }).setOrigin(0.5);
    const monsterEmoji = boss ? '🐉' : MONSTERS[run.roomIndex % MONSTERS.length];
    this.monster = this.add.text(GAME_W - 220, 215, monsterEmoji, { fontSize: '96px', fontFamily: EMOJI_FONT }).setOrigin(0.5);
    this.fx = this.add.text(0, 0, '', { fontSize: '56px', fontFamily: EMOJI_FONT }).setOrigin(0.5).setAlpha(0);
    this.statText = this.add.text(GAME_W / 2, 90, '', { fontSize: '30px', color: '#ffffff', fontFamily: EMOJI_FONT }).setOrigin(0.5);
    if (boss) this.bar = this.add.graphics();
    this.drawStats();

    this.logEl = el('div', 'log');
    this.detailEl = el('div', 'box', el('span', 'dim', 'Press "Next turn" to start.'));
    this.endEl = el('div');
    this.nextBtn = btn('Next turn', () => void this.nextTurn());
    const left = el('div', '', el('h4', '', 'Turn log'), this.logEl);
    const right = el('div', '', this.detailEl, el('div', '', this.nextBtn), this.endEl);
    panel(this, 20, 300, 1060, 410, el('div', 'cols', left, right));
    // The right column scrolls with the panel; keep the log narrower than the details.
    left.style.flex = '0 0 380px';

    for (const r of fight?.log ?? []) this.addLog(r);
    this.drawStats();
    const last = fight?.log[fight.log.length - 1];
    if (last) this.showDetail(last);
    if (run.phase === 'room_result' || run.phase === 'results') this.nextBtn.textContent = 'Show result';
    if (run.pendingHelpMe) this.openHelp(run.pendingHelpMe);

    this.events.once('shutdown', () => this.stopHelp?.());
  }

  // ── Turn flow ─────────────────────────────────────────────────────────────

  private async nextTurn() {
    const run = state.run;
    if (!run) return;
    const r = await call(() => api.turn(run.id));
    if (r) await this.handle(r);
  }

  private async handle(r: TurnResult) {
    const run = state.run!;
    switch (r.kind) {
      case 'help_me':
        run.pendingHelpMe = r;
        this.openHelp(r);
        return;
      case 'student_answer':
      case 'help_result':
        this.nextBtn.disabled = true;
        this.addLog(r);
        this.showDetail(r);
        // Browsers pause animation frames in a background tab, so never let the game wait on a tween
        // forever: after a few seconds, move on and show the final state.
        await Promise.race([this.animate(r), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
        if (r.hearts !== undefined) this.hearts = r.hearts; // 3. update the hearts or the health
        if (r.health !== undefined) this.health = r.health;
        this.drawStats();
        this.nextBtn.disabled = false;
        this.afterDamage(r.phaseAfter);
        return;
      case 'room_end':
        this.hearts = r.hearts;
        this.drawStats();
        this.nextBtn.style.display = 'none';
        this.showRoomEnd(r.passed, r.failedTurns);
        return;
      case 'boss_end':
        state.results = r.results;
        setRun({ ...run, phase: 'results' });
        goTo('Results');
    }
  }

  private afterDamage(phaseAfter: RunPhase) {
    if (state.run) state.run.phase = phaseAfter;
    if (phaseAfter === 'room_result' || phaseAfter === 'results') this.nextBtn.textContent = 'Show result';
  }

  // ── Animation: the attack, then hit or miss, then hearts/health ───────────

  private tw(target: Phaser.GameObjects.Text, props: Record<string, number>, duration: number, yoyo = true): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({ targets: target, ...props, duration, yoyo, ease: 'Sine.easeInOut', onComplete: () => resolve() });
    });
  }

  private async pop(emoji: string, at: Phaser.GameObjects.Text) {
    this.fx.setText(emoji).setPosition(at.x, at.y - 30).setAlpha(1);
    await new Promise<void>((resolve) => {
      this.tweens.add({ targets: this.fx, y: at.y - 90, alpha: 0, duration: 450, onComplete: () => resolve() });
    });
  }

  private async animate(r: StudentAnswerTurn | HelpResultTurn) {
    const sx = this.student.x;
    await this.tw(this.student, { x: this.monster.x - 160 }, 260); // 1. the attack
    if (r.correct) {
      void this.tw(this.monster, { x: this.monster.x + 25 }, 70); // 2. hit
      await this.pop('💥', this.monster);
    } else {
      await this.pop('💨', this.monster); // 2. miss, and the monster counters
      await this.tw(this.monster, { x: sx + 160 }, 260);
      void this.tw(this.student, { x: sx - 25 }, 70);
      await this.pop('💢', this.student);
    }
  }

  private drawStats() {
    if (this.kind === 'room') {
      this.statText.setText(`${'❤️'.repeat(Math.max(this.hearts, 0))}${'🖤'.repeat(Math.max(this.maxHearts - this.hearts, 0))}   Q ${Math.min(this.answered, this.total)}/${this.total}`);
      return;
    }
    this.statText.setText(`🐉 Boss health ${this.health}/100   Q ${Math.min(this.answered, this.total)}/${this.total}`);
    const g = this.bar!;
    g.clear().fillStyle(0x3a2030).fillRect(GAME_W / 2 - 200, 125, 400, 22);
    g.fillStyle(0xd7263d).fillRect(GAME_W / 2 - 200, 125, (400 * Math.max(this.health, 0)) / 100, 22);
  }

  // ── Log and detail panels ─────────────────────────────────────────────────

  private addLog(r: TurnResult) {
    if (r.kind === 'student_answer' || r.kind === 'help_result') this.answered += 1;
    let text = '';
    if (r.kind === 'student_answer') text = `${r.correct ? '✅' : '❌'} ${r.question.prompt}`;
    else if (r.kind === 'help_result') text = `🆘 ${r.correct ? '✅' : '❌'}${r.late ? ' (late)' : ''} ${r.question.prompt}`;
    else if (r.kind === 'help_me') text = '🆘 Help me!';
    if (!text) return;
    this.logEl.append(el('div', '', text));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private showDetail(r: TurnResult) {
    const d = this.detailEl;
    d.replaceChildren();
    if (r.kind === 'student_answer') {
      d.append(
        questionEl(r.question),
        el('div', '', 'Student answered: ', el('b', '', r.answerText), ' ', el('span', r.correct ? 'ok' : 'bad', r.correct ? 'CORRECT' : 'WRONG')),
        el('div', '', `Correct answer: ${r.correctAnswer.text}`),
        el('div', '', `Reasoning: ${r.reasoning}`),
        el('div', '', 'Cited notes:'),
        el('ul', '', ...(r.citedNotes.length ? r.citedNotes : ['(none)']).map((n) => el('li', '', n))),
        r.reason ? el('div', 'bad', `Why wrong: ${r.reason}`) : '',
        el('div', 'dim', `Explanation: ${r.explanation}`),
        el('div', 'dim', `Damage: ${r.damage}`),
      );
    } else if (r.kind === 'help_result') {
      d.append(
        questionEl(r.question),
        el('div', '', 'Your answer: ', el('span', r.correct ? 'ok' : 'bad', r.correct ? 'CORRECT' : 'WRONG'), r.late ? el('span', 'bad', ' (too late)') : null),
        el('div', '', `Solve time: ${r.solveTimeSec}s`),
        el('div', '', `Correct answer: ${r.correctAnswer.text}`),
        el('div', 'dim', `Explanation: ${r.explanation}`),
        r.noteAdded ? el('div', 'ok', `Note added to the notebook: ${r.noteAdded}`) : '',
        el('div', 'dim', `Damage: ${r.damage}`),
      );
    }
  }

  private showRoomEnd(passed: boolean, failed: { question: StudentAnswerTurn['question']; reasoning: string; citedNotes: string[] }[]) {
    const e = this.endEl;
    e.replaceChildren();
    if (passed) {
      e.append(el('h3', 'ok', 'Room cleared!'), btn('Continue', () => void this.move(() => api.continueRun(state.run!.id))));
      return;
    }
    e.append(el('h3', 'bad', 'The student failed this room.'), el('div', 'dim', 'Reasoning trace of the wrong answers:'));
    for (const f of failed) {
      e.append(el('div', 'box', questionEl(f.question), el('div', '', `Reasoning: ${f.reasoning}`), el('div', 'dim', `Cited: ${f.citedNotes.join(' | ') || '(none)'}`)));
    }
    e.append(btn('Retry (back to learning)', () => void this.move(() => api.retry(state.run!.id))));
  }

  private async move(fn: () => Promise<PublicRun>) {
    const run = await call(fn);
    if (!run) return;
    setRun(run);
    goTo(sceneForPhase(run.phase));
  }

  // ── "Help me!" modal ──────────────────────────────────────────────────────

  private openHelp(ev: HelpMeTurn) {
    this.closeHelp();
    this.nextBtn.disabled = true;
    const built = buildHelp(ev, (a) => void this.submitHelp(ev, a));
    this.stopHelp = built.stop;
    const wrap = el('div', 'modal', el('div', 'panel', built.el));
    this.modal = this.add.dom(0, 0, wrap).setOrigin(0, 0);
    wrap.style.width = `${GAME_W}px`;
    wrap.style.height = `${GAME_H}px`;
  }

  private closeHelp() {
    this.stopHelp?.();
    this.modal?.destroy();
    this.modal = undefined;
  }

  private async submitHelp(ev: HelpMeTurn, answer: Answer) {
    const run = state.run;
    if (!run) return;
    const r = await call(() => api.help(run.id, ev.eventId, answer));
    if (!r) return; // error banner shown; the modal stays so the player can retry
    this.closeHelp();
    delete run.pendingHelpMe;
    this.nextBtn.disabled = false;
    await this.handle(r);
  }
}
