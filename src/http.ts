// Minimal fetch-based HTTP core for @sautikit/node.
//
// Dependency-free: uses the runtime's global fetch (Node 18+, Deno, Bun,
// workers). The fetch surface is typed structurally so the package compiles
// without the DOM lib and tests can inject a stub.

import { errorFromBody, SautikitError } from "./error.js";

/** Structural subset of the WHATWG Response the SDK relies on. */
export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Structural subset of WHATWG fetch the SDK relies on. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "manual" | "follow" | "error";
  },
) => Promise<FetchResponseLike>;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  redirect?: "manual" | "follow" | "error";
}

function resolveGlobalFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error(
      "@sautikit/node: global fetch is not available in this runtime. " +
        "Use Node 18+ or pass a custom `fetch` to new SautikitClient({ fetch }).",
    );
  }
  return f.bind(globalThis) as FetchLike;
}

function buildQuery(query?: QueryParams): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

async function parseBody(res: FetchResponseLike): Promise<unknown> {
  const text = await res.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(args: { baseUrl: string; apiKey: string; fetch?: FetchLike }) {
    this.baseUrl = args.baseUrl.replace(/\/+$/, "");
    this.apiKey = args.apiKey;
    this.fetchImpl = args.fetch ?? resolveGlobalFetch();
  }

  /**
   * Performs an authenticated request and returns the raw response. Used by
   * endpoints with non-JSON contracts (the recording 302 redirect).
   */
  async raw(method: string, path: string, opts: RequestOptions = {}): Promise<FetchResponseLike> {
    const url = `${this.baseUrl}${path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...opts.headers,
    };
    const init: Parameters<FetchLike>[1] = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (opts.redirect !== undefined) init.redirect = opts.redirect;
    return this.fetchImpl(url, init);
  }

  /**
   * Performs an authenticated JSON request. Non-2xx responses throw a
   * SautikitError parsed from the error envelope.
   */
  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.raw(method, path, opts);
    const body = await parseBody(res);
    if (res.status >= 200 && res.status < 300) {
      return body as T;
    }
    throw errorFromBody(res.status, body);
  }

  /** Shared error translation for callers of raw(). */
  async throwFromResponse(res: FetchResponseLike): Promise<never> {
    throw errorFromBody(res.status, await parseBody(res));
  }
}

/** RFC4122-ish unique key; prefers the runtime's crypto.randomUUID. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for runtimes without WebCrypto: uniqueness, not secrecy, is
  // what an idempotency key needs.
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
    if (i === 7 || i === 11 || i === 15 || i === 19) out += "-";
  }
  return out;
}

export { SautikitError };
