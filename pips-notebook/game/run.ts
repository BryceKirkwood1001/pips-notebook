import { cards, MockAnswer, MockLessonPlanner, MockStudent, newEntry } from './lesson.js';
import type { Answer, Concept, FileInfo, Lesson, LessonPlanner, Notebook, Question, Strategy } from './lesson.js';

type Screen = 'title' | 'setup' | 'room' | 'boss' | 'report';
type Phase = 'teach' | 'intro' | 'question' | 'answer' | 'won' | 'lost';
export class DungeonRun {
    screen: Screen = 'title';
    phase: Phase = 'teach';
    files: FileInfo[] = [];
    target = 80;
    lesson: Lesson = { concepts: [], boss: [] };
    index = 0;
    completed = 0;
    health = 100;
    energy = 3;
    monster = 32;
    rounds = 0;
    notebook: Notebook = {};
    history: Answer[] = [];
    dialogue = '';
    victory = false;
    entry = { health: 100, book: {} as Notebook, answers: 0 };
    get concept(): Concept { return this.lesson.concepts[this.index]!; }
    get isBoss() { return this.screen === 'boss'; }
    get maxMonster() { return this.isBoss ? 60 : 32; }
    get currentQuestion(): Question {
        const pool = this.isBoss ? this.lesson.boss : this.concept.questions;
        return pool[this.rounds % pool.length]!;
    }
    async start(planner: LessonPlanner = MockLessonPlanner) {
        let lesson: Lesson;
        try {
            lesson = await planner(this.files);
            const valid = (q: Question) => q.prompt && q.correct && q.wrong && q.weight >= 1 && Number.isFinite(q.weight)
                && q.needs.length && q.needs.every(i => Number.isInteger(i) && i >= 0 && i < lesson.concepts.length);
            if (!lesson.concepts.length || !lesson.boss.length || !lesson.boss.every(valid) ||
                !lesson.concepts.every(c => c.title && c.questions.length && c.questions.every(valid))) throw Error('Invalid lesson');
        } catch { lesson = await MockLessonPlanner(this.files); }
        this.lesson = lesson;
        this.health = 100; this.index = 0; this.completed = 0; this.history = []; this.notebook = {}; this.victory = false;
        this.enterRoom();
    }
    private enterRoom() {
        this.entry = { health: this.health, book: structuredClone(this.notebook), answers: this.history.length };
        this.screen = 'room'; this.phase = 'teach'; this.energy = 3; this.monster = this.maxMonster; this.rounds = 0;
        this.notebook[this.index] = newEntry(this.concept.title);
        this.dialogue = this.concept.intro;
    }
    teach(strategy: Strategy, words: string) {
        if (this.phase !== 'teach' || this.screen !== 'room' || this.energy < cards[strategy].cost) return;
        const result = MockStudent(this.notebook[this.index]!, this.concept, strategy, words);
        this.notebook[this.index] = result.entry; this.dialogue = result.dialogue;
        this.energy -= cards[strategy].cost;
        if (!this.energy) this.phase = 'intro';
    }
    battle() { if (this.phase === 'teach' || this.phase === 'intro') this.phase = 'question'; }
    resolve() {
        if (this.phase !== 'question') return;
        const answer = MockAnswer(this.notebook, this.currentQuestion, this.isBoss);
        if (answer.correct) this.monster = Math.max(0, this.monster - answer.damage);
        else this.health = Math.max(0, this.health - answer.damage);
        this.history.push(answer); this.rounds++; this.phase = 'answer';
    }
    advance() {
        if (this.phase !== 'answer') return;
        if (!this.health) { this.phase = 'lost'; if (this.isBoss) this.screen = 'report'; }
        else if (!this.monster) {
            this.phase = 'won';
            if (this.isBoss) this.victory = true;
            else this.completed = this.index + 1;
        } else this.phase = 'question';
    }
    retry() {
        if (this.screen !== 'room' || !['won','lost'].includes(this.phase)) return;
        this.health = this.entry.health; this.notebook = structuredClone(this.entry.book);
        this.history.length = this.entry.answers; this.completed = this.index; this.enterRoom();
    }
    next() {
        if (this.phase !== 'won' || !this.health) return;
        if (this.isBoss) { this.screen = 'report'; return; }
        if (this.index + 1 < this.lesson.concepts.length) { this.index++; this.enterRoom(); }
        else { this.screen = 'boss'; this.phase = 'intro'; this.monster = this.maxMonster; this.rounds = 0; }
    }
}
