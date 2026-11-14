/** Test fixtures shared by the gameplay tests. */
import type { Misconception, PublicQuestion, Question } from '@top/shared';

const ev = { fileId: 'f', page: 1, chunkId: 'ch1', quote: 'q' };

export const MISC_DIST: Misconception = {
  id: 'distance_causes_seasons',
  conceptId: 'c1',
  description: 'Seasons come from distance',
  beliefStatement: "We're closer to the Sun in summer.",
  correction: "Seasons come from Earth's axial tilt, not distance from the Sun.",
  evidence: ev,
  origin: 'material',
  likelihood: 3,
};
export const MISC_MOON: Misconception = {
  ...MISC_DIST,
  id: 'moon_causes_seasons',
  beliefStatement: 'The Moon controls the seasons.',
  correction: 'The Moon only drives tides, seasons come from axial tilt.',
  likelihood: 1,
};

export const MCQ: Question = {
  id: 'q1',
  courseId: 'course',
  type: 'mcq',
  conceptIds: ['c1'],
  keyPointIds: [],
  misconceptionIds: [MISC_DIST.id],
  prompt: 'What causes the seasons on Earth?',
  solution: { finalAnswer: "Earth's axial tilt", workedSteps: [] },
  explanation: 'Tilt.',
  difficulty: 1,
  timeBudgetSec: 30,
  provenance: { origin: 'generated', evidence: ev },
  verified: true,
  payload: {
    options: [
      { text: 'Distance from the Sun', misconceptionId: MISC_DIST.id },
      { text: "Earth's axial tilt", misconceptionId: null },
      { text: 'Solar flares', misconceptionId: null },
    ],
    correctIndex: 1,
  },
};

export const PUBLIC_MCQ: PublicQuestion = {
  id: 'q1',
  type: 'mcq',
  prompt: MCQ.prompt,
  difficulty: 1,
  timeBudgetSec: 30,
  payload: { options: ['Distance from the Sun', "Earth's axial tilt", 'Solar flares'] },
};

export const NOTEBOOK_TILT = "## Seasons\n- Earth's axial tilt causes the seasons.\n- Water boils at 100 degrees.";
export const NOTEBOOK_WRONG = `## Seasons\n- ${MISC_DIST.beliefStatement}\n- Earth's axial tilt causes the seasons.`;
