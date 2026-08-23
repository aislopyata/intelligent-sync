import { App, Notice, TFile } from "obsidian";
import {
  hashContent,
  isMarkdownPath,
  normalizeVaultPath,
  PushChange,
} from "../protocol";
import type { IntelligentSyncSettings } from "../settings";
import { SyncApiClient } from "./syncClient";

export interface PullPushResult {
  revision: number;
  pulled: number;
  pushed: number;
  rejected: number;
  online: boolean;
  error?: string;
}

function summarizeIssues(issues: string[]): string {
  const msg = issues.join("; ");
  return msg.length > 280 ? `${msg.slice(0, 277)}...` : msg;
}

export class PullPushEngine {
  applyingRemote = false;

  constructor(
    private app: App,
    private client: SyncApiClient,
    private getSettings: () => IntelligentSyncSettings,
    private saveSettings: () => Promise<void>
  ) {}

  async sync(): Promise<PullPushResult> {
    const settings = this.getSettings();
    const issues: string[] = [];
    try {
      const status = await this.client.status();
      let pulled = 0;
      let pushed = 0;
      let rejected = 0;

      // 1) Pull remote changes first (server wins)
      if (status.revision > settings.clientRevision) {
        const { changes } = await this.client.changes(settings.clientRevision);
        this.applyingRemote = true;
        let pullFailed = false;
        try {
          if (changes.length === 0) {
            const index = await this.client.index();
            for (const entry of index.files) {
              try {
                if (entry.deleted) {
                  await this.applyServerFile(entry.path, {
                    content: "",
                    deleted: true,
                    contentHash: "",
                  });
                  delete settings.clientFileHashes[entry.path];
                } else {
                  await this.applyRemoteChange(entry.path, "upsert");
                  settings.clientFileHashes[entry.path] = entry.contentHash;
                  pulled += 1;
                }
              } catch (err) {
                issues.push(`${entry.path}: ${String(err)}`);
                pullFailed = true;
                break;
              }
            }
            if (!pullFailed) settings.clientRevision = index.revision;
          } else {
            for (const change of changes) {
              try {
                await this.applyRemoteChange(change.path, change.op);
              } catch (err) {
                issues.push(`${change.path}: ${String(err)}`);
                pullFailed = true;
                break;
              }
              pulled += 1;
              settings.clientRevision = Math.max(settings.clientRevision, change.revision);
              if (change.op === "upsert") {
                settings.clientFileHashes[change.path] = change.contentHash;
              } else {
                delete settings.clientFileHashes[change.path];
              }
            }
            if (!pullFailed) {
              settings.clientRevision = Math.max(settings.clientRevision, status.revision);
            }
          }
        } finally {
          this.applyingRemote = false;
        }
        await this.saveSettings();
      }

      // 2) Push local divergences
      const localChanges = await this.collectLocalChanges(issues);
      if (localChanges.length > 0) {
        try {
          const pushRes = await this.client.push({
            baseRevision: settings.clientRevision,
            changes: localChanges,
          });

          for (const acc of pushRes.accepted) {
            pushed += 1;
            settings.clientRevision = Math.max(settings.clientRevision, acc.revision);
            if (acc.op === "delete") {
              delete settings.clientFileHashes[acc.path];
            } else {
              settings.clientFileHashes[acc.path] = acc.contentHash;
            }
          }

          this.applyingRemote = true;
          try {
            for (const rej of pushRes.rejected) {
              rejected += 1;
              if (!rej.server) continue;
              try {
                await this.applyServerFile(rej.server.path, rej.server);
              } catch (err) {
                issues.push(`${rej.server.path}: ${String(err)}`);
                continue;
              }
              if (rej.server.deleted) {
                delete settings.clientFileHashes[rej.server.path];
              } else {
                settings.clientFileHashes[rej.server.path] = rej.server.contentHash;
                settings.clientRevision = Math.max(
                  settings.clientRevision,
                  rej.server.revision
                );
              }
            }
          } finally {
            this.applyingRemote = false;
          }

          settings.clientRevision = Math.max(settings.clientRevision, pushRes.revision);

          if (rejected > 0) {
            new Notice(
              `Intelligent Sync: ${rejected} change(s) rejected (server wins)`
            );
          }
        } catch (err) {
          issues.push(`push: ${String(err)}`);
        }
        await this.saveSettings();
      }

      const result: PullPushResult = {
        revision: settings.clientRevision,
        pulled,
        pushed,
        rejected,
        online: true,
      };
      if (issues.length > 0) {
        result.error = summarizeIssues(issues);
        new Notice(`Intelligent Sync: synced with ${issues.length} issue(s), see status bar`);
      }
      return result;
    } catch (err) {
      return {
        revision: settings.clientRevision,
        pulled: 0,
        pushed: 0,
        rejected: 0,
        online: false,
        error: String(err),
      };
    }
  }

  private async applyRemoteChange(path: string, op: "upsert" | "delete"): Promise<void> {
    path = normalizeVaultPath(path);
    if (!isMarkdownPath(path)) return;
    if (op === "delete") {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.app.vault.trash(file, true);
      }
      return;
    }
    const remote = await this.client.file(path);
    await this.applyServerFile(path, remote);
  }

  private async applyServerFile(
    path: string,
    remote: { content: string; deleted?: boolean; contentHash: string }
  ): Promise<void> {
    path = normalizeVaultPath(path);
    if (remote.deleted) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.app.vault.trash(file, true);
      }
      return;
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const local = await this.app.vault.read(existing);
      if (local !== remote.content) {
        await this.app.vault.modify(existing, remote.content);
      }
    } else {
      await this.ensureFolder(path);
      await this.app.vault.create(path, remote.content);
    }
  }

  private async collectLocalChanges(into: string[]): Promise<PushChange[]> {
    const settings = this.getSettings();
    const changes: PushChange[] = [];
    const seen = new Set<string>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      const path = normalizeVaultPath(file.path);
      if (!isMarkdownPath(path)) continue;
      seen.add(path);
      let content: string;
      let hash: string;
      try {
        content = await this.app.vault.read(file);
        hash = await hashContent(content);
      } catch (err) {
        into.push(`${path}: ${String(err)}`);
        continue;
      }
      const known = settings.clientFileHashes[path] ?? "";
      if (hash !== known) {
        changes.push({
          path,
          op: "upsert",
          content,
          baseHash: known,
        });
      }
    }

    for (const path of Object.keys(settings.clientFileHashes)) {
      if (!seen.has(path) && isMarkdownPath(path)) {
        changes.push({
          path,
          op: "delete",
          baseHash: settings.clientFileHashes[path],
        });
      }
    }

    return changes;
  }

  private async ensureFolder(filePath: string): Promise<void> {
    const idx = filePath.lastIndexOf("/");
    if (idx <= 0) return;
    const folderPath = filePath.slice(0, idx);
    const parts = folderPath.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}
