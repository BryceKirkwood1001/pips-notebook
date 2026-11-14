// In-browser fake of the API client (use with ?mock=1). Just enough to walk through every scene.
// Script: room 1 attempt 1 is lost (reasoning trace), then everything passes; "Help me!" fires on every
// odd turn and cycles through all six question types; the boss has three help events.
import {
  ApiError,
  type Answer,
  type ApiClient,
  type FailedTurn,
  type HelpMeTurn,
  type PublicCourse,
  type PublicQuestion,
  type PublicRun,
  type PublicStudentQuestion,
  type Results,
  type RunPhase,
  type TurnResult,
} from '@top/shared/api-client';

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const q = (id: string, type: string, prompt: string, payload: object): PublicQuestion =>
  ({ id, type, prompt, difficulty: 3, timeBudgetSec: 15, payload }) as PublicQuestion;

// Help questions with their keys, one per type (cycled).
const HELP: { q: PublicQuestion; key: Answer; text: string }[] = [
  { q: q('h1', 'mcq', 'What causes the seasons?', { options: ['Axial tilt', 'Distance to the sun', 'Solar flares'] }), key: { choiceIndex: 0 }, text: 'Axial tilt' },
  { q: q('h2', 'true_false', 'True or false?', { statement: 'Earth is closest to the sun in July.' }), key: { value: false }, text: 'False' },
  { q: q('h3', 'multi_select', 'Which are solstices or equinoxes?', { options: ['June solstice', 'Leap day', 'March equinox'] }), key: { choiceIndexes: [0, 2] }, text: 'June solstice, March equinox' },
  { q: q('h4', 'numeric', 'What is the tilt of Earth\'s axis?', { unit: 'degrees' }), key: { value: 23.5 }, text: '23.5 degrees' },
  { q: q('h5', 'short_text', 'Name the day with equal day and night.', {}), key: { text: 'equinox' }, text: 'equinox' },
  { q: q('h6', 'ordering', 'Order the seasons starting at spring.', { items: ['Autumn', 'Spring', 'Winter', 'Summer'] }), key: { order: [1, 3, 0, 2] }, text: 'Spring, Summer, Autumn, Winter' },
];

// Student questions asked during fights: even index = student gets it right (unless the script says lose).
const STUDENT_QS = [
  { q: q('s1', 'mcq', 'Why is it hotter in summer?', { options: ['Closer to the sun', 'Sunlight hits more directly'] }), right: 'Sunlight hits more directly', wrong: 'Closer to the sun' },
  { q: q('s2', 'true_false', 'True or false?', { statement: 'The seasons are the same in both hemispheres.' }), right: 'False', wrong: 'True' },
];

const ROOMS = [
  { id: 'r1', title: 'Why we have seasons', concepts: [{ id: 'c1', title: 'Axial tilt' }, { id: 'c2', title: 'Orbit' }] },
  { id: 'r2', title: 'Equinoxes and solstices', concepts: [{ id: 'c3', title: 'Solstice' }] },
];

const RESULTS: Results = {
  predictedGradePct: 78.4,
  letter: 'C+',
  target: 'B',
  metTarget: false,
  conceptAccuracy: [
    { conceptId: 'c1', title: 'Axial tilt', correct: 3, total: 4, accuracy: 0.75 },
    { conceptId: 'c2', title: 'Orbit', correct: 1, total: 2, accuracy: 0.5 },
    { conceptId: 'c3', title: 'Solstice', correct: 2, total: 2, accuracy: 1 },
  ],
  helpMe: { offered: 9, correct: 5, wrong: 3, late: 1, avgSolveTimeSec: 11.2 },
  costlyMisconceptions: [
    {
      id: 'm1', conceptId: 'c1', conceptTitle: 'Axial tilt', description: 'Thinks distance to the sun causes the seasons',
      beliefStatement: 'Summer happens because Earth is closer to the sun.', correction: 'Seasons come from the 23.5 degree axial tilt.',
      origin: 'skipped', questionId: 's1', questionPrompt: 'Why is it hotter in summer?',
      materialRef: { fileId: 'f1', fileName: 'seasons.pdf', page: 3, sectionPath: ['Seasons', 'Tilt'], quote: 'The tilt of the axis, not distance, drives the seasons.' },
    },
  ],
};

