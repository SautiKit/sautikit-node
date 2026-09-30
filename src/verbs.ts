// Voice-action verb builders for @sautikit/node.
//
// Hand-authored (per docs/sdk/open-questions.md Decision Log, 2026-07-02) rather
// than generated, so the JSON verb schema's constraints become TYPE errors, not
// runtime surprises. Source of truth for the shapes is
// docs/voice-actions.schema.json (which mirrors internal/voiceflow/schema.go).
//
// JSON only: there is no toXML(). XML is unvalidated passthrough at the runtime,
// so the SDK does not emit it (Decision Q2.3).

/** Max verbs per response — MaxActionSteps in the runtime. */
export const MAX_ACTIONS = 50;

export interface SayParams {
  text: string;
  voice?: string;
  /** IETF BCP-47 tag, e.g. "en-KE". */
  language?: string;
  /** Repeat count; 0 means once. */
  loop?: number;
}

export interface PlayParams {
  /** Audio URL on the workspace CDN allow-list. */
  url: string;
  loop?: number;
}

export interface GetDigitsParams {
  /** Seconds to wait after the prompt; 0 = PBX default. */
  timeout?: number;
  /** Exact digit count; 0 = unlimited. */
  numDigits?: number;
  /** Key that submits early; defaults to "#". */
  finishOnKey?: string;
}

interface DialCommon {
  callerId?: string;
  timeout?: number;
  /** e.g. "record-from-answer". */
  record?: string;
}
/**
 * Exactly one of `number`, `numbers`, or `sip` (schema oneOf /
 * ErrDialTargetXOR — "exactly one of number, numbers, or sip must be set").
 *
 * `numbers` is the fan-out list: the runtime renders it into the `<Dial>`
 * verb's `phoneNumbers` attribute and the PBX tries the destinations per its
 * own contract. Setting both `number` and `numbers` is rejected by the
 * runtime (ErrDialNumberNumbers), so the union makes that unrepresentable.
 */
export type DialParams =
  | (DialCommon & { number: string; numbers?: never; sip?: never })
  | (DialCommon & { numbers: string[]; number?: never; sip?: never })
  | (DialCommon & { sip: string; number?: never; numbers?: never });

export interface ConferenceParams {
  name: string;
  flags?: string;
  maxParticipants?: number;
  record?: boolean;
  beep?: boolean;
  muted?: boolean;
  startOnEnter?: boolean;
  endOnExit?: boolean;
  waitUrl?: string;
  statusEventsCallbackUrl?: string;
  statusEvents?: string;
  collectDigits?: boolean;
  finishOnKey?: string;
  numDigits?: number;
  digitsCallbackUrl?: string;
}

export interface RecordParams {
  action?: string;
  method?: "GET" | "POST";
  timeout?: number;
  maxLength?: number;
  finishOnKey?: string;
  transcribe?: boolean;
  transcribeCallback?: string;
}

export interface RedirectParams {
  url: string;
  method?: "GET" | "POST";
}

export interface RejectParams {
  reason?: "rejected" | "busy";
}

/**
 * Fork live call audio to your WebSocket for real-time voice AI (STT → LLM → TTS).
 *
 * AHEAD OF THE RUNTIME: `<Stream>` ships today as XML only. Native JSON `stream`
 * is on the roadmap and is NOT yet accepted by the runtime schema
 * (internal/voiceflow/schema.go / docs/voice-actions.schema.json), so this shape
 * is not generated from it.
 *
 * As of 2026-08-23 the JSON DSL carries `stream` natively — the runtime parses
 * it and the published schema documents it — so this builder's output is
 * accepted directly. The older note here told you to return raw `<Stream>` XML
 * instead; that is no longer necessary.
 */
