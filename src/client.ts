// SautikitClient — the server-side entry point for the Sautikit API.
//
//   import { SautikitClient } from "@sautikit/node";
//   const client = new SautikitClient({ apiKey: process.env.SAUTIKIT_API_KEY });
//   const call = await client.calls.create({ from: "+2547…", to: ["+2547…"] });
//
// Auth is a bearer API key (minted at POST /v1/api-keys) — this client is
// for servers; do not ship API keys to browsers (use client.webrtc.mintToken
// server-side and hand only the short-lived token to @sautikit/webrtc).

import { CallsResource } from "./calls.js";
import { HttpClient } from "./http.js";
import type { FetchLike } from "./http.js";
import { WebRTCResource } from "./webrtc.js";

export const DEFAULT_BASE_URL = "https://api.sautikit.com";

export interface SautikitClientOptions {
  /**
   * Sautikit API key (bearer JWT). Falls back to the SAUTIKIT_API_KEY
   * environment variable when omitted.
   */
  apiKey?: string;
  /** API origin override; defaults to https://api.sautikit.com. */
  baseUrl?: string;
  /** Custom fetch implementation (tests, proxies, older runtimes). */
  fetch?: FetchLike;
}

function envApiKey(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.SAUTIKIT_API_KEY;
}

export class SautikitClient {
  readonly calls: CallsResource;
  readonly webrtc: WebRTCResource;

  constructor(options: SautikitClientOptions = {}) {
    const apiKey = options.apiKey ?? envApiKey();
    if (!apiKey) {
      throw new Error(
        "@sautikit/node: missing API key. Pass `apiKey` to new SautikitClient({ … }) " +
          "or set the SAUTIKIT_API_KEY environment variable.",
      );
    }
    const http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey,
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    });
    this.calls = new CallsResource(http);
    this.webrtc = new WebRTCResource(http);
  }
}