function isRight(key: Answer, a: Answer): boolean {
  if (key.text !== undefined) return (a.text ?? '').trim().toLowerCase().includes(key.text);
  return JSON.stringify([key.choiceIndex, key.choiceIndexes, key.value, key.order]) === JSON.stringify([a.choiceIndex, a.choiceIndexes, a.value, a.order]);
}

export function createMockApi(): ApiClient {
  let polls = 0;
  let run: PublicRun | null = null;
  let attempt = 1;
  let helpCount = 0;
  let pending: { ev: HelpMeTurn; item: (typeof HELP)[number] } | null = null;
  let over = false;
  let failed: FailedTurn[] = [];
  let questions: PublicStudentQuestion[] = [];
  let notebook = '# Notebook\n';

  const need = (...phases: RunPhase[]) => {
    if (!run || !phases.includes(run.phase)) throw new ApiError(409, 'wrong_phase', `Not allowed in phase ${run?.phase}`);
    return run;
  };
  const fightLog = () => (run!.phase === 'boss' ? run!.boss!.log : run!.room!.log);
  const view = (): PublicRun => {
    const r = run!;
    r.rooms.forEach((x, i) => (x.state = i < r.roomIndex ? 'passed' : i === r.roomIndex ? 'current' : 'upcoming'));
    r.currentRoom = r.phase === 'boss' || r.phase === 'results' ? null : r.rooms[r.roomIndex];
    r.notebookMd = notebook;
    r.learning.pendingQuestions = questions;
    if (pending) r.pendingHelpMe = pending.ev;
    else delete r.pendingHelpMe;
    return structuredClone(r);
  };
  const startFight = (boss: boolean) => {
    over = false;
    failed = [];
    pending = null;
    if (boss) run!.boss = { turn: 0, totalTurns: 6, health: 100, helpMeUsed: 0, log: [] };
    else run!.room = { attempt, turn: 0, totalTurns: 4, hearts: 3, maxHearts: 3, helpMeUsed: 0, log: [] };
  };

  /** Apply damage and work out whether the fight is over. */
  const settle = (wrong: boolean) => {
    const r = run!;
    const boss = r.phase === 'boss';
    const f = boss ? r.boss! : r.room!;
    f.turn += 1;
    const damage = wrong ? (boss ? 17 : 1) : 0;
    if (boss) r.boss!.health -= damage;
    else r.room!.hearts -= damage;
    const done = f.turn >= f.totalTurns || (!boss && r.room!.hearts <= 0);
    over = done;
    if (done) r.phase = boss ? 'results' : 'room_result';
    return { damage, hearts: boss ? undefined : r.room!.hearts, health: boss ? r.boss!.health : undefined, phaseAfter: r.phase };
  };

  const api: ApiClient = {
    health: async () => ({ ok: true, llmProvider: 'mock', storage: 'browser', debug: true }),
    listSamples: async () => (await wait(), { samples: [{ id: 'seasons', title: 'Seasons (mock sample)' }] }),
    seedCourse: async () => (await wait(), polls = 0, { courseId: 'mock-course' }),
    createCourseFromText: async () => (await wait(), polls = 0, { courseId: 'mock-course' }),
    uploadCourse: async () => (await wait(), polls = 0, { courseId: 'mock-course' }),

    getCourse: async (): Promise<PublicCourse> => {
      polls += 1; // the course "ingests" over a few polls; room 2 is ready last
      const stage = polls < 2 ? 'parsing' : polls < 3 ? 'outline' : polls < 6 ? 'concepts' : 'ready';
      const ready = (id: string) => (id === 'r1' ? polls >= 3 : polls >= 6);
      return {
        id: 'mock-course', title: 'Seasons (mock)', status: { stage, conceptsReady: [] }, files: [],
        units: [{ id: 'u1', title: 'Unit 1: The sky', concepts: ROOMS.flatMap((r) => r.concepts.map((c) => ({ ...c, ready: ready(r.id) }))) }],
        rooms: ROOMS.map((r) => ({ id: r.id, title: r.title, conceptIds: r.concepts.map((c) => c.id), ready: ready(r.id) })),
        styleSummary: { voice: 'friendly', notation: 'plain', topFormats: ['mcq'] },
      };
    },

    createRun: async (body) => {
      await wait();
      if (polls < 3) throw new ApiError(425, 'room_not_ready', 'The first room is still being ingested.');
      const ids = body.scope?.roomIds ?? ROOMS.map((r) => r.id);
      const rooms = ROOMS.filter((r) => ids.includes(r.id)).map((r) => ({ ...r, ready: true, state: 'upcoming' as const }));
      attempt = 1; helpCount = 0; questions = []; notebook = '# Notebook\n';
      run = {
        id: 'mock-run', courseId: body.courseId, courseTitle: 'Seasons (mock)', targetGrade: body.targetGrade,
        studentEmoji: body.studentEmoji ?? '🤖', phase: 'learning', roomIndex: 0, rooms, currentRoom: rooms[0], notebookMd: notebook,
        learning: { pendingQuestions: [], teachCount: 0 },
        rules: { roomQuestions: 4, roomHearts: 3, bossQuestions: 6, maxStudentQuestions: 3, helpMeTimed: true },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      return view();
    },
    getRun: async (id) => {
      await wait(50);
      if (!run || run.id !== id) throw new ApiError(404, 'not_found', 'Run not found (the mock forgets runs on reload).');
      return view();
    },

    teach: async (_id, explanation) => {
      await wait();
      need('learning');
      run!.learning.teachCount += 1;
      const title = run!.currentRoom!.concepts[0].title;
      notebook = `# Notebook\n## ${title}\n- ${explanation.slice(0, 60)}\n- Summer happens because Earth is closer to the sun.\n`;
      if (!questions.length) {
        questions = [{ id: 'sq1', text: 'Wait, is it hotter in summer because we are closer to the sun?', status: 'open' }, { id: 'sq2', text: 'What is a solstice?', status: 'open' }];
      }
      return { notebookMd: notebook, questions: structuredClone(questions) };
    },
    answerQuestion: async (_id, qid, answer) => {
      await wait();
      need('learning');
      const resolved = answer.trim().length > 15; // a long answer "resolves" it
      questions.find((x) => x.id === qid)!.status = 'answered';
      if (resolved) notebook += '- Seasons come from the 23.5 degree axial tilt.\n';
      return { resolved, notebookMd: notebook };
    },
    skipQuestion: async (_id, qid) => {
      await wait();
      need('learning');
      questions.find((x) => x.id === qid)!.status = 'skipped';
      return { notebookMd: notebook };
    },
    ready: async () => {
      await wait();
      need('learning');
      questions.forEach((x) => (x.status = x.status === 'open' ? 'skipped' : x.status));
      run!.phase = 'room';
      startFight(false);
      return view();
    },

    turn: async (): Promise<TurnResult> => {
      await wait();
      need('room', 'room_result', 'boss', 'results');
      const r = run!;
      const boss = r.boss && (r.phase === 'boss' || r.phase === 'results');
      if (over) {
        if (boss) return { kind: 'boss_end', results: RESULTS };
        return { kind: 'room_end', passed: r.room!.hearts > 0, hearts: r.room!.hearts, failedTurns: failed };
      }
      if (pending) return pending.ev;
      const f = boss ? r.boss! : r.room!;
      if (f.turn % 2 === 1) {
        const item = HELP[helpCount++ % HELP.length];
        const ev: HelpMeTurn = {
          kind: 'help_me', eventId: `e${helpCount}`, question: item.q, timeBudgetSec: 15,
          deadline: item.q.type === 'ordering' ? null : new Date(Date.now() + 15000).toISOString(), // ordering is untimed
        };
        pending = { ev, item };
        fightLog().push(ev);
        return ev;
      }
      // The student answers. Room 1 attempt 1 is lost on purpose; the boss gets one wrong.
      const lose = (r.roomIndex === 0 && attempt === 1 && !boss) || (!!boss && f.turn === 2);
      const s = STUDENT_QS[(f.turn / 2) % 2];
      const d = settle(lose);
      const res: TurnResult = {
        kind: 'student_answer', question: s.q, answer: {}, answerText: lose ? s.wrong : s.right, correct: !lose,
        correctAnswer: { answer: {}, text: s.right }, explanation: 'Direct sunlight is stronger.',
        reasoning: lose ? 'My notes say summer is when we are closer to the sun.' : 'My notes mention the tilt.',
        citedNotes: lose ? ['Summer happens because Earth is closer to the sun.'] : ['Seasons come from the 23.5 degree axial tilt.'],
        reason: lose ? 'wrong belief' : undefined, ...d,
      };
      if (lose) failed.push({ question: s.q, reasoning: res.reasoning, citedNotes: res.citedNotes });
      fightLog().push(res);
      return res;
    },
    help: async (_id, eventId, answer) => {
      await wait();
      need('room', 'boss');
      if (!pending || pending.ev.eventId !== eventId) throw new ApiError(409, 'help_event_not_pending', 'That event is not pending.');
      const { ev, item } = pending;
      const late = ev.deadline !== null && Date.now() > Date.parse(ev.deadline) + 1500;
      const correct = !late && isRight(item.key, answer) && !(run!.roomIndex === 0 && attempt === 1 && run!.phase === 'room');
      pending = null;
      const d = settle(!correct);
      const res: TurnResult = {
        kind: 'help_result', eventId, question: item.q, correct, late, correctAnswer: { answer: item.key, text: item.text },
        explanation: 'See the course notes.', solveTimeSec: 7, noteAdded: correct ? undefined : `Remember: ${item.text}`, ...d,
      };
      fightLog().push(res);
      return res;
    },
    retry: async () => {
      await wait();
      need('room_result');
      if (run!.room!.hearts > 0) throw new ApiError(409, 'wrong_phase', 'The room was passed; use continue.');
      attempt += 1;
      run!.phase = 'learning';
      questions = [];
      return view();
    },
    continueRun: async () => {
      await wait();
      need('room_result');
      if (run!.room!.hearts <= 0) throw new ApiError(409, 'wrong_phase', 'The room was failed; use retry.');
      attempt = 1;
      questions = [];
      if (run!.roomIndex + 1 < run!.rooms.length) {
        run!.roomIndex += 1;
        run!.phase = 'learning';
      } else {
        run!.phase = 'boss';
        startFight(true);
      }
      return view();
    },
    getResults: async () => (need('results'), RESULTS),
    getApiSettings: async () => { throw new ApiError(501, 'not_implemented', 'API setup uses the local backend.'); },
    updateApiSettings: async () => { throw new ApiError(501, 'not_implemented', 'API setup uses the local backend.'); },
    testApiSettings: async () => { throw new ApiError(501, 'not_implemented', 'API setup uses the local backend.'); },
    getDebug: async () => ({
      misconceptionStates: [{ id: 'm1', state: 'active', origin: 'skipped' }],
      currentQuestionAnswerKeys: HELP.map((h) => ({ id: h.q.id, key: h.key })),
      provenance: { source: 'mock', quote: 'The tilt of the axis drives the seasons.' },
      timeBudget: { base: 15, difficultyFactor: 1, multiplier: 1 },
    }),
  };
  return api;
}
