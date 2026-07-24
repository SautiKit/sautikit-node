// client.webrtc — server-side minting of browser softphone tokens.
//
// Pairs with @sautikit/webrtc in the browser: mint the token here (keeping
// the API key server-side), hand { token, endpoint, turnServer } to the
// browser SDK.

import type { HttpClient } from "./http.js";

export interface MintWebRTCTokenParams {
  /** Friendly label embedded in the PBX token; display-only. */
  clientName?: string;
  /** PBX-level role for the token, e.g. "dialer". */
  role?: string;
  /**
   * Bind the token to an owned DID by its internal number UUID so the
   * session routes through that number. Takes precedence over phoneNumber.
   */
  tenantNumberId?: string;
  /** Bind the token to an owned DID by its E.164 number (e.g. "+254709221535"). */
  phoneNumber?: string;
}

/**
 * PBX token passthrough (camelCase wire fields), plus a best-effort
 * `turnServer` attached by the API when TURN is configured.
 */
export interface WebRTCToken {
  token: string;
  endpoint?: string;
  protocol?: string;
  clientName?: string;
  sipProfile?: Record<string, unknown>;
  turnServer?: Record<string, unknown>;
  /** Seconds until token expiry. */
  expiresIn?: number;
  [key: string]: unknown;
}

export class WebRTCResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Mints a short-lived WebRTC token (POST /v1/webrtc/token). All params are
   * optional, but for an outbound dialer you almost always want to bind a
   * DID via tenantNumberId or phoneNumber. Requires the `webrtc.token` API
   * key scope. A 409 `webrtc.token.profile_pending` means the DID is still
   * provisioning on the PBX — retry shortly.
   */
  async mintToken(params: MintWebRTCTokenParams = {}): Promise<WebRTCToken> {
    // The endpoint requires a JSON body — {} at minimum.
    return this.http.request<WebRTCToken>("POST", "/v1/webrtc/token", {
      body: {
        ...(params.clientName !== undefined ? { client_name: params.clientName } : {}),
        ...(params.role !== undefined ? { role: params.role } : {}),
        ...(params.tenantNumberId !== undefined
          ? { tenant_number_id: params.tenantNumberId }
          : {}),
        ...(params.phoneNumber !== undefined ? { phone_number: params.phoneNumber } : {}),
      },
    });
  }
}
