// Server-side diagnostics for the report submission path.
//
// A production 500 must name the step that failed, because the API response is
// deliberately sanitized. Driver errors carry the fields that name the failing
// SQL (pg sets code, detail, constraint, table, column, schema, routine), so
// they are captured verbatim. Nothing here is ever sent to a client.

const LOGGED_STEP = Symbol.for("civicsignal.stepLogged");

/** Facts accumulated across the steps of one submission. */
export type StepTrace = {
  route: string;
  userId: string | null;
  reportId?: string;
  referenceCode?: string;
  /** Last step that finished, so a driver-level failure has surrounding context. */
  lastCompletedStep?: string;
  /** Step-specific facts (photo size/type, category, assignee, ...). */
  fields: Record<string, unknown>;
};

const DATABASE_ERROR_FIELDS = [
  "code",
  "detail",
  "hint",
  "constraint",
  "table",
  "schema",
  "column",
  "severity",
  "routine",
  "position",
  "where",
] as const;

function describeCause(cause: unknown): unknown {
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  if (typeof cause === "string") return cause;
  return cause === undefined ? undefined : String(cause);
}

/**
 * Flattens an error into log-friendly fields. A database error keeps its own
 * `code`/`detail`/`constraint`; an ApiError keeps its application code under
 * `apiCode` so the two are never confused in a log line.
 */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error), thrownValue: typeof error };
  }
  const described: Record<string, unknown> = { name: error.name, message: error.message };
  const candidate = error as Error & Record<string, unknown> & {
    status?: unknown;
    fieldErrors?: unknown;
  };
  const isApiError = typeof candidate.status === "number";
  if (isApiError) {
    described.status = candidate.status;
    if (typeof candidate.code === "string") described.apiCode = candidate.code;
    if (candidate.fieldErrors !== undefined) described.fieldErrors = candidate.fieldErrors;
  }
  for (const field of DATABASE_ERROR_FIELDS) {
    if (isApiError && field === "code") continue;
    const value = candidate[field];
    if (value !== undefined && value !== null) described[field] = value;
  }
  if (error.stack) described.stack = error.stack;
  if (candidate.cause !== undefined) described.cause = describeCause(candidate.cause);
  return described;
}

export function createStepTrace(input: {
  route: string;
  userId: string | null;
  fields?: Record<string, unknown>;
}): StepTrace {
  return { route: input.route, userId: input.userId, fields: { ...input.fields } };
}

/** Client errors (validation, authorization) are expected outcomes, not incidents. */
function isClientError(error: unknown): boolean {
  if (error instanceof Error && error.name === "ZodError") return true;
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

function logStepFailure(trace: StepTrace, step: string, error: unknown, durationMs: number): void {
  if (isClientError(error)) return;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<symbol, unknown>;
    // Only the innermost step logs, so one line names the precise failing step.
    if (record[LOGGED_STEP]) return;
    try {
      record[LOGGED_STEP] = true;
    } catch {
      // A frozen error object cannot be marked; a duplicate line is harmless.
    }
  }
  console.error("[reports] report submission failed", {
    route: trace.route,
    step,
    lastCompletedStep: trace.lastCompletedStep ?? null,
    durationMs,
    userId: trace.userId,
    reportId: trace.reportId ?? null,
    referenceCode: trace.referenceCode ?? null,
    ...trace.fields,
    error: describeError(error),
  });
}

/**
 * Runs one named step of a submission. A failure is logged once, with the step
 * name and the driver's error fields, and then rethrown unchanged so status
 * mapping and transaction rollback behave exactly as before.
 */
export async function runStep<T>(
  trace: StepTrace,
  step: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await operation();
    trace.lastCompletedStep = step;
    return value;
  } catch (error) {
    logStepFailure(trace, step, error, Date.now() - startedAt);
    throw error;
  }
}
