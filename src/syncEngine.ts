import { App, TAbstractFile, TFile } from "obsidian";
import type { RevisionStore } from "./revisionStore";
import type { PullPushEngine } from "./client/pullPush";
import { isMarkdownPath, normalizeVaultPath } from "./protocol";

export type SyncTriggerCallback = () => void;

/**
 * Orchestrates vault listeners and debounced sync triggers.
 * Server mode: updates revision store on local .md changes.
 * Client mode: debounced pull/push via PullPushEngine.
 */
export class SyncEngine {
  private debounceTimer: number | null = null;
  private pollTimer: number | null = null;
  private readonly debounceMs = 1200;
  private suppressVaultEvents = false;

  constructor(
    private app: App,
    private mode: () => "server" | "client",
    private store: RevisionStore | null,
    private pullPush: PullPushEngine | null,
    private syncOnSave: () => boolean,
    private onClientSync: SyncTriggerCallback,
    private isApplyingRemote: () => boolean
  ) {}

  registerVaultEvents(register: (event: string, cb: (...args: unknown[]) => void) => void): void {
    const handle = async (file: TAbstractFile, kind: "upsert" | "delete") => {
      if (this.suppressVaultEvents || this.isApplyingRemote()) return;
      if (!(file instanceof TFile) && kind !== "delete") return;
      const path = normalizeVaultPath(file.path);
      if (!isMarkdownPath(path)) return;

      if (this.mode() === "server" && this.store) {
        if (kind === "delete") {
          await this.store.applyLocalDelete(path, Date.now());
        } else if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          await this.store.applyLocalUpsert(path, content, file.stat.mtime);
        }
        return;
      }

      if (this.mode() === "client" && this.syncOnSave()) {
        this.scheduleClientSync();
      }
    };

    register("create", (file) => void handle(file as TAbstractFile, "upsert"));
    register("modify", (file) => void handle(file as TAbstractFile, "upsert"));
    register("delete", (file) => void handle(file as TAbstractFile, "delete"));
  }

  scheduleClientSync(): void {
    if (this.debounceTimer != null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.onClientSync();
    }, this.debounceMs);
  }

  startPolling(intervalSec: number): void {
    this.stopPolling();
    if (intervalSec <= 0 || this.mode() !== "client") return;
    this.pollTimer = window.setInterval(() => {
      this.onClientSync();
    }, intervalSec * 1000);
  }

  stopPolling(): void {
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  stop(): void {
    this.stopPolling();
    if (this.debounceTimer != null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  setStore(store: RevisionStore | null): void {
    this.store = store;
  }

  setPullPush(pullPush: PullPushEngine | null): void {
    this.pullPush = pullPush;
  }
}
