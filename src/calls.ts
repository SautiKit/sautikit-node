// client.calls — outbound calling, call records, and recordings.
//
// Wire shapes mirror docs/openapi.public.yaml (snake_case response fields are
// kept verbatim); request params are camelCase and mapped to the wire here.

import type { HttpClient } from "./http.js";
import { newIdempotencyKey } from "./http.js";
import type { VoiceAction } from "./verbs.js";

// ---- Wire types -------------------------------------------------------------

export interface CallEvent {
  id: string;
  call_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
}

/** A call detail record, as returned by GET /v1/calls and GET /v1/calls/{id}. */
export interface Call {
  id: string;
  workspace_id: string;
  session_id: string | null;
  direction: "inbound" | "outbound";
  local_e164: string;
  remote_e164: string;
  country: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  status: string;
  cost_minor: number;
  cost_currency: string | null;
  rate_per_minute_minor: number | null;
  failure_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  /** PBX lifecycle events, oldest first. Always present (may be empty). */
  events: CallEvent[];
}

export interface CreateCallParams {
  /** E.164 caller-ID — must be a number owned by the workspace. */
  from: string;
  /** E.164 destination(s). A bare string is coerced to a one-element array. */
  to: string | string[];
  /** Per-call voice-flow callback URL. Mutually exclusive with `control: "mcp"`. */
  voiceCallbackUrl?: string;
  /**
   * Sent as the `Idempotency-Key` header (auto-generated when omitted).
   * Reusing a key within the live leg's lifetime replays the original
   * response instead of dialing again.
   */
  idempotencyKey?: string;
  /** Place the call under MCP live call control (control/events + control/respond). */
  control?: "mcp";
  /** Audio played during mcp filler cycles while holding for the controller. */
  holdAudioUrl?: string;
  /** Per-cycle mcp control hold bound in milliseconds (server default 10000). */
  controlTimeoutMs?: number;
  /** Voice actions played after the second consecutive mcp control timeout. */
  fallbackActions?: VoiceAction[];
  /** Voice actions rendered immediately on the answered edge (mcp mode). */
  openingActions?: VoiceAction[];
}

export interface CreateCallResponse {
  /**
   * Sautikit call row UUID — the handle for get()/hangup(). Always present
   * on `control: "mcp"` calls; PBX-derived (and possibly absent) otherwise.
   */
  call_id?: string;
  /** Upstream PBX session identifier (HD_…). */
  session_id?: string;
  /** Initial PBX status string — typically "ringing". */
  status: string;
}

export interface HangupResponse {
  call_id: string;
  /** Always "hung_up" on success. */
  status: string;
}

export interface ListCallsParams {
  /** Comma-separated status filter, e.g. "completed,failed". */
  status?: string;
  direction?: "inbound" | "outbound";
  /** Substring match on remote number or session id. */
  q?: string;
  /** Exact PBX session id match. */
  sessionId?: string;
  /** Window start (RFC3339 or unix seconds). */
  from?: string;
  /** Window end (RFC3339 or unix seconds). */
  to?: string;
  cursor?: string;
  /** 1–100, server default 25. */
  limit?: number;
}

export interface CallListPage {
  data: Call[];
  next_cursor: string | null;
}

export interface CallStats {
  total: number;
  failed: number;
  minutes_total: number;
  spend_minor: number;
  currency: string;
}

/**
 * Result of recording(): either a ready presigned URL (valid ~15 minutes,
 * pass straight to an <audio> tag or fetch it) or a capture-in-progress
 * signal with the server's suggested retry delay.
 */
export type RecordingResult =
  | { status: "ready"; url: string }
  | { status: "pending"; retryAfterSeconds: number };

// ---- Resource ---------------------------------------------------------------

export class CallsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Places an outbound call (POST /v1/calls). Returns before the remote
   * party answers — poll get() or subscribe to call.* webhooks for the
   * terminal state. Correlate on the returned call_id / session_id (they
   * appear on call.completed/call.failed webhook payloads as call_id /
   * pbx_call_id).
   */
  async create(params: CreateCallParams): Promise<CreateCallResponse> {
    const to = Array.isArray(params.to) ? params.to : [params.to];
    return this.http.request<CreateCallResponse>("POST", "/v1/calls", {
      headers: { "Idempotency-Key": params.idempotencyKey ?? newIdempotencyKey() },
      body: {
        from: params.from,
        to,
        ...(params.voiceCallbackUrl !== undefined
          ? { voice_callback_url: params.voiceCallbackUrl }
          : {}),
        ...(params.control !== undefined ? { control: params.control } : {}),
        ...(params.holdAudioUrl !== undefined ? { hold_audio_url: params.holdAudioUrl } : {}),
        ...(params.controlTimeoutMs !== undefined
          ? { control_timeout_ms: params.controlTimeoutMs }
          : {}),
        ...(params.fallbackActions !== undefined
          ? { fallback_actions: params.fallbackActions }
          : {}),
        ...(params.openingActions !== undefined ? { opening_actions: params.openingActions } : {}),
      },
    });
  }

  /** Fetches one call by its Sautikit row UUID (GET /v1/calls/{id}). */
  async get(callId: string): Promise<Call> {
    const res = await this.http.request<{ call: Call }>(
      "GET",
      `/v1/calls/${encodeURIComponent(callId)}`,
    );
    return res.call;
  }

  /** Lists call detail records, most-recent first (GET /v1/calls). */
  async list(params: ListCallsParams = {}): Promise<CallListPage> {
    return this.http.request<CallListPage>("GET", "/v1/calls", {
      query: {
        status: params.status,
        direction: params.direction,
        q: params.q,
        session_id: params.sessionId,
        from: params.from,
        to: params.to,
        cursor: params.cursor,
        limit: params.limit,
      },
    });
  }

  /** Dashboard aggregates (GET /v1/calls/stats). */
  async stats(since?: "today" | "7d" | "month"): Promise<CallStats> {
    return this.http.request<CallStats>("GET", "/v1/calls/stats", {
      query: { since },
    });
  }

  /**
   * Terminates an active call (POST /v1/calls/{call_id}/hangup). Keys on the
   * Sautikit call row UUID, never the PBX session id. Idempotent: a call
   * that already ended still resolves successfully.
   */
  async hangup(callId: string): Promise<HangupResponse> {
    return this.http.request<HangupResponse>(
      "POST",
      `/v1/calls/${encodeURIComponent(callId)}/hangup`,
    );
  }

  /**
   * Resolves the call's recording (GET /v1/calls/{call_id}/recording).
   *
   * - 302 → `{ status: "ready", url }` — a ~15-minute presigned URL.
   * - 202 → `{ status: "pending", retryAfterSeconds }` — capture in progress.
   * - 404/410/other → throws SautikitError (`recording_not_found`,
   *   `recording_unavailable`, …).
   */
  async recording(callId: string): Promise<RecordingResult> {
    const res = await this.http.raw(
      "GET",
      `/v1/calls/${encodeURIComponent(callId)}/recording`,
      { redirect: "manual" },
    );
    if (res.status === 302) {
      const url = res.headers.get("location");
      if (!url) {
        throw new Error("@sautikit/node: recording redirect carried no Location header");
      }
      return { status: "ready", url };
    }
    if (res.status === 202) {
      const body = (await res.json()) as { retry_after_seconds?: number };
      return {
        status: "pending",
        retryAfterSeconds:
          typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : 30,
      };
    }
    return this.http.throwFromResponse(res);
  }
}