export interface StreamParams {
  /** WebSocket endpoint (wss:// or ws://). Your server must advertise the `audio.drachtio.org` subprotocol. */
  url: string;
  /** Which leg(s) to fork to the socket. Omit for the platform default. */
  track?: "inbound_track" | "outbound_track" | "both_tracks";
  /**
   * Required whenever <Stream> drives the call: true tells the platform to
   * answer and hold the call leg for the fork's lifetime (XML wire form
   * connect="true"). Without it the fork is fire-and-forget on a document that
   * ends immediately — the call hangs up within about a second.
   */
  connect?: boolean;
  /** PCM rate delivered TO your socket — 8000 (PSTN) or 16000 (AI). Frames are 16-bit little-endian signed PCM. Omit for the platform default. The rate you send audio back at is declared by `bidirectionalSamplingRate`, not this. */
  outputSamplingRate?: 8000 | 16000;
  /**
   * Sample rate in Hz your WebSocket server RETURNS audio at (raw S16LE binary
   * PCM frames); the platform resamples it to the channel codec. Set it
   * whenever you play audio back into the call — without it, bidirectional
   * playback behavior is undefined.
   */
  bidirectionalSamplingRate?: number;
  /** Friendly label echoed back in status events. */
  name?: string;
  /** Informational hint about the source sample rate. */
  inputSamplingRate?: number;
  /**
   * A flat JSON object, SERIALISED AS A STRING — e.g.
   * `JSON.stringify({ tenant: "acme" })`. Auth tokens, tenant or correlation
   * IDs. Delivered in the FIRST WebSocket TEXT frame as that frame's `headers`
   * field — NOT sent as HTTP headers on the WebSocket handshake, despite the
   * name.
   *
   * This was typed `Record<string, string>` until 2026-08-23, which did not
   * match the wire: the runtime field is a string, so an object here
   * serialised to `"headerMetadata": {...}` and failed schema validation.
   */
  headerMetadata?: string;
  /** Opaque UTF-8 delivered in the first WebSocket text frame after connect. */
  openMetadata?: string;
  /** URL the runtime POSTs stream status events to. */
  statusCallback?: string;
  /** Space-separated event list, e.g. "stream-started stream-stopped stream-error". */
  statusEvents?: string;
}

/** Ring a destination pool. Mirrors the number-level forward target. */
export interface AIAgentForward {
  /** E.164 numbers, `client:<username>` identities, or 4-digit extensions. */
  destinations: string[];
  /** Ring destinations one at a time rather than together. */
  sequential?: boolean;
  /** Hang up the other legs once one answers. */
  firstAnswerWins?: boolean;
  /** Seconds per attempt. Omit for the platform default. */
  ringTimeout?: number;
  /** Override the caller ID presented to the destination. */
  callerId?: string;
  /** Taken when no destination answers — this is where "ring the team, else take a message" lives. */
  voicemail?: AIAgentVoicemail;
}

/** Take a message. Mirrors the number-level voicemail config. */
export interface AIAgentVoicemail {
  /** Spoken before the beep. */
  greetingText?: string;
  /** A Sautikit-hosted recording played instead of `greetingText`. */
  greetingPlayUrl?: string;
  /** TTS voice for `greetingText`. */
  greetingVoice?: "man" | "woman";
  /** Cap the recording in seconds. Omit for the platform default. */
  maxLength?: number;
  /** Play a tone before recording starts. */
  beep?: boolean;
}

/**
 * Where control goes when the agent hands the caller back.
 *
 * EXACTLY ONE target — the union below makes that a type error rather than a
 * runtime one. Number-level routing resolves a multi-target config by silent
 * precedence, but a verb naming both `forward` and `voicemail` reads as "ring
 * the team, else take a message" while actually discarding one, so the runtime
 * refuses it. For that behaviour, nest it: `forward.voicemail`.
 */
export type AIAgentHandover =
  | { callbackUrl: string; forward?: never; voicemail?: never }
  | { forward: AIAgentForward; callbackUrl?: never; voicemail?: never }
  | { voicemail: AIAgentVoicemail; callbackUrl?: never; forward?: never };

/**
 * Hand the answered leg to a Sautikit AI agent.
 *
 * Sautikit-native: the platform expands it server-side into a `stream` fork
 * within the same response, so there is no XML form. A prologue of say/play
 * may precede it, and it must be the LAST action — nothing can run once the
 * leg is forked.
 */
export interface AIAgentParams {
  /** Workspace-scoped agent UUID. There is no name form: agent names are not unique. */
  agentId: string;
  /** Pin a published revision. Omit to run the agent's current one. */
  revision?: number;
  /** Named values merged into the agent's prompt template at staging time. */
  variables?: Record<string, string>;
  /** Where the caller goes when the agent hands back. Omit to fall back to the number's own configuration. */
  handover?: AIAgentHandover;
  /** Taken when the agent cannot be reached at all (no published revision, no free seat, staging failure). Defaults to "hangup". */
  onUnavailable?: "hangup" | "voicemail" | "forward" | "callback";
  /** Target for `onUnavailable: "voicemail"`. */
  voicemail?: AIAgentVoicemail;
  /** Target for `onUnavailable: "forward"`. */
  forward?: AIAgentForward;
}

