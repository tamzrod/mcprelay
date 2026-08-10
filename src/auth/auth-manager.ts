/**
 * Upstream OAuth manager (D-12).
 *
 * Drives the Notion OAuth lifecycle using the SDK's first-party helpers in
 * `@modelcontextprotocol/sdk/client/auth.js` (discovery, DCR, PKCE, exchange,
 * refresh). It does NOT use the transport's `authProvider` auto-path: the
 * connector attaches the bearer token explicitly and controls refresh /
 * serialization / `invalid_grant` itself (see DECISIONS.md §D-12).
 *
 * Responsibilities (the G2 lifecycle):
 *   - discover authorization-server metadata (RFC 9728 → RFC 8414);
 *   - dynamic client registration (RFC 7591), persisting client creds;
 *   - start an operator authorization (PKCE S256 + state), persist flow state;
 *   - complete the authorization (exchange code → tokens), persist grant;
 *   - provide the current valid access token (proactive refresh before expiry);
 *   - refresh on a 401 (once), serializing refreshes per grant;
 *   - treat `invalid_grant` as terminal → `requires_reauth`, clear tokens;
 *   - survive restart (grant + DCR creds are in the encrypted store).
 */
import { randomBytes } from "node:crypto";
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { CredentialStore, NotionGrant, OAuthFlowState } from "../store/credential-store.js";

/** When to proactively refresh before expiry (ms). G2: 5–10 minutes. */
const REFRESH_LEAD_MS = 5 * 60 * 1000;

export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export interface OAuthConfig {
  serverUrl: string; // the Notion MCP resource URL, e.g. https://mcp.notion.com/mcp
  redirectUri: string; // the connector's own /oauth/callback URL
  clientName: string;
  scope?: string;
}

export interface AuthorizationStart {
  authorizationUrl: string;
  state: string;
}

export interface GrantState {
  status: "active" | "requires_reauth" | "absent";
  expiresAt: number | null;
  botId: string | null;
  owner: string | null;
}

export interface AuthManager {
  /** Begin the operator consent flow: DCR (if needed) + PKCE + authorize URL. */
  beginAuthorization(): Promise<AuthorizationStart>;
  /** Complete the consent flow: validate state, exchange code, persist grant. */
  completeAuthorization(state: string, code: string): Promise<void>;
  /**
   * Get a valid access token, refreshing proactively if near expiry. Throws
   * ReauthRequiredError if the grant is terminal/absent.
   */
  getAccessToken(): Promise<string>;
  /**
   * Called when the upstream returned 401. Performs ONE refresh+retry cycle.
   * Returns a fresh access token or throws ReauthRequiredError. Concurrent
   * callers for the same grant are serialized (G2 invariant).
   */
  refreshOn401(): Promise<string>;
  /** Current grant state (for health/status), without secrets. */
  grantState(): GrantState;
  /** True if a grant exists (used for restart-survival checks). */
  hasGrant(): boolean;
}

interface InternalState {
  authorizationServerUrl: string | null;
  metadata: AuthorizationServerMetadata | null;
  refreshMutex: Promise<string> | null;
  clientInfo: OAuthClientInformationFull | null;
}

