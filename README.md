# @sautikit/node

Typed voice-action builders for [Sautikit](https://sautikit.com), the Kenya-first
programmable voice API. Construct the JSON your voice webhook returns with a
fluent, chainable API — and let the type system enforce the runtime's rules
before a call ever hits the network.

> **Preview.** The API may change before v1.0 — pin your version. This package
> ships the voice-action builders **and** the REST transport layer:
> `new SautikitClient({ apiKey })` with `client.calls.*` (place, fetch, list,
> hangup, recording) and `client.webrtc.mintToken()`. Full-surface coverage
> (wallet, numbers, …) is generated from the public OpenAPI spec and expands
> over subsequent releases. See `CHANGELOG.md`.

## Install

```bash
npm install @sautikit/node
```

TypeScript-first, zero runtime dependencies, Node 18+. Ships **both ESM and
CommonJS**, so `import` and `require()` both work with no bundler config:

```js
import { SautikitClient } from "@sautikit/node";   // ESM
const { SautikitClient } = require("@sautikit/node"); // CommonJS
```

## Quickstart

When a call reaches a Sautikit number, the platform POSTs the call state to your
`voice_callback_url`. You reply with an ordered list of **voice actions**. Build
that reply by chaining verbs off `sauti` and handing it to your responder:

```ts
import { sauti } from "@sautikit/node";
import express from "express";

const app = express();
app.use(express.urlencoded({ extended: true }));

app.post("/voice", (req, res) => {
  // No digits yet → greet and collect one.
  if (!req.body.Digits) {
    return res.json(
      sauti
        .say("Hello. Press 1 to pay, or 2 for an agent.", { language: "en-KE" })
        .getDigits({ numDigits: 1, timeout: 8 })
        .hangup(),
    );
  }
  // Digits present → branch on them.
  if (req.body.Digits === "1") {
    return res.json(sauti.say("Sending an M-Pesa request now.").hangup());
  }
  return res.json(sauti.redirect("/voice/agent"));
});
```

`res.json(chain)` works directly: the builder implements `toJSON()`, so Express
(and `JSON.stringify`) serialize it to the `{ actions: [...] }` envelope for you.

## Two ways to build

Both produce the same JSON; pick per taste.

**Fluent (`sauti`)** — chain verbs, no other imports:

```ts
import { sauti } from "@sautikit/node";

sauti.say("Hi").getDigits({ numDigits: 1 }).hangup();      // one-liner, fresh chain

const flow = sauti.say("Welcome");                          // assign it, then extend conditionally
if (afterHours) flow.redirect("/voice/after-hours");
else flow.getDigits({ numDigits: 1 });
res.json(flow.hangup());
```

Every verb on `sauti` **starts a fresh chain** (so it never carries state between
requests) and returns a `VoiceBuilder` you can keep extending — assign it to a
variable to build conditionally, as above.

Reach for **`voice()`** only when even the first verb is conditional and there's
no natural opener:

```ts
import { voice } from "@sautikit/node";

const flow = voice();                 // an empty chain; sauti always needs a first verb
if (isAudio) flow.play(audioUrl);
else flow.say(text);
res.json(flow.hangup());
```

**Functional (`voiceResponse` + verb functions)** — compose an array:

```ts
import { voiceResponse, say, getDigits, hangup } from "@sautikit/node";

res.json(
  voiceResponse([
    say("Hi", { language: "en-KE" }),
    getDigits({ numDigits: 1 }, [say("Press 1 to pay")]),
    hangup(),
  ]),
);
```

## The response envelope

Every reply is an object with an ordered `actions` array:

```json
{
  "actions": [
    { "say": { "text": "Habari, karibu." } },
    { "getDigits": { "numDigits": 1 } },
    { "hangup": {} }
  ]
}
```

- Actions execute top to bottom.
- **Maximum 50 actions** per reply.
- Exactly **one verb per action** object.

`.build()` returns this object and validates it (throws on >50 verbs or an
illegal nested verb); `.toJSON()` is the same, called for you on serialization.

---

## Verb reference

Each verb has a builder function and an identical method on the fluent chain.
Below, the **Default** column shows the PBX behaviour when a field is omitted.

### `say` — speak text (TTS)

```ts
sauti.say("Your balance is 2,500 shillings.", { voice: "alice", language: "en-KE" });
say("Your balance is 2,500 shillings.", { language: "en-KE" });
```

| Param | Type | Default | Description |
|---|---|---|---|
| `text` *(required)* | `string` | — | The words to synthesize. |
| `voice` | `string` | PBX default | TTS voice id, e.g. `"alice"`, `"man"`, `"woman"`. |
| `language` | `string` | PBX default | IETF BCP-47 tag, e.g. `"en-KE"`, `"sw-KE"`. |
| `loop` | `number` | `1` | Times to repeat; `0` means play once. |

### `play` — stream an audio file

```ts
sauti.play("https://cdn.example.com/greeting.wav");
play("https://cdn.example.com/hold.mp3", { loop: 0 });
```

| Param | Type | Default | Description |
|---|---|---|---|
| `url` *(required)* | `string` | — | Audio file URL. Must resolve to a host on your workspace's CDN allow-list. |
| `loop` | `number` | `1` | Times to play; `0` means once. |

### `getDigits` — collect DTMF input

```ts
sauti.getDigits({ numDigits: 1, timeout: 8 }, (p) => p.say("Press 1 to pay"));
getDigits({ numDigits: 1, finishOnKey: "#" }, [say("Enter your PIN, then hash")]);
```

| Param | Type | Default | Description |
|---|---|---|---|
| `timeout` | `number` | PBX default | Seconds to wait for input after the prompt finishes. `0` = PBX default. |
| `numDigits` | `number` | unlimited | Collect exactly this many digits. `0` = unlimited. |
| `finishOnKey` | `string` | `"#"` | Key that submits input early. |
| `nested` | `NestedAction[]` or `(p) => void` | — | Prompt played while waiting. **Only `say`/`play`** are allowed. |

**Where do the digits go?** There is no per-verb callback URL. When digits are
collected, the platform POSTs back to your **`voice_callback_url`** with a
`Digits` field. Dispatch on `req.body.Digits`, or `redirect()` to a sub-flow —
see the quickstart above.

The nested prompt via callback receives a `NestedBuilder` that exposes only
`say` and `play`, so an illegal nested verb is impossible to write:

```ts
sauti.getDigits({ numDigits: 4 }, (p) =>
  p.say("Enter your 4-digit PIN.").play("https://cdn.example.com/beep.wav"),
);
```

### `dial` — connect to a number or SIP endpoint

Exactly one of `number` or `sip` is required — the XOR is a **compile error** if
you pass both or neither.

```ts
sauti.dial({ number: "+254712345678", callerId: "+254700000001", timeout: 30 });
dial({ sip: "sip:agent@pbx.example.com", record: "record-from-answer" });
```

| Param | Type | Default | Description |
|---|---|---|---|
| `number` | `string` | — | E.164 destination. Mutually exclusive with `sip`. |
| `sip` | `string` | — | SIP URI, e.g. `"sip:alice@example.com"`. Mutually exclusive with `number`. |
| `callerId` | `string` | the call's number | Caller ID presented to the callee. |
| `timeout` | `number` | PBX default | Seconds to ring before giving up. |
| `record` | `string` | off | Recording mode, e.g. `"record-from-answer"`, `"record-from-ringing"`. |

### `conference` — place the caller in a room

```ts
sauti.conference("support-room-42", { record: true, beep: true, maxParticipants: 10 });
```

| Param | Type | Default | Description |
|---|---|---|---|
| `name` *(required)* | `string` | — | Conference room identifier. |
| `maxParticipants` | `number` | PBX default | Cap on room size. `0` = default. |
| `record` | `boolean` | `false` | Record the conference. |
| `beep` | `boolean` | `false` | Play an entry/exit tone. |
| `muted` | `boolean` | `false` | Join the caller listen-only. |
| `startOnEnter` | `boolean` | `true` | Start the conference when this caller joins. |
| `endOnExit` | `boolean` | `false` | End the conference when this caller leaves. |
| `waitUrl` | `string` | — | Hold-music URL played before the conference starts. |
| `statusEventsCallbackUrl` | `string` | — | URL the PBX POSTs conference status events to. |
| `statusEvents` | `string` | — | Space-separated events, e.g. `"start end join leave"`. |
| `collectDigits` | `boolean` | `false` | Enable in-conference DTMF collection. |
| `finishOnKey` | `string` | `"#"` | Submits collected digits early (when `collectDigits`). |
| `numDigits` | `number` | unlimited | Max in-conference digits. `0` = unlimited. |
| `digitsCallbackUrl` | `string` | — | URL POSTed a `DigitsCollected` event. |
| `flags` | `string` | — | Raw FreeSWITCH `mod_conference` flags, forwarded verbatim. |

### `record` — record the caller

```ts
sauti.record({ action: "https://app.example.com/recording-ready", maxLength: 120, transcribe: true });
```

| Param | Type | Default | Description |
|---|---|---|---|
| `action` | `string` | — | URL Sautikit POSTs the recording to. |
| `method` | `"GET"` \| `"POST"` | `"POST"` | HTTP method for `action`. |
| `timeout` | `number` | PBX default | Seconds of silence that stops recording. |
| `maxLength` | `number` | PBX default | Max recording length, seconds. |
| `finishOnKey` | `string` | — | DTMF key that stops recording early. |
| `transcribe` | `boolean` | `false` | Request speech-to-text. |
| `transcribeCallback` | `string` | — | URL POSTed when the transcript is ready. |

### `redirect` — hand off to another URL

```ts
sauti.redirect("https://app.example.com/voice/after-hours");
redirect("/voice/menu", { method: "GET" });
```

| Param | Type | Default | Description |
|---|---|---|---|
| `url` *(required)* | `string` | — | Endpoint that returns its own voice-action reply. |
| `method` | `"GET"` \| `"POST"` | `"POST"` | HTTP method for the redirect. |

Use `redirect` to route between sub-flows without one giant handler.

### `reject` — refuse an inbound call

```ts
sauti.reject("busy");
reject(); // "rejected"
```

| Param | Type | Default | Description |
|---|---|---|---|
| `reason` | `"rejected"` \| `"busy"` | `"rejected"` | Signal sent to the carrier. `"busy"` simulates a busy tone. |

### `hangup` — end the call

```ts
sauti.say("Goodbye.").hangup();
hangup();
```

No parameters.

---

## What the types enforce

The builders make the runtime's rules unrepresentable, so you catch mistakes at
compile time instead of as a rejected webhook:

- **One verb per action** — each builder returns a single-key object.
- **`dial` requires exactly one of `number` / `sip`** — passing both or neither
  is a type error (mirrors the runtime's `ErrDialTargetXOR`).
- **`getDigits` nesting is `say`/`play` only** — the nested array type and the
  `NestedBuilder` callback both reject anything else (mirrors `ErrGetDigitsNested`).
- **The 50-verb cap and nested rule** are re-checked at `.build()` for plain-JS
  callers.

There is intentionally **no `toXML()`**: XML is unvalidated passthrough at the
Sautikit runtime, so the SDK does not emit it. Migrating from Twilio/TwiML or
Africa's Talking? Your existing voice XML keeps working as-is; reach for this SDK
when you want typed, validated JSON.

## Exports

| Export | What it is |
|---|---|
| `sauti` | Fluent chain-starter; every verb begins a fresh chain. |
| `voice()` | Returns an empty `VoiceBuilder` for conditional building. |
| `VoiceBuilder` | The chainable builder class. |
| `say`, `play`, `getDigits`, `dial`, `conference`, `record`, `redirect`, `reject`, `hangup` | Functional verb builders. |
| `voiceResponse(actions)` | Wraps an array into the validated envelope. |
| `MAX_ACTIONS` | The 50-verb cap constant. |
| Types: `SayParams`, `PlayParams`, `GetDigitsParams`, `DialParams`, `ConferenceParams`, `RecordParams`, `RedirectParams`, `RejectParams`, `VoiceAction`, `VoiceResponse`, `NestedAction`, `NestedInput` | Full typings. |

## Links

- Voice actions reference: https://sautikit.com/developers/concepts/voice-actions
- API reference: https://sautikit.com/developers/api
- Pricing (KES, per-second billing): https://sautikit.com/pricing

## License

MIT
