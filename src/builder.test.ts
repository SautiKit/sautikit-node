import { describe, it, expect } from "vitest";
import { sauti, voice, VoiceBuilder, say, MAX_ACTIONS } from "./index.js";

describe("fluent VoiceBuilder", () => {
  it("chains verbs and builds the envelope in order", () => {
    const res = sauti
      .say("Hi", { language: "en-KE" })
      .getDigits({ numDigits: 1 })
      .play("https://cdn.example.com/a.wav")
      .hangup()
      .build();

    expect(res).toEqual({
      actions: [
        { say: { text: "Hi", language: "en-KE" } },
        { getDigits: { numDigits: 1 } },
        { play: { url: "https://cdn.example.com/a.wav" } },
        { hangup: {} },
      ],
    });
  });

  it("toJSON() lets a chain serialize directly (res.json / JSON.stringify)", () => {
    const chain = sauti.say("Bye").hangup();
    expect(JSON.parse(JSON.stringify(chain))).toEqual({
      actions: [{ say: { text: "Bye" } }, { hangup: {} }],
    });
  });

  it("getDigits nested prompt via callback needs no functional imports", () => {
    const res = sauti
      .say("Menu")
      .getDigits({ numDigits: 1 }, (p) => p.say("Press 1").play("https://cdn.example.com/b.wav"))
      .build();
    const gd = res.actions[1] as { getDigits: { nested: unknown[] } };
    expect(gd.getDigits.nested).toEqual([
      { say: { text: "Press 1" } },
      { play: { url: "https://cdn.example.com/b.wav" } },
    ]);
  });

  it("getDigits still accepts a nested array (functional form)", () => {
    const res = sauti.getDigits({ numDigits: 1 }, [say("Press 1")]).build();
    const gd = res.actions[0] as { getDigits: { nested: unknown[] } };
    expect(gd.getDigits.nested).toEqual([{ say: { text: "Press 1" } }]);
  });

  it("voice() starts an empty chain for conditional building", () => {
    const flow = voice();
    flow.say("Welcome");
    if (true) flow.getDigits({ numDigits: 1 }, [say("Press 1")]);
    flow.hangup();
    expect(flow.build().actions).toHaveLength(3);
  });

  it("sauti starts a FRESH chain each time (no shared state)", () => {
    const a = sauti.say("A").build();
    const b = sauti.say("B").build();
    expect(a.actions).toHaveLength(1);
    expect(b.actions).toHaveLength(1);
    expect((a.actions[0] as { say: { text: string } }).say.text).toBe("A");
  });

  it("build() enforces the 50-verb cap", () => {
    const chain = voice();
    for (let i = 0; i < MAX_ACTIONS + 1; i++) chain.hangup();
    expect(() => chain.build()).toThrow(/50-verb limit/);
  });

  it("exposes the VoiceBuilder class for advanced use", () => {
    expect(new VoiceBuilder().say("x").build().actions).toHaveLength(1);
  });
});
