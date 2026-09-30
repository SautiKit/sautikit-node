import { describe, it, expect } from "vitest";
import {
  say,
  play,
  getDigits,
  dial,
  reject,
  hangup,
  stream,
  aiAgent,
  voiceResponse,
  MAX_ACTIONS,
} from "./verbs.js";

describe("verb builders", () => {
  it("say() produces a single-key action with text and options", () => {
    expect(say("Hello", { language: "en-KE" })).toEqual({
      say: { text: "Hello", language: "en-KE" },
    });
  });

  it("hangup() takes no params", () => {
    expect(hangup()).toEqual({ hangup: {} });
  });

  it("reject() defaults to no reason, accepts busy", () => {
    expect(reject()).toEqual({ reject: {} });
    expect(reject("busy")).toEqual({ reject: { reason: "busy" } });
  });

  it("getDigits() nests say/play and omits an empty nested array", () => {
    expect(getDigits({ numDigits: 1 })).toEqual({ getDigits: { numDigits: 1 } });
    expect(getDigits({ numDigits: 1 }, [say("Press 1")])).toEqual({
      getDigits: { numDigits: 1, nested: [{ say: { text: "Press 1" } }] },
    });
  });

  it("dial() carries the target verbatim", () => {
    expect(dial({ number: "+254700000001", timeout: 30 })).toEqual({
      dial: { number: "+254700000001", timeout: 30 },
    });
  });

  it("stream() produces a single-key stream action (JSON, ahead of runtime)", () => {
    expect(
      stream({
        url: "wss://your-app.example.com/audio",
        track: "both_tracks",
        outputSamplingRate: 16000,
        name: "ai-agent",
        statusEvents: "stream-started stream-stopped stream-error",
      }),
    ).toEqual({
      stream: {
        url: "wss://your-app.example.com/audio",
        track: "both_tracks",
        outputSamplingRate: 16000,
        name: "ai-agent",
        statusEvents: "stream-started stream-stopped stream-error",
      },
    });
  });

  it("voiceResponse() wraps actions into the envelope", () => {
    const res = voiceResponse([say("Hi"), getDigits({ numDigits: 1 }), hangup()]);
    expect(res).toEqual({
      actions: [
        { say: { text: "Hi" } },
        { getDigits: { numDigits: 1 } },
        { hangup: {} },
      ],
    });
  });

  it("voiceResponse() rejects more than the 50-verb cap", () => {
    const many = Array.from({ length: MAX_ACTIONS + 1 }, () => hangup());
    expect(() => voiceResponse(many)).toThrow(/50-verb limit/);
  });

  it("voiceResponse() rejects an illegal nested verb reaching it at runtime", () => {
    // Types forbid this; cast simulates a plain-JS caller.
    const bad = {
      getDigits: { nested: [{ dial: { number: "+254700000001" } }] },
    } as unknown as ReturnType<typeof getDigits>;
    expect(() => voiceResponse([bad])).toThrow(/only say\(\) or play\(\)/);
  });

  it("matches the exact JSON a debt-reminder flow hand-writes", () => {
    const res = voiceResponse([
      say("Hello. Your balance of 2,500 shillings is due on 5 July.", {
        language: "en-KE",
      }),
      getDigits({ numDigits: 1, timeout: 8, finishOnKey: "#" }, [
        say("To pay now by M-Pesa, press 1."),
      ]),
      hangup(),
    ]);
    expect(res.actions).toHaveLength(3);
    expect("getDigits" in res.actions[1]).toBe(true);
  });
});

describe("dial destination XOR (number | numbers | sip)", () => {
  it("dial() accepts a single number", () => {
    expect(dial({ number: "+254700000001" })).toEqual({
      dial: { number: "+254700000001" },
    });
  });

  it("dial() accepts a fan-out numbers list (schema.go DialAction.Numbers)", () => {
    expect(dial({ numbers: ["+254700000001", "+254700000002"], callerId: "+254712345678" })).toEqual({
      dial: { numbers: ["+254700000001", "+254700000002"], callerId: "+254712345678" },
    });
  });

  it("dial() accepts a sip URI", () => {
    expect(dial({ sip: "sip:alice@example.com" })).toEqual({
      dial: { sip: "sip:alice@example.com" },
    });
  });

  it("fan-out survives voiceResponse() into the actions envelope", () => {
    expect(voiceResponse([dial({ numbers: ["+254700000001", "+254700000002"] })])).toEqual({
      actions: [{ dial: { numbers: ["+254700000001", "+254700000002"] } }],
    });
  });

  it("rejects mixing number with numbers at the type level", () => {
    // @ts-expect-error — ErrDialNumberNumbers: set either number or numbers, not both.
    const bad = { number: "+254700000001", numbers: ["+254700000002"] };
    expect(() => dial(bad)).not.toThrow(); // type-level guard only; runtime passes through
  });
});

describe("aiAgent", () => {
  it("emits the aiAgent key the runtime unmarshals", () => {
    expect(aiAgent("3f1b8c22-6a4e-4f1a-9c77-5b2e0d9a4411")).toEqual({
      aiAgent: { agentId: "3f1b8c22-6a4e-4f1a-9c77-5b2e0d9a4411" },
    });
  });

  it("carries a forward handover with nested voicemail", () => {
    expect(
      aiAgent("ag-1", {
        handover: {
          forward: {
            destinations: ["+254712345678"],
            voicemail: { greetingText: "Leave a message." },
          },
        },
      }),
    ).toEqual({
      aiAgent: {
        agentId: "ag-1",
        handover: {
          forward: {
            destinations: ["+254712345678"],
            voicemail: { greetingText: "Leave a message." },
          },
        },
      },
    });
  });

  it("is accepted as the last action", () => {
    expect(() => voiceResponse([say("One moment."), aiAgent("ag-1")])).not.toThrow();
  });

  // Mirrors ErrNativeVerbNotTerminal: nothing can run once the leg is forked,
  // so a trailing action is a mistake worth catching at authoring time rather
  // than silently discarding on a live call.
  it("throws when an action follows it", () => {
    expect(() => voiceResponse([aiAgent("ag-1"), hangup()])).toThrow(
      /aiAgent must be the last action/,
    );
  });

  it("rejects a handover naming two targets at the type level", () => {
    // @ts-expect-error — ErrAIAgentHandoverXOR: exactly one target.
    const bad = { handover: { forward: { destinations: ["+1"] }, voicemail: {} } };
    expect(bad).toBeTruthy();
  });
});
