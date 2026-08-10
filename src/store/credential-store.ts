/**
 * Encrypted credential store (D-10).
 *
 * SQLite (better-sqlite3, synchronous) on a persistent volume. Secrets are
 * encrypted field-level with AES-256-GCM keyed by the master key. The store
 * holds:
 *   - the Notion OAuth grant: DCR client info, access/refresh tokens, expiry,
 *     bot_id, owner, status (the G2-required state, persisted durably so the
 *     connector survives restart);
 *   - the downstream connector API key (scrypt-hashed, D-13);
 *   - short-lived OAuth flow state (PKCE verifier + state) for the
 *     connector-hosted consent flow (D-11).
 *
 * The `(access_token, refresh_token)` pair is written atomically in a single
 * transaction (G2 invariant: rotation is atomic). A per-grant mutex in the
 * AuthManager (not here) serializes refresh; this module just provides the
 * atomic write primitive.
 */
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { encryptSecret, decryptSecret, hashApiKey, verifyApiKey } from "./crypto.js";

export type GrantStatus = "active" | "requires_reauth";

export interface NotionGrant {
  client_id: string;
  client_secret: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number | null; // epoch ms, null if unknown
  bot_id: string | null;
  owner: string | null; // serialized JSON of owner/workspace
  scope: string | null;
  status: GrantStatus;
  updated_at: number;
}

export interface StoredGrantMeta {
  client_id: string;
  expires_at: number | null;
  bot_id: string | null;
  owner: string | null;
  scope: string | null;
  status: GrantStatus;
  updated_at: number;
}

export interface OAuthFlowState {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: number;
}

