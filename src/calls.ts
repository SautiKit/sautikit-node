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
  /**
   * E.164 number the call leaves on — must be a number owned by the
   * workspace. Also what the called party sees, unless `callerId` overrides
   * it.
   */
  from: string;
  /** E.164 destination(s). A bare string is coerced to a one-element array. */
  to: string | string[];
  /**
   * Number to DISPLAY to the called party, when it should differ from `from`.
   *
   * `from` still selects which of your numbers the call leaves on; this only
   * changes what is shown. Useful when you route through one number but want
   * another presented — a main line rather than the trunk that carried it.
   *
   * Must be a number your workspace owns: the platform refuses one it does
   * not, rather than letting a call present an identity you cannot prove.
   */
  callerId?: string;
  /** Per-call voice-flow callback URL. Mutually exclusive with `control: "mcp"`. */
  voiceCallbackUrl?: string;
  /**
   * Sent as the `Idempotency-Key` header (auto-generated when omitted).
   * Reusing a key within the live leg's lifetime replays the original
   * response instead of dialing again.
   */
  idempotencyKey?: string;
  /**
   * Your own correlation handle for this call — an order id, a ticket
   * number, your own uuid — handed straight back so an asynchronous callback
   * can be tied to whatever the call was placed FOR, without keeping a map
   * of Sautikit's identifiers.
   *
   * It becomes the call's `clientRequestId` on the PBX, which echoes that
   * field back verbatim — so it arrives on
   * {@link CreateCallResponse.client_request_id}, as the `clientRequestId`
   * field of every callback and event body (voice callbacks, per-number
   * event forwarding, `call.*` webhook deliveries), and on your voice
   * callback URL as `?clientRequestId=…`. Bodies are forwarded exactly as
   * the PBX sent them; the label is in there because it IS the call's
   * identifier on the box.
   *
   * Use a distinct value per call: the PBX treats `clientRequestId` as an
   * idempotency hint, so a label reused across a campaign risks having those
   * attempts collapsed. Deduplicating your own retries is still
   * {@link idempotencyKey} — which this replaces on the wire when both are
   * sent. Must not begin with `mcp:` or `broadcast:` (reserved for internal
   * routing). Max 5000 characters, no control characters.
   *
   * The PBX refuses a `clientRequestId` containing whitespace, commas,
   * braces or quotes, so a label carrying any of those cannot ride the call:
   * it is still echoed on {@link CreateCallResponse.client_request_id}, but
   * it will NOT appear on callback or event bodies. Send an opaque id (order
   * number, ticket id, uuid) rather than a JSON document.
   */
  clientRequestId?: string;
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
  /**
   * Your {@link CreateCallParams.clientRequestId}, echoed verbatim. Absent
   * when the call was placed without one.
   */
  client_request_id?: string;
}

export interface HangupResponse {
  call_id: string;
  /** Always "hung_up" on success. */
  status: string;
}

/** What a supervisor can do on a live call. */
export type SupervisionMode = "listen" | "whisper" | "barge";

/** Who hears a tone when the supervisor joins and on every mode change. */
export type SupervisionAnnounce = "none" | "agent" | "both";

/** Where the supervisor leg rings. */
export type SupervisorTarget =
  | { type: "client"; identity: string }
  | { type: "sip"; identity: string }
  | { type: "phone"; number: string };

export type SupervisionState = "connecting" | "ringing" | "connected" | "ended" | "failed";

/** A supervision as the API returns it (wire fields stay snake_case). */
export interface CallSupervision {
  supervision_id: string;
  call_id: string;
  session_id: string;
  /** The PBX leg id; `@sautikit/webrtc` matches the incoming leg on it. */
  supervisor_leg_id?: string;
  mode: SupervisionMode;
  announce: SupervisionAnnounce;
  supervisor: { type: "client" | "sip" | "phone"; identity?: string; number?: string; label?: string };
  notify_agent: boolean;
  state: SupervisionState;
  connected_at?: string;
  ended_at?: string;
  created_at: string;
}

