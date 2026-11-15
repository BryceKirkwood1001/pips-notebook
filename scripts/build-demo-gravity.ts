/**
 * Builds the hand-made 90-second gravity demo: samples/demo-gravity.md and samples/cache/demo-gravity.json.
 *
 *   npx tsx scripts/build-demo-gravity.ts
 *
 * One room with two short topics, ten simple questions, two wrong beliefs, and a pace of its own: 3 questions in the
 * room fight, 4 in the boss, at most one question from Pip, and one "Help me!" question on the room fight's second turn. Search
 * vectors come from the offline embedder; seeding re-embeds them when a live provider is selected.
 * Topic summaries and objectives say what to teach, never the answer: the player has to explain it.
 */
import { writeFile } from 'node:fs/promises';
import { CourseFixtureSchema, type Evidence, type Question } from '@pips-notebook/shared';
import { testConfig } from '../server/src/config';
import { createFakeLlmClient } from '../server/src/llm/fake-client';
import { createEmbedder } from '../server/src/rag/embedder';

const SAMPLE = 'demo-gravity';
const COURSE = `sample-${SAMPLE}`;
const TITLE = 'Gravity: 90-Second Demo';
const CREATED = '2026-11-15T00:00:00.000Z';

const FALL_1 = 'Gravity pulls every object toward the center of the Earth.';
const FALL_2 = 'Without air resistance, a heavy ball and a light ball dropped together hit the ground at the same time.';
const FALL_MISTAKE = 'Common mistake: "Heavy things fall faster than light things." Without air resistance, heavy and light objects fall at the same rate.';
const SPACE_1 = 'Gravity does not stop in space.';
const SPACE_2 = 'It is what keeps the Moon going around the Earth.';
const SPACE_MISTAKE = 'Common mistake: "There is no gravity in space." Gravity keeps pulling on things far out in space, like the Moon.';

const sections = [
  { heading: [TITLE], text: `# ${TITLE}\n\nA one-page lesson for a quick game of Pip's Notebook. Teach Pip the two ideas below, then watch Pip fight.`, concepts: [] as string[] },
  { heading: [TITLE, 'Why things fall'], text: `## Why things fall\n\n${FALL_1} ${FALL_2}\n\n${FALL_MISTAKE}`, concepts: ['c1'] },
  { heading: [TITLE, 'Gravity in space'], text: `## Gravity in space\n\n${SPACE_1} ${SPACE_2}\n\n${SPACE_MISTAKE}`, concepts: ['c2'] },
];
const chunkId = (n: number) => `${COURSE}_f1_p1_${n}`;
const evidence = (section: number, quote: string): Evidence => {
  if (!sections[section]!.text.includes(quote)) throw new Error(`Quote not in section ${section}: ${quote}`);
  return { chunkId: chunkId(section), fileId: 'f1', page: 1, quote, sectionPath: sections[section]!.heading };
};

const fall1 = evidence(1, FALL_1), fall2 = evidence(1, FALL_2), fallMistake = evidence(1, FALL_MISTAKE);
const space1 = evidence(2, SPACE_1), space2 = evidence(2, SPACE_2), spaceMistake = evidence(2, SPACE_MISTAKE);

const HEAVY = 'heavier_falls_faster';
const NO_GRAVITY = 'no_gravity_in_space';

