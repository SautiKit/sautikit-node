// Fluent, chainable verb builder for @sautikit/node.
//
//   res.json(sauti.say("Hi").getDigits({ numDigits: 1 }).hangup());
//
// Each method appends a verb and returns `this`, so calls chain. It wraps the
// functional builders in ./verbs, so the schema constraints still hold (dial
// number|sip XOR at the type level; the 50-verb cap and getDigits.nested =
// say/play rule enforced by voiceResponse() when the chain is serialized).
//
// toJSON() returns the validated envelope, which means you can hand a chain
// straight to a JSON responder — Express's res.json() and JSON.stringify() call
// toJSON() for you, so no explicit .build() is needed.
import {
  aiAgent,
  conference,
  dial,
  getDigits,
  hangup,
  play,
  record,
  redirect,
  reject,
  say,
  stream,
  voiceResponse,
} from "./verbs.js";
import type {
  AIAgentParams,
  ConferenceParams,
  DialParams,
  GetDigitsParams,
  NestedAction,
  PlayParams,
  StreamParams,
  RecordParams,
  RedirectParams,
  RejectParams,
  SayParams,
  VoiceAction,
  VoiceResponse,
} from "./verbs.js";

/**
 * Builds the prompt verbs played while `getDigits` waits. Only `say` and `play`
 * are exposed — the schema forbids anything else inside `getDigits.nested`
 * (ErrGetDigitsNested), so the restriction is enforced by what you can call.
 */
export class NestedBuilder {
  private readonly items: NestedAction[] = [];

  say(text: string, opts?: Omit<SayParams, "text">): this {
    this.items.push(say(text, opts));
    return this;
  }

  play(url: string, opts?: Omit<PlayParams, "url">): this {
    this.items.push(play(url, opts));
    return this;
  }

  /** @internal */
  collect(): NestedAction[] {
    return this.items;
  }
}

/** `getDigits` nested prompt: an array of say/play verbs, or a fluent callback. */
export type NestedInput = NestedAction[] | ((b: NestedBuilder) => void);

function resolveNested(nested?: NestedInput): NestedAction[] | undefined {
  if (!nested) return undefined;
  if (typeof nested === "function") {
    const b = new NestedBuilder();
    nested(b);
    return b.collect();
  }
  return nested;
}

export class VoiceBuilder {
  private readonly steps: VoiceAction[] = [];

  say(text: string, opts?: Omit<SayParams, "text">): this {
    this.steps.push(say(text, opts));
    return this;
  }

  play(url: string, opts?: Omit<PlayParams, "url">): this {
    this.steps.push(play(url, opts));
    return this;
  }

  getDigits(opts?: GetDigitsParams, nested?: NestedInput): this {
    this.steps.push(getDigits(opts, resolveNested(nested)));
    return this;
  }

  dial(opts: DialParams): this {
    this.steps.push(dial(opts));
    return this;
  }

  conference(name: string, opts?: Omit<ConferenceParams, "name">): this {
    this.steps.push(conference(name, opts));
    return this;
  }

  record(opts?: RecordParams): this {
    this.steps.push(record(opts));
    return this;
  }

  redirect(url: string, opts?: Omit<RedirectParams, "url">): this {
    this.steps.push(redirect(url, opts));
    return this;
  }

  reject(reason?: RejectParams["reason"]): this {
    this.steps.push(reject(reason));
    return this;
  }

  hangup(): this {
    this.steps.push(hangup());
    return this;
  }

  /** Fork call audio to your WebSocket while the call continues. */
  stream(opts: StreamParams): this {
    this.steps.push(stream(opts));
    return this;
  }

  /**
   * Hand the answered call to one of your AI agents.
   *
   * Terminal: nothing after it runs, because the leg is forked to the agent.
   * A `.say()` / `.play()` prologue before it is fine and is the usual shape.
   */
  aiAgent(agentId: string, opts?: Omit<AIAgentParams, "agentId">): this {
    this.steps.push(aiAgent(agentId, opts));
    return this;
  }

  /** The validated `{ actions }` envelope. Throws on >50 verbs or an illegal nested verb. */
  build(): VoiceResponse {
    return voiceResponse(this.steps);
  }

  /** Lets `res.json(builder)` / `JSON.stringify(builder)` emit the envelope directly. */
  toJSON(): VoiceResponse {
    return this.build();
  }
}

/** Start an empty chain: `voice().say("Hi").hangup()`. Handy for conditional flows. */
export function voice(): VoiceBuilder {
  return new VoiceBuilder();
}

/**
 * Chain-starter. Every verb on `sauti` begins a FRESH chain, so it holds no
 * state between requests: `sauti.say("Hi").getDigits({ numDigits: 1 }).hangup()`.
 */
export const sauti = {
  say: (text: string, opts?: Omit<SayParams, "text">) => new VoiceBuilder().say(text, opts),
  play: (url: string, opts?: Omit<PlayParams, "url">) => new VoiceBuilder().play(url, opts),
  getDigits: (opts?: GetDigitsParams, nested?: NestedInput) =>
    new VoiceBuilder().getDigits(opts, nested),
  dial: (opts: DialParams) => new VoiceBuilder().dial(opts),
  conference: (name: string, opts?: Omit<ConferenceParams, "name">) =>
    new VoiceBuilder().conference(name, opts),
  record: (opts?: RecordParams) => new VoiceBuilder().record(opts),
  redirect: (url: string, opts?: Omit<RedirectParams, "url">) =>
    new VoiceBuilder().redirect(url, opts),
  reject: (reason?: RejectParams["reason"]) => new VoiceBuilder().reject(reason),
  hangup: () => new VoiceBuilder().hangup(),
};
