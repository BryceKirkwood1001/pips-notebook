/**
 * The one error type that crosses module boundaries. Routes turn it into
 * `{ error: { code, message } }` with `status` as the HTTP code (SPEC 6).
 * Anything else that is thrown becomes a 500 `internal_error`.
 */
export const ERROR_STATUS = {
  /** The request body, params or an answer's shape is invalid. */
  validation_error: 400,
  /** The answer does not fit the question type (e.g. `text` for an mcq). */
  invalid_answer: 400,
  settings_forbidden: 403,
  not_found: 404,
  /** The action is not allowed in the run's current phase. */
  wrong_phase: 409,
  run_paused: 409,
  /** The expedition was ended; it can be viewed or removed but not played. */
  run_ended: 409,
  /** Deleting an actively preparing course would allow background writes to recreate it. */
  course_busy: 409,
  /** The "Help me!" event id is not the pending one (already answered, or never existed). */
  help_event_not_pending: 409,
  /** A learning-phase question that is not open (already answered or skipped). */
  question_not_open: 409,
  /** There is a pending "Help me!" event that must be answered first. */
  help_pending: 409,
  payload_too_large: 413,
  unsupported_file: 415,
  /** The room (or the course's first room) is not ingested yet. Retry shortly. */
  room_not_ready: 425,
  not_implemented: 501,
  /** The LLM failed or timed out after retries. */
  llm_error: 502,
  /** MongoDB could not be reached or used; the storage in use did not change. */
  storage_error: 502,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;
