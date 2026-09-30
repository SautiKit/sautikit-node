import { describe, it, expect } from "vitest";
import { SautikitClient } from "./client.js";
import { SautikitError } from "./error.js";
import type { FetchLike, FetchResponseLike } from "./http.js";
import { say } from "./verbs.js";

// ---- fetch stub -------------------------------------------------------------

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: string;
}

function stubFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (!r) throw new Error("stubFetch: no response configured");
    const headerMap = new Map(
      Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    const res: FetchResponseLike = {
      status: r.status,
      headers: { get: (name) => headerMap.get(name.toLowerCase()) ?? null },
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
    return res;
  };
  return { fetch, calls };
}

function client(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const { fetch, calls } = stubFetch(responses);
  return { client: new SautikitClient({ apiKey: "sk_test", fetch }), calls };
}

// ---- constructor ------------------------------------------------------------

describe("SautikitClient", () => {
  it("throws without an apiKey (and no env fallback)", () => {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    const prev = proc?.env?.SAUTIKIT_API_KEY;
    if (proc?.env) delete proc.env.SAUTIKIT_API_KEY;
    try {
      expect(() => new SautikitClient({ fetch: stubFetch([]).fetch })).toThrow(/missing API key/);
    } finally {
      if (proc?.env && prev !== undefined) proc.env.SAUTIKIT_API_KEY = prev;
    }
  });

  it("falls back to SAUTIKIT_API_KEY from the environment", async () => {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    const prev = proc?.env?.SAUTIKIT_API_KEY;
    if (proc?.env) proc.env.SAUTIKIT_API_KEY = "sk_env";
    try {
      const { fetch, calls } = stubFetch([{ status: 200, body: { data: [], next_cursor: null } }]);
      const c = new SautikitClient({ fetch });
      await c.calls.list();
      expect(calls[0]?.headers?.Authorization).toBe("Bearer sk_env");
    } finally {
      if (proc?.env) {
        if (prev === undefined) delete proc.env.SAUTIKIT_API_KEY;
        else proc.env.SAUTIKIT_API_KEY = prev;
      }
    }
  });

  it("sends bearer auth against the default base URL", async () => {
    const { client: c, calls } = client([{ status: 200, body: { data: [], next_cursor: null } }]);
    await c.calls.list();
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls");
    expect(calls[0]?.headers?.Authorization).toBe("Bearer sk_test");
  });

  it("honours a baseUrl override and strips its trailing slash", async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { data: [], next_cursor: null } }]);
    const c = new SautikitClient({ apiKey: "sk_test", baseUrl: "http://localhost:8090/", fetch });
    await c.calls.list();
    expect(calls[0]?.url).toBe("http://localhost:8090/v1/calls");
  });
});

// ---- calls.create -----------------------------------------------------------

