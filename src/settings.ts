import type { SyncMode } from "./protocol";
import { generateApiKey } from "./protocol";

export interface IntelligentSyncSettings {
  mode: SyncMode;
  /** Server bind address */
  bindHost: string;
  bindPort: number;
  apiKey: string;
  /** Absolute paths to TLS material (server). Empty = auto self-signed. */
  tlsCertPath: string;
  tlsKeyPath: string;
  /** Client: full base URL, e.g. https://10.0.0.2:27183 */
  serverUrl: string;
  pollIntervalSec: number;
  syncOnSave: boolean;
  autoStartServer: boolean;
  /** Last known server revision on this client */
  clientRevision: number;
  /** Per-path last known server content hash on this client */
  clientFileHashes: Record<string, string>;
  vaultId: string;
}

export const DEFAULT_SETTINGS: IntelligentSyncSettings = {
  mode: "client",
  bindHost: "0.0.0.0",
  bindPort: 27183,
  apiKey: "",
  tlsCertPath: "",
  tlsKeyPath: "",
  serverUrl: "https://127.0.0.1:27183",
  pollIntervalSec: 30,
  syncOnSave: true,
  autoStartServer: true,
  clientRevision: 0,
  clientFileHashes: {},
  vaultId: "",
};

export function ensureApiKey(settings: IntelligentSyncSettings): string {
  if (!settings.apiKey) {
    settings.apiKey = generateApiKey();
  }
  return settings.apiKey;
}

export function ensureVaultId(settings: IntelligentSyncSettings): string {
  if (!settings.vaultId) {
    settings.vaultId = generateApiKey().slice(0, 16);
  }
  return settings.vaultId;
}
