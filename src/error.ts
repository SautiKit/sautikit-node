// Typed error surface for @sautikit/node (decision Q4.3).
//
// Every non-2xx API response throws a SautikitError carrying the HTTP status
// and the fields of the Go error envelope `{ error: { code, message,
// request_id } }`. A few endpoints write bare `{ code, reason }` bodies
// (e.g. the recording proxy's terminal states) — both shapes are parsed.

export class SautikitError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** Machine-readable error code, e.g. `wallet.insufficient_funds`. */
  readonly code: string;
  /** Server request id for support/log correlation, when present. */
  readonly requestId?: string;
  /** Raw parsed response body, for codes that carry extra fields. */
  readonly body?: unknown;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    body?: unknown;
  }) {
    super(args.message);
    this.name = "SautikitError";
    this.status = args.status;
    this.code = args.code;
    if (args.requestId !== undefined) this.requestId = args.requestId;
    if (args.body !== undefined) this.body = args.body;
  }
}

/** Builds a SautikitError from a failed response body (either envelope shape). */
export function errorFromBody(status: number, body: unknown): SautikitError {
  if (typeof body === "object" && body !== null) {
    const rec = body as Record<string, unknown>;
    const env =
      typeof rec.error === "object" && rec.error !== null
        ? (rec.error as Record<string, unknown>)
        : rec;
    const code = typeof env.code === "string" ? env.code : `http_${status}`;
    const message =
      typeof env.message === "string"
        ? env.message
        : typeof env.reason === "string"
          ? env.reason
          : `request failed with status ${status}`;
    const requestId = typeof env.request_id === "string" ? env.request_id : undefined;
    return new SautikitError({
      status,
      code,
      message,
      ...(requestId !== undefined ? { requestId } : {}),
      body,
    });
  }
  return new SautikitError({
    status,
    code: `http_${status}`,
    message: `request failed with status ${status}`,
    body,
  });
}
