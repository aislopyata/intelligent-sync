import type { App } from "obsidian";
import {
  ChangeRecord,
  FileIndexEntry,
  hashContent,
  isMarkdownPath,
  normalizeVaultPath,
  PLUGIN_ID,
  type ChangeOp,
} from "./protocol";

export interface SyncState {
  vaultId: string;
  revision: number;
  changes: ChangeRecord[];
  files: Record<string, FileIndexEntry>;
}

const STATE_FILE = "sync-state.json";
const MAX_CHANGE_LOG = 5000;

export class RevisionStore {
  private state: SyncState;
  private dirty = false;
  private saveTimer: number | null = null;

  constructor(
    private app: App,
    private resolveVaultId: () => string,
    private pluginDirRelative: string
  ) {
    this.state = {
      vaultId: resolveVaultId(),
      revision: 0,
      changes: [],
      files: {},
    };
  }

  getRevision(): number {
    return this.state.revision;
  }

  getVaultId(): string {
    return this.state.vaultId || this.resolveVaultId();
  }

  getFile(path: string): FileIndexEntry | undefined {
    return this.state.files[normalizeVaultPath(path)];
  }

  getChangesSince(since: number): ChangeRecord[] {
    return this.state.changes.filter((c) => c.revision > since);
  }

  getFileIndex(): FileIndexEntry[] {
    return Object.values(this.state.files);
  }

  async load(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.statePath();
    if (await adapter.exists(path)) {
      try {
        const raw = await adapter.read(path);
        const parsed = JSON.parse(raw) as SyncState;
        this.state = {
          vaultId: parsed.vaultId || this.resolveVaultId(),
          revision: parsed.revision ?? 0,
          changes: parsed.changes ?? [],
          files: parsed.files ?? {},
        };
        return;
      } catch {
        // fall through to rebuild
      }
    }
    await this.rebuildFromVault();
  }

  async rebuildFromVault(): Promise<void> {
    const files: Record<string, FileIndexEntry> = {};
    const markdown = this.app.vault.getMarkdownFiles();
    let revision = 0;
    const changes: ChangeRecord[] = [];
    for (const file of markdown) {
      const path = normalizeVaultPath(file.path);
      if (!isMarkdownPath(path)) continue;
      const content = await this.app.vault.read(file);
      const contentHash = await hashContent(content);
      revision += 1;
      const mtime = file.stat.mtime;
      files[path] = { path, contentHash, revision, mtime };
      changes.push({ revision, path, op: "upsert", contentHash, mtime });
    }
    this.state = {
      vaultId: this.resolveVaultId(),
      revision,
      changes,
      files,
    };
    await this.saveNow();
  }

  async applyLocalUpsert(path: string, content: string, mtime: number): Promise<ChangeRecord> {
    path = normalizeVaultPath(path);
    const contentHash = await hashContent(content);
    const existing = this.state.files[path];
    if (existing && !existing.deleted && existing.contentHash === contentHash) {
      return {
        revision: existing.revision,
        path,
        op: "upsert",
        contentHash,
        mtime: existing.mtime,
      };
    }
    return this.appendChange(path, "upsert", contentHash, mtime);
  }

  async applyLocalDelete(path: string, mtime: number): Promise<ChangeRecord> {
    path = normalizeVaultPath(path);
    const existing = this.state.files[path];
    if (existing?.deleted) {
      return {
        revision: existing.revision,
        path,
        op: "delete",
        contentHash: "",
        mtime: existing.mtime,
      };
    }
    return this.appendChange(path, "delete", "", mtime);
  }

  /**
   * Accept a client push if baseHash matches current server hash (server wins otherwise).
   */
  async tryAcceptPush(
    path: string,
    op: ChangeOp,
    baseHash: string,
    content: string | undefined,
    mtime: number
  ): Promise<
    | { ok: true; record: ChangeRecord }
    | { ok: false; current: FileIndexEntry | null }
  > {
    path = normalizeVaultPath(path);
    const current = this.state.files[path];
    const currentHash = current && !current.deleted ? current.contentHash : "";
    if (currentHash !== baseHash) {
      return { ok: false, current: current ?? null };
    }
    if (op === "delete") {
      const record = await this.applyLocalDelete(path, mtime);
      return { ok: true, record };
    }
    if (content == null) {
      return { ok: false, current: current ?? null };
    }
    // Write is done by caller; we only update index after vault write.
    const contentHash = await hashContent(content);
    const record = await this.appendChange(path, "upsert", contentHash, mtime);
    return { ok: true, record };
  }

  private async appendChange(
    path: string,
    op: ChangeOp,
    contentHash: string,
    mtime: number
  ): Promise<ChangeRecord> {
    this.state.revision += 1;
    const revision = this.state.revision;
    const record: ChangeRecord = { revision, path, op, contentHash, mtime };
    this.state.changes.push(record);
    if (this.state.changes.length > MAX_CHANGE_LOG) {
      this.state.changes = this.state.changes.slice(-MAX_CHANGE_LOG);
    }
    if (op === "delete") {
      this.state.files[path] = {
        path,
        contentHash: "",
        revision,
        mtime,
        deleted: true,
      };
    } else {
      this.state.files[path] = {
        path,
        contentHash,
        revision,
        mtime,
        deleted: false,
      };
    }
    this.scheduleSave();
    return record;
  }

  private statePath(): string {
    // Store under plugin directory inside .obsidian
    return `${this.pluginDirRelative}/${STATE_FILE}`;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer != null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 250);
  }

  async saveNow(): Promise<void> {
    this.dirty = false;
    const adapter = this.app.vault.adapter;
    const dir = this.pluginDirRelative;
    if (!(await adapter.exists(dir))) {
      await adapter.mkdir(dir);
    }
    await adapter.write(this.statePath(), JSON.stringify(this.state, null, 2));
  }

  async flush(): Promise<void> {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) await this.saveNow();
  }
}

export function pluginDataDir(configDir: string): string {
  return `${configDir}/plugins/${PLUGIN_ID}`;
}