export function createAuthManager(
  config: OAuthConfig,
  store: CredentialStore,
): AuthManager {
  const state: InternalState = {
    authorizationServerUrl: null,
    metadata: null,
    refreshMutex: null,
    clientInfo: null,
  };

  const clientMetadata: OAuthClientMetadata = {
    redirect_uris: [config.redirectUri],
    token_endpoint_auth_method: "none", // public client, PKCE
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: config.clientName,
    ...(config.scope ? { scope: config.scope } : {}),
  };

  async function discover(): Promise<{ url: string; metadata: AuthorizationServerMetadata }> {
    if (state.authorizationServerUrl && state.metadata) {
      return { url: state.authorizationServerUrl, metadata: state.metadata };
    }
    const info = await discoverOAuthServerInfo(config.serverUrl);
    const metadata = info.authorizationServerMetadata;
    if (!metadata) {
      throw new Error(
        `OAuth authorization-server metadata could not be discovered for ${config.serverUrl}`,
      );
    }
    state.authorizationServerUrl = info.authorizationServerUrl;
    state.metadata = metadata;
    return { url: info.authorizationServerUrl, metadata };
  }

  async function ensureClient(): Promise<OAuthClientInformationFull> {
    if (state.clientInfo) return state.clientInfo;
    const grant = store.getGrant();
    if (grant) {
      const existing: OAuthClientInformationFull = {
        client_id: grant.client_id,
        client_secret: grant.client_secret ?? undefined,
        redirect_uris: [config.redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: config.clientName,
      };
      state.clientInfo = existing;
      return existing;
    }
    const { url, metadata } = await discover();
    const reg = await registerClient(url, { metadata, clientMetadata });
    state.clientInfo = reg;
    return reg;
  }

  function persistTokens(client: OAuthClientInformationFull, tokens: OAuthTokens): void {
    const now = Date.now();
    const expiresAt =
      typeof tokens.expires_in === "number" ? now + tokens.expires_in * 1000 : null;
    // Notion returns extra fields (bot_id, owner) beyond the OAuthTokens schema.
    // Treat the raw token response as a record for those provider-specific bits.
    const extra = tokens as unknown as Record<string, unknown>;
    store.saveGrant({
      client_id: client.client_id,
      client_secret: client.client_secret ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? "",
      expires_at: expiresAt,
      bot_id: typeof extra.bot_id === "string" ? extra.bot_id : null,
      owner: extra.owner !== undefined && extra.owner !== null ? JSON.stringify(extra.owner) : null,
      scope: tokens.scope ?? null,
      status: "active",
    });
  }

  return {
    async beginAuthorization(): Promise<AuthorizationStart> {
      const { url, metadata } = await discover();
      const client = await ensureClient();
      const stateParam = randomBytes(16).toString("hex");
      const { authorizationUrl, codeVerifier } = await startAuthorization(url, {
        metadata,
        clientInformation: client,
        redirectUrl: config.redirectUri,
        scope: config.scope,
        state: stateParam,
      });
      const flowState: OAuthFlowState = {
        state: stateParam,
        code_verifier: codeVerifier,
        redirect_uri: config.redirectUri,
        created_at: Date.now(),
      };
      store.saveFlowState(flowState);
      return { authorizationUrl: authorizationUrl.toString(), state: stateParam };
    },

    async completeAuthorization(stateParam: string, code: string): Promise<void> {
      const flow = store.consumeFlowState(stateParam);
      if (!flow) {
        throw new ReauthRequiredError(
          "OAuth callback state not found or already consumed (possible replay/CSRF).",
        );
      }
      const { url, metadata } = await discover();
      const client = await ensureClient();
      const tokens = await exchangeAuthorization(url, {
        metadata,
        clientInformation: client,
        authorizationCode: code,
        codeVerifier: flow.code_verifier,
        redirectUri: flow.redirect_uri,
      });
      persistTokens(client, tokens);
    },

    async getAccessToken(): Promise<string> {
      const grant = store.getGrant();
      if (!grant || grant.status === "requires_reauth" || !grant.refresh_token) {
        throw new ReauthRequiredError("No active Notion OAuth grant; operator must authorize.");
      }
      if (grant.expires_at === null || grant.expires_at - REFRESH_LEAD_MS <= Date.now()) {
        return doRefresh(grant);
      }
      return grant.access_token;
    },

    refreshOn401(): Promise<string> {
      // Serialize refresh per grant (G2 invariant: never refresh concurrently).
      if (state.refreshMutex) return state.refreshMutex;
      const grant = store.getGrant();
      if (!grant || grant.status === "requires_reauth" || !grant.refresh_token) {
        return Promise.reject(
          new ReauthRequiredError("No active Notion OAuth grant; operator must authorize."),
        );
      }
      state.refreshMutex = doRefresh(grant).finally(() => {
        state.refreshMutex = null;
      });
      return state.refreshMutex;
    },

    grantState(): GrantState {
      const grant = store.getGrantMeta();
      if (!grant) return { status: "absent", expiresAt: null, botId: null, owner: null };
      return {
        status: grant.status,
        expiresAt: grant.expires_at,
        botId: grant.bot_id,
        owner: grant.owner,
      };
    },

    hasGrant(): boolean {
      return store.hasGrant();
    },
  };

  /**
   * Perform a single refresh attempt: call the SDK helper, persist the rotated
   * tokens atomically, and return the new access token. On `invalid_grant`
   * mark the grant terminal and clear tokens (G2). Other errors propagate
   * (transient errors are retried by the caller, not here).
   */
  async function doRefresh(grant: NotionGrant): Promise<string> {
    const { url, metadata } = await discover();
    const client: OAuthClientInformationFull = {
      client_id: grant.client_id,
      client_secret: grant.client_secret ?? undefined,
      redirect_uris: [config.redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: config.clientName,
    };
    let tokens: OAuthTokens;
    try {
      tokens = await refreshAuthorization(url, {
        metadata,
        clientInformation: client,
        refreshToken: grant.refresh_token,
      });
    } catch (err) {
      if (err instanceof InvalidGrantError || isInvalidGrant(err)) {
        // Terminal: clear and require reauth (G2). Do not retry-loop.
        store.setGrantStatus("requires_reauth");
        throw new ReauthRequiredError(
          "Notion refresh token is invalid/expired/revoked (invalid_grant). Operator must re-authorize.",
        );
      }
      throw err;
    }
    const newAccess = tokens.access_token;
    const newRefresh = tokens.refresh_token ?? grant.refresh_token;
    const now = Date.now();
    const expiresAt =
      typeof tokens.expires_in === "number" ? now + tokens.expires_in * 1000 : null;
    store.rotateTokens({ access_token: newAccess, refresh_token: newRefresh, expires_at: expiresAt });
    return newAccess;
  }
}

function isInvalidGrant(err: unknown): boolean {
  if (!err) return false;
  // The SDK throws InvalidGrantError (errorCode 'invalid_grant') on a standard
  // OAuth error response. Some paths throw a generic Error whose message
  // includes the error code — detect that as a fallback.
  const e = err as { errorCode?: string; message?: string };
  return e.errorCode === "invalid_grant" || /invalid_grant/i.test(e.message ?? "");
}
