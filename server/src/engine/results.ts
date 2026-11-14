import { TARGET_GRADES, type CostlyMisconception, type LetterGrade, type Results, type Run, type TargetGrade } from '@pips-notebook/shared';
import type { Config } from '../config';
import { conceptTitle, misconceptionById, scopeConceptIds } from './scope';
import type { EngineContext } from './types';

/** The highest grade whose threshold <= pct, else 'F'. */
export function letterFor(pct: number, thresholds: Config['gradeThresholds']): LetterGrade {
  const sorted = [...TARGET_GRADES].sort((a, b) => thresholds[b] - thresholds[a]);
  return sorted.find((g) => pct >= thresholds[g]) ?? 'F';
}

export function metTarget(pct: number, target: TargetGrade, thresholds: Config['gradeThresholds']): boolean {
  return pct >= thresholds[target];
}

/** Results of a finished boss fight (SPEC 2.7, 2.8). */
export function computeResults(run: Run, ctx: EngineContext, config: Config): Results {
  const boss = run.boss;
  if (!boss) throw new Error('computeResults: no boss state');
  const pct = Math.max(0, Math.min(100, Math.round(boss.health)));

  // Outcome per boss question: true when answered right (student or Help me!).
  const outcome = new Map<string, boolean>();
  for (const t of boss.log) {
    if (t.kind === 'student_answer') outcome.set(t.question.id, t.correct);
    if (t.kind === 'help_result') outcome.set(t.question.id, t.correct);
  }
  const bossQuestions = boss.questionIds.map((id) => ctx.questions.find((q) => q.id === id)).filter((q) => !!q);

  const conceptAccuracy = scopeConceptIds(run, ctx.pack).map((conceptId) => {
    const qs = bossQuestions.filter((q) => q.conceptIds.includes(conceptId));
    const correct = qs.filter((q) => outcome.get(q.id) === true).length;
    return {
      conceptId,
      title: conceptTitle(ctx.pack, conceptId),
      correct,
      total: qs.length,
      accuracy: qs.length === 0 ? 0 : correct / qs.length,
    };
  });

  const costly: CostlyMisconception[] = [];
  for (const [questionId, misconceptionId] of Object.entries(boss.targetedMap)) {
    const state = run.hidden.misconceptions.find((s) => s.id === misconceptionId);
    const m = misconceptionById(ctx.pack, misconceptionId);
    const q = ctx.questions.find((x) => x.id === questionId);
    if (!state || state.status !== 'active' || !m || !q) continue;
    if (outcome.get(questionId) !== false) continue;
    costly.push({
      id: m.id,
      conceptId: m.conceptId,
      conceptTitle: conceptTitle(ctx.pack, m.conceptId),
      description: m.description,
      beliefStatement: m.beliefStatement,
      correction: m.correction,
      origin: state.origin,
      questionId,
      questionPrompt: q.prompt,
      materialRef: {
        fileId: m.evidence.fileId,
        fileName: ctx.pack.files.find((f) => f.id === m.evidence.fileId)?.name ?? m.evidence.fileId,
        page: m.evidence.page,
        sectionPath: m.evidence.sectionPath ?? [],
        quote: m.evidence.quote,
      },
    });
  }

  const t = run.helpMeTally;
  return {
    predictedGradePct: pct,
    letter: letterFor(pct, config.gradeThresholds),
    target: run.targetGrade,
    metTarget: metTarget(pct, run.targetGrade, config.gradeThresholds),
    conceptAccuracy,
    helpMe: {
      offered: t.offered,
      correct: t.correct,
      wrong: t.wrong,
      late: t.late,
      avgSolveTimeSec: t.solveTimesSec.length === 0 ? null : t.solveTimesSec.reduce((a, b) => a + b, 0) / t.solveTimesSec.length,
    },
    costlyMisconceptions: costly,
  };
}