// Single-key action objects (the discriminated union: exactly one verb per item).
export type SayAction = { say: SayParams };
export type PlayAction = { play: PlayParams };
export type GetDigitsAction = { getDigits: GetDigitsParams & { nested?: NestedAction[] } };
export type DialAction = { dial: DialParams };
export type ConferenceAction = { conference: ConferenceParams };
export type RecordAction = { record: RecordParams };
export type RedirectAction = { redirect: RedirectParams };
export type RejectAction = { reject: RejectParams };
export type HangupAction = { hangup: Record<string, never> };
export type StreamAction = { stream: StreamParams };
export type AIAgentAction = { aiAgent: AIAgentParams };

/** Only Say and Play are legal inside getDigits.nested (ErrGetDigitsNested). */
export type NestedAction = SayAction | PlayAction;

export type VoiceAction =
  | SayAction
  | PlayAction
  | GetDigitsAction
  | DialAction
  | ConferenceAction
  | RecordAction
  | RedirectAction
  | RejectAction
  | HangupAction
  | StreamAction
  | AIAgentAction;

export interface VoiceResponse {
  actions: VoiceAction[];
}

// ── Builders ──────────────────────────────────────────────────────────────

export function say(text: string, opts: Omit<SayParams, "text"> = {}): SayAction {
  return { say: { text, ...opts } };
}

export function play(url: string, opts: Omit<PlayParams, "url"> = {}): PlayAction {
  return { play: { url, ...opts } };
}

/**
 * Collect DTMF. `nested` accepts only say()/play() results — passing any other
 * verb is a compile error, matching the runtime's ErrGetDigitsNested.
 */
export function getDigits(
  opts: GetDigitsParams = {},
  nested?: NestedAction[],
): GetDigitsAction {
  return { getDigits: nested && nested.length ? { ...opts, nested } : { ...opts } };
}

/** Connect the caller. The `number`/`sip` XOR is enforced by DialParams. */
export function dial(opts: DialParams): DialAction {
  return { dial: opts };
}

export function conference(name: string, opts: Omit<ConferenceParams, "name"> = {}): ConferenceAction {
  return { conference: { name, ...opts } };
}

export function record(opts: RecordParams = {}): RecordAction {
  return { record: opts };
}

export function redirect(url: string, opts: Omit<RedirectParams, "url"> = {}): RedirectAction {
  return { redirect: { url, ...opts } };
}

export function reject(reason?: RejectParams["reason"]): RejectAction {
  return { reject: reason ? { reason } : {} };
}

export function hangup(): HangupAction {
  return { hangup: {} };
}

/**
 * Fork live call audio to your WebSocket for real-time voice AI. Bridge the PCM
 * to your own model (Gemini Live, OpenAI, self-hosted) and stream the reply back.
 *
 * Set `connect: true` unless you have a specific reason not to — without it
 * the fork is fire-and-forget on a document that ends immediately, and the
 * call drops after about a second.
 */
export function stream(opts: StreamParams): StreamAction {
  return { stream: opts };
}

/**
 * Hand the answered leg to a Sautikit AI agent.
 *
 * Must be the last action in the response — see AIAgentParams. `voiceResponse`
 * enforces that at runtime for JS callers.
 */
export function aiAgent(
  agentId: string,
  opts: Omit<AIAgentParams, "agentId"> = {},
): AIAgentAction {
  return { aiAgent: { agentId, ...opts } };
}

/**
 * Assemble the response envelope your voice webhook returns. Validates the
 * runtime invariants a JS caller could still trip (types cover TS callers):
 * the 50-verb cap and the nested say/play restriction.
 */
export function voiceResponse(actions: VoiceAction[]): VoiceResponse {
  if (actions.length > MAX_ACTIONS) {
    throw new RangeError(
      `voiceResponse: ${actions.length} actions exceeds the ${MAX_ACTIONS}-verb limit`,
    );
  }
  for (const [i, action] of actions.entries()) {
    if ("aiAgent" in action && i !== actions.length - 1) {
      throw new TypeError(
        "aiAgent must be the last action — nothing can run once the leg is forked",
      );
    }
    if ("getDigits" in action) {
      for (const n of action.getDigits.nested ?? []) {
        if (!("say" in n) && !("play" in n)) {
          throw new TypeError("getDigits.nested accepts only say() or play() verbs");
        }
      }
    }
  }
  return { actions };
}