export interface CredentialStore {
  close(): void;
  // --- Notion grant ---
  hasGrant(): boolean;
  getGrant(): NotionGrant | null;
  getGrantMeta(): StoredGrantMeta | null;
  saveGrant(grant: Omit<NotionGrant, "updated_at">): void;
  /**
   * Atomically rotate (access_token, refresh_token) and the expiry, in a single
   * transaction. G2 invariant.
   */
  rotateTokens(args: {
    access_token: string;
    refresh_token: string;
    expires_at: number | null;
  }): void;
  setGrantStatus(status: GrantStatus): void;
  clearGrant(): void;
  // --- Downstream API key (D-13) ---
  hasDownstreamKey(): boolean;
  setDownstreamKey(apiKey: string): void;
  verifyDownstreamKey(apiKey: string): boolean;
  // --- OAuth flow state (D-11) ---
  saveFlowState(s: OAuthFlowState): void;
  consumeFlowState(state: string): OAuthFlowState | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notion_grant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL,
  client_secret_enc TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at INTEGER,
  bot_id TEXT,
  owner TEXT,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS downstream_key (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_flow_state (
  state TEXT PRIMARY KEY,
  code_verifier_enc TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function createCredentialStore(dbPath: string, masterKey: Buffer): CredentialStore {
  const db: DB = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const enc = (v: string) => encryptSecret(v, masterKey);
  const dec = (v: string | null) => (v === null ? null : decryptSecret(v, masterKey));

  return {
    close() {
      db.close();
    },

    hasGrant(): boolean {
      const row = db.prepare("SELECT 1 FROM notion_grant WHERE id = 1").get() as
        | { 1: number }
        | undefined;
      return row !== undefined;
    },

    getGrant(): NotionGrant | null {
      const row = db
        .prepare(
          "SELECT client_id, client_secret_enc, access_token_enc, refresh_token_enc, expires_at, bot_id, owner, scope, status, updated_at FROM notion_grant WHERE id = 1",
        )
        .get() as
        | {
            client_id: string;
            client_secret_enc: string | null;
            access_token_enc: string;
            refresh_token_enc: string;
            expires_at: number | null;
            bot_id: string | null;
            owner: string | null;
            scope: string | null;
            status: string;
            updated_at: number;
          }
        | undefined;
      if (!row) return null;
      return {
        client_id: row.client_id,
        client_secret: dec(row.client_secret_enc),
        access_token: decryptSecret(row.access_token_enc, masterKey),
        refresh_token: decryptSecret(row.refresh_token_enc, masterKey),
        expires_at: row.expires_at,
        bot_id: row.bot_id,
        owner: row.owner,
        scope: row.scope,
        status: row.status as GrantStatus,
        updated_at: row.updated_at,
      };
    },

    getGrantMeta(): StoredGrantMeta | null {
      const row = db
        .prepare(
          "SELECT client_id, expires_at, bot_id, owner, scope, status, updated_at FROM notion_grant WHERE id = 1",
        )
        .get() as
        | {
            client_id: string;
            expires_at: number | null;
            bot_id: string | null;
            owner: string | null;
            scope: string | null;
            status: string;
            updated_at: number;
          }
        | undefined;
      if (!row) return null;
      return {
        client_id: row.client_id,
        expires_at: row.expires_at,
        bot_id: row.bot_id,
        owner: row.owner,
        scope: row.scope,
        status: row.status as GrantStatus,
        updated_at: row.updated_at,
      };
    },

    saveGrant(grant: Omit<NotionGrant, "updated_at">): void {
      const now = Date.now();
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO notion_grant (id, client_id, client_secret_enc, access_token_enc, refresh_token_enc, expires_at, bot_id, owner, scope, status, updated_at)
           VALUES (1, @client_id, @client_secret_enc, @access_token_enc, @refresh_token_enc, @expires_at, @bot_id, @owner, @scope, @status, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             client_id = @client_id,
             client_secret_enc = @client_secret_enc,
             access_token_enc = @access_token_enc,
             refresh_token_enc = @refresh_token_enc,
             expires_at = @expires_at,
             bot_id = @bot_id,
             owner = @owner,
             scope = @scope,
             status = @status,
             updated_at = @updated_at`,
        ).run({
          client_id: grant.client_id,
          client_secret_enc: grant.client_secret ? enc(grant.client_secret) : null,
          access_token_enc: enc(grant.access_token),
          refresh_token_enc: enc(grant.refresh_token),
          expires_at: grant.expires_at,
          bot_id: grant.bot_id,
          owner: grant.owner,
          scope: grant.scope,
          status: grant.status,
          updated_at: now,
        });
      });
      tx();
    },

    rotateTokens(args: {
      access_token: string;
      refresh_token: string;
      expires_at: number | null;
    }): void {
      const now = Date.now();
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE notion_grant SET
             access_token_enc = @access_token_enc,
             refresh_token_enc = @refresh_token_enc,
             expires_at = @expires_at,
             status = 'active',
             updated_at = @updated_at
           WHERE id = 1`,
        ).run({
          access_token_enc: enc(args.access_token),
          refresh_token_enc: enc(args.refresh_token),
          expires_at: args.expires_at,
          updated_at: now,
        });
      });
      tx();
    },

    setGrantStatus(status: GrantStatus): void {
      db.prepare("UPDATE notion_grant SET status = ?, updated_at = ? WHERE id = 1").run(
        status,
        Date.now(),
      );
    },

    clearGrant(): void {
      db.prepare("DELETE FROM notion_grant WHERE id = 1").run();
    },

    hasDownstreamKey(): boolean {
      const row = db.prepare("SELECT 1 FROM downstream_key WHERE id = 1").get() as
        | { 1: number }
        | undefined;
      return row !== undefined;
    },

    setDownstreamKey(apiKey: string): void {
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO downstream_key (id, key_hash, updated_at) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET key_hash = excluded.key_hash, updated_at = excluded.updated_at`,
        ).run(hashApiKey(apiKey), Date.now());
      });
      tx();
    },

    verifyDownstreamKey(apiKey: string): boolean {
      const row = db.prepare("SELECT key_hash FROM downstream_key WHERE id = 1").get() as
        | { key_hash: string }
        | undefined;
      if (!row) return false;
      return verifyApiKey(apiKey, row.key_hash);
    },

    saveFlowState(s: OAuthFlowState): void {
      // Encrypt the verifier: it is a secret used to complete the flow.
      db.prepare(
        `INSERT OR REPLACE INTO oauth_flow_state (state, code_verifier_enc, redirect_uri, created_at)
         VALUES (@state, @code_verifier_enc, @redirect_uri, @created_at)`,
      ).run({
        state: s.state,
        code_verifier_enc: enc(s.code_verifier),
        redirect_uri: s.redirect_uri,
        created_at: s.created_at,
      });
    },

    consumeFlowState(state: string): OAuthFlowState | null {
      // Read + delete in one transaction so the state is single-use.
      const tx = db.transaction(() => {
        const row = db
          .prepare(
            "SELECT code_verifier_enc, redirect_uri, created_at FROM oauth_flow_state WHERE state = ?",
          )
          .get(state) as
          | {
              code_verifier_enc: string;
              redirect_uri: string;
              created_at: number;
            }
          | undefined;
        if (!row) return null;
        db.prepare("DELETE FROM oauth_flow_state WHERE state = ?").run(state);
        return {
          state,
          code_verifier: decryptSecret(row.code_verifier_enc, masterKey),
          redirect_uri: row.redirect_uri,
          created_at: row.created_at,
        };
      });
      return tx();
    },
  };
}