const recall = [{ text: 'Recall the fact from the notes.', kind: 'recall' as const }];
const base = (n: number, conceptIds: string[], keyPointIds: string[], misconceptionIds: string[], explanation: string, proof: Evidence) => ({
  id: `${COURSE}_q${n}`, courseId: COURSE, conceptIds, keyPointIds, misconceptionIds, explanation,
  difficulty: 1 as const, verified: true,
  provenance: { origin: 'generated' as const, evidence: proof },
});
const trueFalse = (n: number, conceptIds: string[], keyPointIds: string[], statement: string, correctValue: boolean,
  wrongMisconceptionId: string | null, explanation: string, proof: Evidence): Question => ({
  ...base(n, conceptIds, keyPointIds, wrongMisconceptionId ? [wrongMisconceptionId] : [], explanation, proof),
  type: 'true_false', prompt: 'True or false?', timeBudgetSec: 20,
  solution: { finalAnswer: correctValue ? 'True' : 'False', workedSteps: recall },
  payload: { statement, correctValue, wrongMisconceptionId },
});
const choice = (n: number, conceptIds: string[], keyPointIds: string[], prompt: string,
  options: [string, string | null][], correctIndex: number, explanation: string, proof: Evidence): Question => ({
  ...base(n, conceptIds, keyPointIds, options.flatMap(([, m]) => (m ? [m] : [])), explanation, proof),
  type: 'mcq', prompt, timeBudgetSec: 25,
  solution: { finalAnswer: `${'ABCD'[correctIndex]}) ${options[correctIndex]![0]}`, workedSteps: recall },
  payload: { options: options.map(([text, misconceptionId]) => ({ text, misconceptionId })), correctIndex },
});

const questions: Question[] = [
  trueFalse(1, ['c1'], ['c1_k2'], 'Without air resistance, a heavy ball and a light ball dropped together land at the same time.', true, null,
    'With no air in the way, gravity makes every object fall at the same rate.', fall2),
  trueFalse(2, ['c1'], ['c1_k2'], 'Without air resistance, heavy objects fall faster than light ones.', false, HEAVY,
    'Heavy and light objects fall at the same rate when there is no air resistance.', fallMistake),
  choice(3, ['c1'], ['c1_k1'], 'Which way does gravity pull a dropped ball?',
    [['Toward the center of the Earth', null], ['Away from the Earth', null], ['Sideways', null], ['It does not pull on it', null]], 0,
    'Gravity pulls every object toward the center of the Earth.', fall1),
  choice(4, ['c1'], ['c1_k2'], 'On the Moon there is no air. A bowling ball and a feather are dropped together. Which lands first?',
    [['The bowling ball', HEAVY], ['The feather', null], ['They land at the same time', null], ['Neither one falls', null]], 2,
    'With no air resistance, heavy and light objects fall at the same rate.', fall2),
  trueFalse(5, ['c2'], ['c2_k1'], 'There is gravity in space.', true, null, 'Gravity does not stop in space.', space1),
  trueFalse(6, ['c2'], ['c2_k1'], 'There is no gravity in space.', false, NO_GRAVITY,
    'Gravity does not stop in space; it keeps the Moon going around the Earth.', spaceMistake),
  choice(7, ['c2'], ['c2_k2'], 'What keeps the Moon going around the Earth?',
    [['Magnets', null], ['Gravity', null], ['Nothing, it just drifts', NO_GRAVITY], ["The Sun's light", null]], 1,
    'Gravity pulls on the Moon and keeps it going around the Earth.', space2),
  trueFalse(8, ['c2'], ['c2_k2'], 'Gravity still pulls on the Moon, even though it is far out in space.', true, NO_GRAVITY,
    'Gravity does not stop in space, so it keeps pulling on the Moon.', space2),
  choice(9, ['c1', 'c2'], ['c1_k1', 'c2_k1'], 'Which statement about gravity is correct?',
    [['Heavy objects always fall faster', HEAVY], ['There is no gravity in space', NO_GRAVITY],
      ['Gravity pulls on a dropped ball and on the Moon', null], ['Gravity only pulls on heavy objects', null]], 2,
    'Gravity pulls on everything, near the ground and out in space.', space1),
  trueFalse(10, ['c1', 'c2'], ['c1_k1', 'c2_k2'], 'The same gravity that pulls a dropped ball down also keeps the Moon going around the Earth.', true, NO_GRAVITY,
    'Gravity pulls the ball toward the Earth, and it pulls on the Moon too, keeping it going around the Earth.', space2),
];

const markdown = sections.map((s) => s.text).join('\n\n') + '\n';
const config = testConfig();
const embedder = createEmbedder(createFakeLlmClient({ embeddingDims: config.embeddingDims }), config);
const vectors = await embedder.embedDocuments(sections.map((s) => s.text));

