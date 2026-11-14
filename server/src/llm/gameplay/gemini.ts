/** Gemini-backed gameplay tasks: one LLM call per task. */
import { z } from 'zod';
import type { Answer, PublicQuestion } from '@top/shared';
import type { Config } from '../../config';
import { answerFitsQuestion } from '../../core/grading';
import {
  CHECK_RESOLUTION_SYSTEM,
  GRADE_OPEN_SYSTEM,
  STUDENT_ANSWER_SYSTEM,
  STUDENT_REVIEW_SYSTEM,
  buildCheckResolutionPrompt,
  buildGradeOpenPrompt,
  buildStudentAnswerPrompt,
  buildStudentReviewPrompt,
} from '../../prompts/gameplay';
import type { GameplayTasks, LlmClient } from '../types';

const common = {
  dontKnow: z.boolean().describe('true when the notes do not cover the question'),
  reasoning: z.string(),
  citedNotes: z.array(z.string()),
};

/** The output schema for a student answer, by question type. */
export function studentAnswerSchema(type: PublicQuestion['type']): z.ZodObject<z.ZodRawShape> {
  switch (type) {
    case 'mcq':
      return z.object({ ...common, choiceIndex: z.number().int().optional() });
    case 'multi_select':
      return z.object({ ...common, choiceIndexes: z.array(z.number().int()).optional() });
    case 'true_false':
      return z.object({ ...common, value: z.boolean().optional() });
    case 'numeric':
      return z.object({ ...common, value: z.number().optional() });
    case 'short_text':
    case 'free_response':
      return z.object({ ...common, text: z.string().optional() });
    case 'ordering':
      return z.object({ ...common, order: z.array(z.number().int()).optional() });
  }
}

/** Flat model output -> `Answer`. Anything missing or out of range becomes "I don't know". */
export function toAnswer(question: PublicQuestion, raw: Record<string, unknown>): Answer {
  if (raw.dontKnow === true) return { dontKnow: true };
  const answer: Answer = {};
  switch (question.type) {
    case 'mcq':
      answer.choiceIndex = raw.choiceIndex as number | undefined;
      break;
    case 'multi_select':
      answer.choiceIndexes = raw.choiceIndexes as number[] | undefined;
      break;
    case 'true_false':
    case 'numeric':
      answer.value = raw.value as number | boolean | undefined;
      break;
    case 'short_text':
    case 'free_response':
      answer.text = raw.text as string | undefined;
      break;
    case 'ordering':
      answer.order = raw.order as number[] | undefined;
      break;
  }
  return answerFitsQuestion(question, answer) ? answer : { dontKnow: true };
}

const ReviewSchema = z.object({
  notesToAdd: z.array(z.object({ conceptId: z.string(), text: z.string() })),
  statedMisconceptionIds: z.array(z.string()),
  questions: z.array(z.object({ misconceptionId: z.string(), text: z.string() })),
  resolvedMisconceptionIds: z.array(z.string()),
});

const ResolutionSchema = z.object({ resolved: z.boolean(), noteToAdd: z.string(), why: z.string() });

const GradeSchema = z.object({
  correct: z.boolean(),
  misconceptionIds: z.array(z.string()),
  feedback: z.string(),
});

export function createGameplayTasks(llm: LlmClient, _config: Config): GameplayTasks {
  return {
    async studentAnswer(input /* , oracle: ignored on purpose, it is for the mock only */) {
      const schema = studentAnswerSchema(input.question.type);
      const raw = (await llm.generateJson(schema, buildStudentAnswerPrompt(input.notebookMd, input.question), {
        system: STUDENT_ANSWER_SYSTEM,
        temperature: 0.1,
        label: 'studentAnswer',
      })) as Record<string, unknown>;
      const answer = toAnswer(input.question, raw);
      return {
        answer,
        reasoning: String(raw.reasoning ?? ''),
        citedNotes: answer.dontKnow ? [] : ((raw.citedNotes as string[] | undefined) ?? []),
      };
    },

    async studentReview(input) {
      const out = await llm.generateJson(ReviewSchema, buildStudentReviewPrompt(input), {
        system: STUDENT_REVIEW_SYSTEM,
        temperature: 0.4,
        label: 'studentReview',
      });
      const conceptIds = new Set(input.concepts.map((c) => c.id));
      const known = new Set(input.misconceptions.map((m) => m.id));
      const probeable = new Set(input.probeableMisconceptionIds);
      const active = new Set(input.activeMisconceptionIds);
      const usedQuestionIds = new Set<string>();
      const fallbackConcept = input.concepts[0]?.id ?? '';
      const stated = [...new Set(out.statedMisconceptionIds.filter((id) => known.has(id)))];
      return {
        notesToAdd: out.notesToAdd
          .filter((n) => n.text.trim().length > 0)
          .map((n) => ({ conceptId: conceptIds.has(n.conceptId) ? n.conceptId : fallbackConcept, text: n.text.trim() })),
        statedMisconceptionIds: stated,
        questions: out.questions
          .filter((q) => {
            if (!probeable.has(q.misconceptionId) || usedQuestionIds.has(q.misconceptionId) || !q.text.trim()) return false;
            usedQuestionIds.add(q.misconceptionId);
            return true;
          })
          .slice(0, Math.max(0, input.maxQuestions)),
        resolvedMisconceptionIds: [...new Set(out.resolvedMisconceptionIds.filter((id) => active.has(id) && !stated.includes(id)))],
      };
    },

    async checkResolution(input) {
      const out = await llm.generateJson(ResolutionSchema, buildCheckResolutionPrompt(input), {
        system: CHECK_RESOLUTION_SYSTEM,
        temperature: 0.1,
        label: 'checkResolution',
      });
      return { ...out, noteToAdd: out.resolved ? out.noteToAdd : '' };
    },

    async gradeOpen(input) {
      const out = await llm.generateJson(GradeSchema, buildGradeOpenPrompt(input), {
        system: GRADE_OPEN_SYSTEM,
        temperature: 0.1,
        label: 'gradeOpen',
      });
      const candidates = new Set(input.candidateMisconceptions.map((m) => m.id));
      return {
        ...out,
        misconceptionIds: out.correct ? [] : out.misconceptionIds.filter((id) => candidates.has(id)),
      };
    },
  };
}
