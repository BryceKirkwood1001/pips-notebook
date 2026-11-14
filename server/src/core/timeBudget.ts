/**
 * Time budget: how hard a question is, in seconds (SPEC 2.10).
 *
 *   raw           = BASE[type] + promptAndOptionWords / 3 + Σ STEP_SECONDS[step.kind]
 *   timeBudgetSec = clamp(roundTo5(raw × (0.8 + 0.1 × difficulty)), HELP_ME_MIN_SEC, HELP_ME_MAX_SEC)
 *
 * Overrides, in priority order:
 *   1. calibration from play: 5+ observed "Help me!" solves -> clamp(roundTo5(1.5 × median))
 *   2. a time/point budget stated in the material, scaled by relative difficulty
 *   3. the formula above
 *
 * Ingest stores (2) or (3) on the question. (1) is applied when questions are loaded for play.
 */
import type {
  CoursePack,
  Question,
  QuestionStats,
  QuestionType,
  TimeBudgetBreakdown,
  WorkedStep,
} from '@top/shared';

export const TIME_BASE: Record<QuestionType, number> = {
  true_false: 5,
  mcq: 10,
  multi_select: 15,
  numeric: 15,
  short_text: 15,
  ordering: 20,
  free_response: 60,
};

export const STEP_SECONDS: Record<WorkedStep['kind'], number> = {
  recall: 6,
  reason: 12,
  compute: 20,
  write: 25,
};

export const CALIBRATION_MIN_SOLVES = 5;
export const CALIBRATION_FACTOR = 1.5;
/** Difficulty a material time hint is assumed to describe. */
const HINT_BASELINE_DIFFICULTY = 3;

export interface TimeBudgetLimits {
  helpMeMinSec: number;
  helpMeMaxSec: number;
}

/** A per-question budget derived from the material ("50 minutes, 25 questions", "(10 pts)"). */
export interface MaterialTimeHint {
  /** Seconds the material allows for an average question. */
  secondsPerQuestion: number;
}

/** What the formula needs from a question. A full `Question` fits. */
export type TimeBudgetInput = Pick<Question, 'type' | 'prompt' | 'payload' | 'difficulty'> & {
  solution: { workedSteps: WorkedStep[] };
};

export const roundTo5 = (x: number): number => Math.round(x / 5) * 5;

export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Words the player has to read: the prompt plus option texts, ordering items or the true/false statement. */
export function promptAndOptionWords(question: Pick<Question, 'type' | 'prompt' | 'payload'>): number {
  let words = countWords(question.prompt);
  const p = question.payload as {
    options?: { text: string }[];
    items?: string[];
    statement?: string;
  };
  if (Array.isArray(p.options)) words += p.options.reduce((n, o) => n + countWords(o.text), 0);
  if (Array.isArray(p.items)) words += p.items.reduce((n, item) => n + countWords(item), 0);
  if (typeof p.statement === 'string') words += countWords(p.statement);
  return words;
}

/** The SPEC 2.10 formula, or the material hint when one is given. Returns every intermediate value. */
export function computeTimeBudget(
  question: TimeBudgetInput,
  limits: TimeBudgetLimits,
  hint?: MaterialTimeHint | null,
): TimeBudgetBreakdown {
  const base = TIME_BASE[question.type];
  const words = promptAndOptionWords(question);
  const wordSec = words / 3;
  const stepSec = question.solution.workedSteps.reduce((n, s) => n + STEP_SECONDS[s.kind], 0);
  const raw = base + wordSec + stepSec;
  const difficultyFactor = 0.8 + 0.1 * question.difficulty;

  if (hint && hint.secondsPerQuestion > 0) {
    // The material's own budget wins. Harder-than-average questions get proportionally more of it.
    const scaled = hint.secondsPerQuestion * (question.difficulty / HINT_BASELINE_DIFFICULTY);
    return {
      source: 'material_hint',
      base,
      words,
      wordSec,
      stepSec,
      raw,
      difficultyFactor,
      timeBudgetSec: clamp(roundTo5(scaled), limits.helpMeMinSec, limits.helpMeMaxSec),
    };
  }

  return {
    source: 'formula',
    base,
    words,
    wordSec,
    stepSec,
    raw,
    difficultyFactor,
    timeBudgetSec: clamp(roundTo5(raw * difficultyFactor), limits.helpMeMinSec, limits.helpMeMaxSec),
  };
}

export const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** clamp(roundTo5(1.5 × median)) once there are 5 or more observed solves; otherwise null. */
export function calibratedTimeBudget(solveTimesSec: number[], limits: TimeBudgetLimits): number | null {
  if (solveTimesSec.length < CALIBRATION_MIN_SOLVES) return null;
  return clamp(roundTo5(CALIBRATION_FACTOR * median(solveTimesSec)), limits.helpMeMinSec, limits.helpMeMaxSec);
}

/** The budget to use for play: calibrated when there is enough data, otherwise the stored one. */
export function effectiveTimeBudget(
  question: Pick<Question, 'timeBudgetSec'>,
  stats: Pick<QuestionStats, 'helpMeSolveTimesSec'> | undefined,
  limits: TimeBudgetLimits,
): number {
  return calibratedTimeBudget(stats?.helpMeSolveTimesSec ?? [], limits) ?? question.timeBudgetSec;
}

/**
 * The material's time hint for one question, or null when the material states none.
 *   - "(10 pts)" on the source item plus exam totals  -> totalMinutes × 60 × points / totalPoints
 *   - "50 minutes, 25 questions"                      -> totalMinutes × 60 / questionCount
 */
export function materialTimeHintFor(
  question: Pick<Question, 'provenance'>,
  pack: Pick<CoursePack, 'styleProfile' | 'materialItems'>,
): MaterialTimeHint | null {
  const exam = pack.styleProfile.examTimeHint;
  if (!exam) return null;
  const totalSec = exam.totalMinutes * 60;
  const item = question.provenance.materialItemId
    ? pack.materialItems.find((m) => m.id === question.provenance.materialItemId)
    : undefined;
  if (item?.points && exam.totalPoints) {
    return { secondsPerQuestion: (totalSec * item.points) / exam.totalPoints };
  }
  if (exam.questionCount) return { secondsPerQuestion: totalSec / exam.questionCount };
  return null;
}