describe("calls.create", () => {
  it("POSTs the wire body and returns the 201 response verbatim", async () => {
    const { client: c, calls } = client([
      { status: 201, body: { call_id: "id-1", session_id: "HD_1", status: "ringing" } },
    ]);
    const res = await c.calls.create({
      from: "+254712345678",
      to: ["+254700000001"],
      voiceCallbackUrl: "https://example.com/voice",
    });
    expect(res).toEqual({ call_id: "id-1", session_id: "HD_1", status: "ringing" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      from: "+254712345678",
      to: ["+254700000001"],
      voice_callback_url: "https://example.com/voice",
    });
  });

  it("sends clientRequestId as client_request_id and echoes it back", async () => {
    const { client: c, calls } = client([
      {
        status: 201,
        body: {
          call_id: "id-1",
          session_id: "HD_1",
          status: "ringing",
          client_request_id: "order-8842",
        },
      },
      { status: 201, body: { status: "ringing" } },
    ]);

    const res = await c.calls.create({
      from: "+254709120800",
      to: "+254700000001",
      clientRequestId: "order-8842",
    });
    expect(JSON.parse(calls[0]?.body ?? "").client_request_id).toBe("order-8842");
    expect(res.client_request_id).toBe("order-8842");

    // It is a label, not an idempotency key — the header is still sent, and
    // still independent of it.
    expect(calls[0]?.headers?.["Idempotency-Key"]).toBeTruthy();
    expect(calls[0]?.headers?.["Idempotency-Key"]).not.toBe("order-8842");

    // Omitted entirely when unset, rather than sent as an empty string.
    await c.calls.create({ from: "+254709120800", to: "+254700000001" });
    expect(JSON.parse(calls[1]?.body ?? "")).not.toHaveProperty("client_request_id");
  });

  it("sends callerId as caller_id, and omits it entirely when unset", async () => {
    const { client: c, calls } = client([
      { status: 201, body: { status: "ringing" } },
      { status: 201, body: { status: "ringing" } },
    ]);
    await c.calls.create({
      from: "+254709120800",
      to: "+254700000001",
      callerId: "+254709120888",
    });
    expect(JSON.parse(calls[0]?.body ?? "").caller_id).toBe("+254709120888");
    // `from` is untouched — it still selects which number the call leaves on.
    expect(JSON.parse(calls[0]?.body ?? "").from).toBe("+254709120800");

    await c.calls.create({ from: "+254709120800", to: "+254700000001" });
    expect(JSON.parse(calls[1]?.body ?? "")).not.toHaveProperty("caller_id");
  });

  it("coerces a bare string `to` into an array", async () => {
    const { client: c, calls } = client([{ status: 201, body: { status: "ringing" } }]);
    await c.calls.create({ from: "+254712345678", to: "+254700000001" });
    expect(JSON.parse(calls[0]?.body ?? "").to).toEqual(["+254700000001"]);
  });

  it("auto-generates an Idempotency-Key and honours an explicit one", async () => {
    const { client: c, calls } = client([
      { status: 201, body: { status: "ringing" } },
      { status: 201, body: { status: "ringing" } },
    ]);
    await c.calls.create({ from: "+1", to: "+2" });
    expect(calls[0]?.headers?.["Idempotency-Key"]).toMatch(/[0-9a-f-]{20,}/i);
    await c.calls.create({ from: "+1", to: "+2", idempotencyKey: "my-key" });
    expect(calls[1]?.headers?.["Idempotency-Key"]).toBe("my-key");
  });

  it("maps mcp control params to their snake_case wire fields", async () => {
    const { client: c, calls } = client([{ status: 201, body: { status: "ringing" } }]);
    await c.calls.create({
      from: "+1",
      to: "+2",
      control: "mcp",
      holdAudioUrl: "https://cdn/hold.mp3",
      controlTimeoutMs: 8000,
      openingActions: [say("Hello")],
    });
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      from: "+1",
      to: ["+2"],
      control: "mcp",
      hold_audio_url: "https://cdn/hold.mp3",
      control_timeout_ms: 8000,
      opening_actions: [{ say: { text: "Hello" } }],
    });
  });

  it("throws a typed SautikitError from the error envelope", async () => {
    const { client: c } = client([
      {
        status: 402,
        body: {
          error: {
            code: "wallet.insufficient_funds",
            message: "Top up to continue.",
            request_id: "req-1",
          },
        },
      },
    ]);
    const err = await c.calls.create({ from: "+1", to: "+2" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SautikitError);
    const se = err as SautikitError;
    expect(se.status).toBe(402);
    expect(se.code).toBe("wallet.insufficient_funds");
    expect(se.message).toBe("Top up to continue.");
    expect(se.requestId).toBe("req-1");
  });
});

// ---- calls reads ------------------------------------------------------------

describe("calls reads", () => {
  it("get() unwraps the { call } envelope", async () => {
    const { client: c, calls } = client([{ status: 200, body: { call: { id: "id-1" } } }]);
    const call = await c.calls.get("id-1");
    expect(call).toEqual({ id: "id-1" });
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls/id-1");
  });

  it("list() maps camelCase params to the wire query", async () => {
    const { client: c, calls } = client([{ status: 200, body: { data: [], next_cursor: null } }]);
    await c.calls.list({ status: "completed,failed", sessionId: "HD_1", limit: 10 });
    expect(calls[0]?.url).toBe(
      "https://api.sautikit.com/v1/calls?status=completed%2Cfailed&session_id=HD_1&limit=10",
    );
  });

  it("stats() passes the window", async () => {
    const { client: c, calls } = client([
      { status: 200, body: { total: 1, failed: 0, minutes_total: 2, spend_minor: 30, currency: "KES" } },
    ]);
    const stats = await c.calls.stats("7d");
    expect(stats.currency).toBe("KES");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls/stats?since=7d");
  });

  it("hangup() POSTs to the hangup path and returns the response", async () => {
    const { client: c, calls } = client([
      { status: 200, body: { call_id: "id-1", status: "hung_up" } },
    ]);
    const res = await c.calls.hangup("id-1");
    expect(res).toEqual({ call_id: "id-1", status: "hung_up" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls/id-1/hangup");
  });
});

// ---- calls.recording --------------------------------------------------------

describe("calls.recording", () => {
  it("resolves ready with the presigned URL from a 302", async () => {
    const { client: c, calls } = client([
      { status: 302, headers: { Location: "https://recordings.sautikit.com/x.wav?sig=1" } },
    ]);
    const res = await c.calls.recording("id-1");
    expect(res).toEqual({ status: "ready", url: "https://recordings.sautikit.com/x.wav?sig=1" });
    expect(calls[0]?.redirect).toBe("manual");
  });

  it("resolves pending with the server's retry delay from a 202", async () => {
    const { client: c } = client([
      { status: 202, body: { status: "pending", retry_after_seconds: 10 } },
    ]);
    expect(await c.calls.recording("id-1")).toEqual({ status: "pending", retryAfterSeconds: 10 });
  });

  it("throws a typed error on a bare-shape 410 body", async () => {
    const { client: c } = client([
      { status: 410, body: { code: "recording_unavailable", reason: "pbx_deleted_before_capture" } },
    ]);
    const err = (await c.calls.recording("id-1").catch((e: unknown) => e)) as SautikitError;
    expect(err).toBeInstanceOf(SautikitError);
    expect(err.status).toBe(410);
    expect(err.code).toBe("recording_unavailable");
    expect(err.message).toBe("pbx_deleted_before_capture");
  });
});

// ---- webrtc.mintToken -------------------------------------------------------

describe("webrtc.mintToken", () => {
  it("always sends a JSON body ({} at minimum)", async () => {
    const { client: c, calls } = client([{ status: 200, body: { token: "jwt" } }]);
    await c.webrtc.mintToken();
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/webrtc/token");
    expect(calls[0]?.body).toBe("{}");
    expect(calls[0]?.headers?.["Content-Type"]).toBe("application/json");
  });

  it("maps params to snake_case and returns the passthrough token", async () => {
    const token = {
      token: "jwt",
      endpoint: "wss://webrtc.helloduty.com",
      protocol: "wss",
      expiresIn: 900,
      turnServer: { iceServers: [] },
    };
    const { client: c, calls } = client([{ status: 200, body: token }]);
    const res = await c.webrtc.mintToken({
      clientName: "agent-42",
      role: "dialer",
      phoneNumber: "+254709221535",
    });
    expect(res).toEqual(token);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      client_name: "agent-42",
      role: "dialer",
      phone_number: "+254709221535",
    });
  });

  it("surfaces the DID-provisioning 409 as a typed error", async () => {
    const { client: c } = client([
      {
        status: 409,
        body: {
          error: { code: "webrtc.token.profile_pending", message: "retry shortly", request_id: "r" },
        },
      },
    ]);
    const err = (await c.webrtc.mintToken().catch((e: unknown) => e)) as SautikitError;
    expect(err.code).toBe("webrtc.token.profile_pending");
    expect(err.status).toBe(409);
  });
});

