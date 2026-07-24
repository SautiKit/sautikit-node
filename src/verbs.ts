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
 * is not generated from it. This builder emits the JSON the runtime will accept
 * once JSON stream lands; until then, return the XML `<Stream>` form from your
 * webhook. Tracked in docs/sdk/open-questions.md.
 */
export interface StreamParams {
  /** WebSocket endpoint (wss:// or ws://). Your server must advertise the `audio.drachtio.org` subprotocol. */
  url: string;
  /** Which leg(s) to fork to the socket. */
  track: "inbound_track" | "outbound_track" | "both_tracks";
  /** PCM rate sent and expected back — 8000 (PSTN) or 16000 (AI). Frames are 16-bit little-endian signed PCM. */
  outputSamplingRate: 8000 | 16000;
  /** Friendly label echoed back in status events. */
  name?: string;
  /** Informational hint about the source sample rate. */
  inputSamplingRate?: number;
  /** Flat key/value pairs sent as HTTP headers on the WebSocket handshake (e.g. auth tokens, tenant IDs). */
  headerMetadata?: Record<string, string>;
  /** Opaque UTF-8 delivered in the first WebSocket text frame after connect. */
  openMetadata?: string;
  /** URL the runtime POSTs stream status events to. */
  statusCallback?: string;
  /** Space-separated event list, e.g. "stream-started stream-stopped stream-error". */
  statusEvents?: string;
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
  | StreamAction;

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
 * Emits JSON ahead of runtime support — see StreamParams. Return the XML
 * `<Stream>` form from your webhook until native JSON stream ships.
 */
export function stream(opts: StreamParams): StreamAction {
  return { stream: opts };
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
  for (const action of actions) {
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
