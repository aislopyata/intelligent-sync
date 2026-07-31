import type { App } from "obsidian";
import type { RevisionStore } from "../revisionStore";
import type {
  ChangesResponse,
  FileResponse,
  PushRequest,
  PushResponse,
  StatusResponse,
} from "../protocol";

/**
 * Request handler helpers extracted for clarity / testing.
 * The live HTTPS server wires these through SyncHttpsServer.
 */
export function buildStatus(store: RevisionStore): StatusResponse {
  return {
    vaultId: store.getVaultId(),
    revision: store.getRevision(),
    serverTime: Date.now(),
  };
}

export function buildChanges(store: RevisionStore, since: number): ChangesResponse {
  return {
    vaultId: store.getVaultId(),
    revision: store.getRevision(),
    changes: store.getChangesSince(since),
  };
}

export type PushHandler = (app: App, store: RevisionStore, body: PushRequest) => Promise<PushResponse>;
export type FileHandler = (app: App, store: RevisionStore, path: string) => Promise<FileResponse>;