const fixture = CourseFixtureSchema.parse({
  version: 1,
  sample: SAMPLE,
  embedderId: embedder.id,
  pack: {
    id: COURSE,
    title: TITLE,
    language: 'en',
    files: [{ id: 'f1', name: `${SAMPLE}.md`, type: 'md', pages: 1 }],
    status: { stage: 'ready', conceptsReady: ['c1', 'c2'] },
    styleProfile: {
      voice: 'A one-page demo handout: two short ideas, each with its common mistake.',
      notation: 'Plain words, no formulas.',
      formatMix: { mcq: 0.4, true_false: 0.6, multi_select: 0, numeric: 0, short_text: 0, ordering: 0, free_response: 0 },
      typicalScenarios: ['dropping a heavy and a light object', 'the Moon going around the Earth'],
      avgSolutionSteps: 1,
      difficultyBand: { min: 1, max: 1 },
      exemplarItemIds: ['m1', 'm2'],
    },
    units: [{ id: 'u1', title: 'Gravity', order: 1, conceptIds: ['c1', 'c2'] }],
    concepts: [
      {
        id: 'c1', unitId: 'u1', order: 1, prerequisites: [], title: 'Why things fall',
        summary: 'Teach Pip which way gravity pulls, and what happens when a heavy ball and a light ball are dropped together with no air in the way.',
        keyPoints: [
          { id: 'c1_k1', statement: FALL_1, evidence: fall1 },
          { id: 'c1_k2', statement: FALL_2, evidence: fall2 },
        ],
        misconceptions: [{
          id: HEAVY, conceptId: 'c1', origin: 'material', likelihood: 3, evidence: fallMistake,
          description: 'Thinks heavier objects fall faster than lighter ones.',
          beliefStatement: 'Heavy things fall faster than light things.',
          correction: 'Without air resistance, heavy and light objects fall at the same rate and land together.',
        }],
      },
      {
        id: 'c2', unitId: 'u1', order: 2, prerequisites: ['c1'], title: 'Gravity in space',
        summary: 'Teach Pip whether gravity still works in space, and what keeps the Moon going around the Earth.',
        keyPoints: [
          { id: 'c2_k1', statement: SPACE_1, evidence: space1 },
          { id: 'c2_k2', statement: 'Gravity is what keeps the Moon going around the Earth.', evidence: space2 },
        ],
        misconceptions: [{
          id: NO_GRAVITY, conceptId: 'c2', origin: 'material', likelihood: 3, evidence: spaceMistake,
          description: 'Thinks there is no gravity in space.',
          beliefStatement: 'There is no gravity in space.',
          correction: 'Gravity does not stop in space. It keeps the Moon going around the Earth.',
        }],
      },
    ],
    rooms: [{
      id: 'r1', title: 'Gravity everywhere', order: 1, conceptIds: ['c1', 'c2'],
      description: 'Two quick ideas about gravity. Teach each one in a sentence, then send Pip to fight.',
      learningObjectives: ['Explain what happens when a heavy ball and a light ball are dropped together.', 'Explain whether there is gravity in space, and what keeps the Moon going around the Earth.'],
    }],
    materialItems: [
      { id: 'm1', kind: 'common_mistake', text: FALL_MISTAKE, conceptIds: ['c1'], evidence: fallMistake },
      { id: 'm2', kind: 'common_mistake', text: SPACE_MISTAKE, conceptIds: ['c2'], evidence: spaceMistake },
    ],
    pace: { roomQuestions: 3, roomHearts: 3, bossQuestions: 4, maxStudentQuestions: 1, helpMeProb: 0, helpMeRoomTurn: 2 },
    createdAt: CREATED,
    updatedAt: CREATED,
  },
  questions,
  chunks: sections.map((s, n) => ({
    id: chunkId(n), courseId: COURSE, fileId: 'f1', page: 1, sectionPath: s.heading, conceptIds: s.concepts,
    text: s.text, embedding: vectors[n],
  })),
});

await writeFile(new URL(`../samples/${SAMPLE}.md`, import.meta.url), markdown);
await writeFile(new URL(`../samples/cache/${SAMPLE}.json`, import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(`Wrote samples/${SAMPLE}.md and samples/cache/${SAMPLE}.json: ${questions.length} questions, ${fixture.chunks.length} chunks.`);
