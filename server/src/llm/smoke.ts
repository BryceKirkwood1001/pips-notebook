/** `npm run llm:smoke`: one live call per gameplay task plus one embed. Skips without GEMINI_API_KEY. */
import { loadConfigFromProcess } from '../config';
import { createGeminiClient } from './gemini-client';
import { createGameplayTasks } from './gameplay/gemini';

async function timed<T>(name: string, fn: () => Promise<T>): Promise<void> {
  const t0 = Date.now();
  const out = await fn();
  console.log(`\n== ${name} (${Date.now() - t0} ms)\n${JSON.stringify(out, null, 2)}`);
}

async function main(): Promise<void> {
  const config = loadConfigFromProcess();
  if (!config.geminiApiKey) {
    console.log('llm:smoke: GEMINI_API_KEY is not set, skipping.');
    return;
  }
  const llm = createGeminiClient(config);
  const tasks = createGameplayTasks(llm, config);
  const misc = {
    id: 'distance_causes_seasons',
    conceptId: 'c1',
    description: 'Thinks seasons come from distance to the Sun',
    beliefStatement: "We're closer to the Sun in summer.",
    correction: "Seasons come from Earth's 23.5 degree axial tilt, not distance.",
    likelihood: 3,
  };
  const evidence = [
    { chunkId: 'x', fileId: 'f', page: 1, sectionPath: ['Seasons'], text: "Earth's axial tilt of 23.5 degrees causes the seasons.", score: 1, source: 'concept' as const },
  ];
  const notebookMd = "## Seasons\n- Earth's axis is tilted 23.5 degrees.\n- Summer happens when our hemisphere tilts toward the Sun.";
  const question = {
    id: 'q1',
    type: 'mcq' as const,
    prompt: 'What causes the seasons?',
    difficulty: 1 as const,
    timeBudgetSec: 30,
    payload: { options: ['Distance from the Sun', "Earth's axial tilt", 'The Moon', 'Solar flares'] },
  };

  await timed('embed', async () => {
    const v = await llm.embed(['axial tilt causes seasons'], 'RETRIEVAL_QUERY');
    return { count: v.length, dims: v[0].length };
  });
  await timed('studentReview', () =>
    tasks.studentReview({
      concepts: [{ id: 'c1', title: 'Seasons', summary: 'Why Earth has seasons' }],
      explanation: "Seasons happen because the Earth's axis is tilted, so sunlight hits each hemisphere differently through the year.",
      notebookMd: '## Seasons\n',
      misconceptions: [misc],
      activeMisconceptionIds: [],
      probeableMisconceptionIds: [misc.id],
      maxQuestions: 2,
    }),
  );
  await timed('checkResolution', () =>
    tasks.checkResolution({
      misconception: misc,
      question: 'Is it hotter in summer because we are closer to the Sun?',
      answer: "No, it is the 23.5 degree tilt of Earth's axis, not distance.",
      evidence,
    }),
  );
  await timed('studentAnswer', () => tasks.studentAnswer({ notebookMd, question }));
  await timed('gradeOpen', async () =>
    tasks.gradeOpen({
      question: {
        id: 'q2',
        courseId: 'c',
        type: 'free_response',
        conceptIds: ['c1'],
        keyPointIds: [],
        misconceptionIds: [misc.id],
        prompt: 'Explain what causes the seasons.',
        solution: { finalAnswer: "Earth's axial tilt", workedSteps: [] },
        explanation: '',
        difficulty: 2,
        timeBudgetSec: 60,
        provenance: { origin: 'generated', evidence: { fileId: 'f', page: 1, chunkId: 'x', quote: 'axial tilt' } },
        verified: true,
        payload: { rubric: 'Must mention axial tilt.', modelAnswer: "The tilt of Earth's axis changes how directly sunlight hits each hemisphere." },
      } as never,
      answerText: 'Because Earth is closer to the Sun in summer.',
      candidateMisconceptions: [misc],
      evidence,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