export interface SuperviseParams {
  mode: SupervisionMode;
  supervisor: SupervisorTarget;
  /** Defaults to "none" server-side. */
  announce?: SupervisionAnnounce;
  /** The supervisor's name, shown in events and the agent's notice. Max 64 characters. */
  label?: string;
  /** Tell the agent's app a supervisor joined (webrtc `supervision` event). Defaults to true. */
  notifyAgent?: boolean;
  /** Replays with the same key return the same supervision. Generated when omitted. */
  idempotencyKey?: string;
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
  /** Present only when `stats()` was called with a bucket; oldest first, zero-filled. */
  series?: StatsBucket[];
}

/** One slot of `CallStats.series`. completed + missed + failed === total. */
export interface StatsBucket {
  start: string;
  total: number;
  inbound: number;
  outbound: number;
  completed: number;
  missed: number;
  failed: number;
  spend_minor: number;
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
        ...(params.callerId !== undefined ? { caller_id: params.callerId } : {}),
        ...(params.voiceCallbackUrl !== undefined
          ? { voice_callback_url: params.voiceCallbackUrl }
          : {}),
        ...(params.clientRequestId !== undefined
          ? { client_request_id: params.clientRequestId }
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

  /**
   * Fetches one call (GET /v1/calls/{id}). Takes either the Sautikit row
   * UUID or the PBX session id (`HD_…`) the same call carries on the wire.
   */
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
  async stats(
    since?: "today" | "7d" | "month" | string,
    bucket?: "hour" | "day",
  ): Promise<CallStats> {
    return this.http.request<CallStats>("GET", "/v1/calls/stats", {
      query: { since, bucket },
    });
  }

  /**
   * Terminates an active call (POST /v1/calls/{call_id}/hangup). Takes
   * either the Sautikit call row UUID or the PBX session id (`HD_…`).
   * Idempotent: a call that already ended still resolves successfully.
   */
  async hangup(callId: string): Promise<HangupResponse> {
    return this.http.request<HangupResponse>(
      "POST",
      `/v1/calls/${encodeURIComponent(callId)}/hangup`,
    );
  }

  /**
   * Resolves the call's recording (GET /v1/calls/{call_id}/recording).
   * `callId` is either the Sautikit call row UUID or the PBX session id
   * (`HD_…`) the same call carries on the wire.
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

  /**
   * Puts a supervisor on a live call (POST /v1/calls/{call_id}/supervision).
   * Takes the call UUID or its `HD_…` session id. One supervisor per call —
   * a second one is a 409 `calls.supervision_in_progress`. The supervisor leg
   * is billed from answer to leave (KES 0.50/min for a browser or SIP
   * supervisor, the outbound rate for a phone). Needs scope `calls.supervise`.
   */
  async supervise(callId: string, params: SuperviseParams): Promise<CallSupervision> {
    return this.http.request<CallSupervision>(
      "POST",
      `/v1/calls/${encodeURIComponent(callId)}/supervision`,
      {
        headers: { "Idempotency-Key": params.idempotencyKey ?? newIdempotencyKey() },
        body: {
          mode: params.mode,
          supervisor: params.supervisor,
          ...(params.announce !== undefined ? { announce: params.announce } : {}),
          ...(params.label !== undefined ? { label: params.label } : {}),
          ...(params.notifyAgent !== undefined ? { notify_agent: params.notifyAgent } : {}),
        },
      },
    );
  }

  /** Switches listen / whisper / barge (PATCH). 409 while the supervisor is still ringing. */
  async setSupervisionMode(callId: string, mode: SupervisionMode): Promise<CallSupervision> {
    return this.http.request<CallSupervision>(
      "PATCH",
      `/v1/calls/${encodeURIComponent(callId)}/supervision`,
      { body: { mode } },
    );
  }

  /** Removes the supervisor (DELETE). Idempotent. */
  async stopSupervision(callId: string): Promise<void> {
    await this.http.request<undefined>("DELETE", `/v1/calls/${encodeURIComponent(callId)}/supervision`);
  }

  /** The call's active supervision, or null. Needs scope `calls.read`. */
  async getSupervision(callId: string): Promise<CallSupervision | null> {
    const res = await this.http.request<{ supervision: CallSupervision | null }>(
      "GET",
      `/v1/calls/${encodeURIComponent(callId)}/supervision`,
    );
    return res.supervision;
  }
}
