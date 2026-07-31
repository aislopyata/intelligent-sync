export type SyncMode = "server" | "client";
export type ChangeOp = "upsert" | "delete";

export interface ChangeRecord {
  revision: number;
  path: string;
  op: ChangeOp;
  contentHash: string;
  mtime: number;
}

export interface FileIndexEntry {
  path: string;
  contentHash: string;
  revision: number;
  mtime: number;
  deleted?: boolean;
}

export interface StatusResponse {
  vaultId: string;
  revision: number;
  serverTime: number;
}

export interface ChangesResponse {
  vaultId: string;
  revision: number;
  changes: ChangeRecord[];
}

export interface IndexResponse {
  vaultId: string;
  revision: number;
  files: FileIndexEntry[];
}

export interface FileResponse {
  path: string;
  revision: number;
  contentHash: string;
  mtime: number;
  content: string;
  deleted?: boolean;
}

export interface PushChange {
  path: string;
  op: ChangeOp;
  content?: string;
  /** Hash the client last knew for this path on the server (empty if new). */
  baseHash: string;
}

export interface PushRequest {
  baseRevision: number;
  changes: PushChange[];
}

export interface PushRejected {
  path: string;
  reason: "server_wins";
  server?: FileResponse;
}

export interface PushAccepted {
  path: string;
  revision: number;
  contentHash: string;
  op: ChangeOp;
}

export interface PushResponse {
  revision: number;
  accepted: PushAccepted[];
  rejected: PushRejected[];
}

export const PLUGIN_ID = "intelligent-sync";
export const API_PREFIX = "/api/v1";

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md") && !path.includes("..");
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Desktop fallback via Node crypto (dynamic)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("crypto") as typeof import("crypto");
  return nodeCrypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto") as typeof import("crypto");
    const buf = nodeCrypto.randomBytes(32);
    bytes.set(buf);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
