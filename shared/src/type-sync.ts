/**
 * Compile-time check that the plain types in `api-client.ts` match the Zod schemas in `schemas.ts`.
 * If `npm run typecheck` fails here, a public shape changed in one file but not the other.
 */
import type * as S from './schemas';
import type * as A from './api-client';

type Mutual<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

export const typeSync: {
  questionType: Mutual<S.QuestionType, A.QuestionType>;
  targetGrade: Mutual<S.TargetGrade, A.TargetGrade>;
  letterGrade: Mutual<S.LetterGrade, A.LetterGrade>;
  runPhase: Mutual<S.RunPhase, A.RunPhase>;
  answer: Mutual<S.Answer, A.Answer>;
  publicQuestion: Mutual<S.PublicQuestion, A.PublicQuestion>;
  results: Mutual<S.Results, A.Results>;
  turnResult: Mutual<S.TurnResult, A.TurnResult>;
  publicRun: Mutual<S.PublicRun, A.PublicRun>;
  publicCourse: Mutual<S.PublicCourse, A.PublicCourse>;
  createRunBody: Mutual<S.CreateRunBody, A.CreateRunBody>;
  teachResponse: Mutual<S.TeachResponse, A.TeachResponse>;
  apiSettings: Mutual<S.ApiSettings, A.ApiSettings>;
  apiSettingsUpdate: Mutual<S.UpdateApiSettingsBody, A.UpdateApiSettingsBody>;
  storageSettings: Mutual<S.StorageSettings, A.StorageSettings>;
  storageSettingsUpdate: Mutual<S.UpdateStorageSettingsBody, A.UpdateStorageSettingsBody>;
  storageSettingsSave: Mutual<S.SaveStorageSettingsResponse, A.SaveStorageSettingsResponse>;
  storageSettingsTest: Mutual<S.TestStorageSettingsResponse, A.TestStorageSettingsResponse>;
} = {
  questionType: true,
  targetGrade: true,
  letterGrade: true,
  runPhase: true,
  answer: true,
  publicQuestion: true,
  results: true,
  turnResult: true,
  publicRun: true,
  publicCourse: true,
  createRunBody: true,
  teachResponse: true,
  apiSettings: true,
  apiSettingsUpdate: true,
  storageSettings: true,
  storageSettingsUpdate: true,
  storageSettingsSave: true,
  storageSettingsTest: true,
};