describe("calls supervision", () => {
  const sup = {
    supervision_id: "3f7c0f5e-0000-4000-8000-000000000001",
    call_id: "6f9a1f5e-0000-4000-8000-000000000001",
    session_id: "HD_24d73b4518bc",
    supervisor_leg_id: "sv_1",
    mode: "listen",
    announce: "none",
    supervisor: { type: "client", identity: "mary", label: "Mary" },
    notify_agent: true,
    state: "connecting",
    created_at: "2026-09-28T10:00:00Z",
  };

  it("supervise() POSTs mode, supervisor, label with an Idempotency-Key", async () => {
    const { client: c, calls } = client([{ status: 201, body: sup }]);
    const res = await c.calls.supervise("HD_24d73b4518bc", {
      mode: "listen",
      supervisor: { type: "client", identity: "mary" },
      label: "Mary",
    });
    expect(res).toEqual(sup);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls/HD_24d73b4518bc/supervision");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      mode: "listen",
      supervisor: { type: "client", identity: "mary" },
      label: "Mary",
    });
    expect(calls[0]?.headers?.["Idempotency-Key"]).toBeTruthy();
  });

  it("supervise() sends announce, notify_agent and a caller-chosen idempotencyKey", async () => {
    const { client: c, calls } = client([{ status: 201, body: sup }]);
    await c.calls.supervise("id-1", {
      mode: "barge",
      supervisor: { type: "phone", number: "+254711000222" },
      announce: "both",
      notifyAgent: false,
      idempotencyKey: "k-1",
    });
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      mode: "barge",
      supervisor: { type: "phone", number: "+254711000222" },
      announce: "both",
      notify_agent: false,
    });
    expect(calls[0]?.headers?.["Idempotency-Key"]).toBe("k-1");
  });

  it("supervise() surfaces 409 supervision_in_progress as a SautikitError", async () => {
    const { client: c } = client([
      {
        status: 409,
        body: { error: { code: "calls.supervision_in_progress", message: "Mary is already supervising", request_id: "r1" } },
      },
    ]);
    const err = await c.calls
      .supervise("id-1", { mode: "listen", supervisor: { type: "client", identity: "john" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SautikitError);
    expect((err as SautikitError).status).toBe(409);
    expect((err as SautikitError).code).toBe("calls.supervision_in_progress");
  });

  it("setSupervisionMode() PATCHes the mode", async () => {
    const { client: c, calls } = client([{ status: 200, body: { ...sup, mode: "whisper", state: "connected" } }]);
    const res = await c.calls.setSupervisionMode("id-1", "whisper");
    expect(res.mode).toBe("whisper");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls/id-1/supervision");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ mode: "whisper" });
  });

  it("stopSupervision() DELETEs and resolves on 204", async () => {
    const { client: c, calls } = client([{ status: 204 }]);
    await expect(c.calls.stopSupervision("id-1")).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("getSupervision() unwraps the envelope and returns null when none", async () => {
    const { client: c } = client([{ status: 200, body: { supervision: sup } }, { status: 200, body: { supervision: null } }]);
    expect(await c.calls.getSupervision("id-1")).toEqual(sup);
    expect(await c.calls.getSupervision("id-1")).toBeNull();
  });

  it("encodes the call id", async () => {
    const { client: c, calls } = client([{ status: 204 }]);
    await c.calls.stopSupervision("a/b");
    expect(calls[0]?.url).toBe("https://api.sautikit.com/v1/calls/a%2Fb/supervision");
  });
});
