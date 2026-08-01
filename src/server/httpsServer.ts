import type { App } from "obsidian";
import { Platform, TFile } from "obsidian";
import type { IncomingMessage, ServerResponse } from "http";
import type { Server as HttpsServerType } from "https";
import type { Server as HttpServerType } from "http";
import {
  API_PREFIX,
  FileResponse,
  IndexResponse,
  isMarkdownPath,
  normalizeVaultPath,
  PushRequest,
  PushResponse,
  StatusResponse,
  ChangesResponse,
} from "../protocol";
import type { RevisionStore } from "../revisionStore";
import { loadOrCreateTls } from "../tls";

function nodeRequire<T>(id: string): T {
  if (!Platform.isDesktopApp) {
    throw new Error("Node modules are desktop-only");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = (window as any).require ?? require;
  return req(id) as T;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, { error: "unauthorized" });
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "https://localhost");
}

export class SyncHttpsServer {
  private server: HttpServerType | HttpsServerType | null = null;
  private tlsEnabled: boolean;

  constructor(
    private app: App,
    private store: RevisionStore,
    private getApiKey: () => string,
    private getBind: () => {
      host: string;
      port: number;
      certPath: string;
      keyPath: string;
      tlsEnabled: boolean;
    },
    private pluginDirAbsolute: string
  ) {}

  isRunning(): boolean {
    return this.server != null;
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) return this.getBind();

    const bind = this.getBind();
    this.tlsEnabled = bind.tlsEnabled;

    if (this.tlsEnabled) {
      const https = nodeRequire<typeof import("https")>("https");
      const tls = await loadOrCreateTls({
        certPath: bind.certPath,
        keyPath: bind.keyPath,
        pluginDirAbsolute: this.pluginDirAbsolute,
      });
      this.server = https.createServer(
        { cert: tls.cert, key: tls.key },
        (req, res) => {
          void this.handle(req, res);
        }
      );
    } else {
      const http = nodeRequire<typeof import("http")>("http");
      this.server = http.createServer((req, res) => {
        void this.handle(req, res);
      });
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(bind.port, bind.host, () => resolve());
    });

    return { host: bind.host, port: bind.port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private checkAuth(req: IncomingMessage): boolean {
    const expected = this.getApiKey();
    if (!expected) return false;
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return !!match && match[1] === expected;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.checkAuth(req)) {
        unauthorized(res);
        return;
      }

      const url = parseUrl(req);
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      if (method === "GET" && path === `${API_PREFIX}/status`) {
        const body: StatusResponse = {
          vaultId: this.store.getVaultId(),
          revision: this.store.getRevision(),
          serverTime: Date.now(),
        };
        sendJson(res, 200, body);
        return;
      }

      if (method === "GET" && path === `${API_PREFIX}/changes`) {
        const since = Number(url.searchParams.get("since") ?? "0");
        const body: ChangesResponse = {
          vaultId: this.store.getVaultId(),
          revision: this.store.getRevision(),
          changes: this.store.getChangesSince(Number.isFinite(since) ? since : 0),
        };
        sendJson(res, 200, body);
        return;
      }

      if (method === "GET" && path === `${API_PREFIX}/index`) {
        const body: IndexResponse = {
          vaultId: this.store.getVaultId(),
          revision: this.store.getRevision(),
          files: this.store.getFileIndex(),
        };
        sendJson(res, 200, body);
        return;
      }

      if (method === "GET" && path === `${API_PREFIX}/file`) {
        const filePath = normalizeVaultPath(url.searchParams.get("path") ?? "");
        if (!isMarkdownPath(filePath)) {
          sendJson(res, 400, { error: "only .md paths are supported" });
          return;
        }
        const meta = this.store.getFile(filePath);
        if (!meta || meta.deleted) {
          const body: FileResponse = {
            path: filePath,
            revision: meta?.revision ?? 0,
            contentHash: "",
            mtime: meta?.mtime ?? 0,
            content: "",
            deleted: true,
          };
          sendJson(res, 200, body);
          return;
        }
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
          sendJson(res, 404, { error: "file not found" });
          return;
        }
        const content = await this.app.vault.read(file);
        const body: FileResponse = {
          path: filePath,
          revision: meta.revision,
          contentHash: meta.contentHash,
          mtime: meta.mtime,
          content,
        };
        sendJson(res, 200, body);
        return;
      }

      if (method === "POST" && path === `${API_PREFIX}/push`) {
        const raw = await readBody(req);
        const payload = JSON.parse(raw) as PushRequest;
        const response = await this.handlePush(payload);
        sendJson(res, 200, response);
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  }

  private async handlePush(payload: PushRequest): Promise<PushResponse> {
    const accepted: PushResponse["accepted"] = [];
    const rejected: PushResponse["rejected"] = [];
    const mtime = Date.now();

    for (const change of payload.changes ?? []) {
      const path = normalizeVaultPath(change.path);
      if (!isMarkdownPath(path)) {
        rejected.push({ path, reason: "server_wins" });
        continue;
      }

      const result = await this.store.tryAcceptPush(
        path,
        change.op,
        change.baseHash ?? "",
        change.content,
        mtime
      );

      if (!result.ok) {
        const current = result.current;
        let server: FileResponse | undefined;
        if (current && !current.deleted) {
          const file = this.app.vault.getAbstractFileByPath(path);
          const content = file instanceof TFile ? await this.app.vault.read(file) : "";
          server = {
            path,
            revision: current.revision,
            contentHash: current.contentHash,
            mtime: current.mtime,
            content,
          };
        } else {
          server = {
            path,
            revision: current?.revision ?? 0,
            contentHash: "",
            mtime: current?.mtime ?? 0,
            content: "",
            deleted: true,
          };
        }
        rejected.push({ path, reason: "server_wins", server });
        continue;
      }

      // Apply vault mutation for accepted changes
      if (change.op === "delete") {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.app.vault.trash(file, true);
        }
      } else if (change.content != null) {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, change.content);
        } else {
          const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
          if (folder && !(await this.app.vault.adapter.exists(folder))) {
            await this.ensureFolder(folder);
          }
          await this.app.vault.create(path, change.content);
        }
      }

      accepted.push({
        path,
        revision: result.record.revision,
        contentHash: result.record.contentHash,
        op: result.record.op,
      });
    }

    await this.store.flush();
    return {
      revision: this.store.getRevision(),
      accepted,
      rejected,
    };
  }

  private async ensureFolder(folderPath: string): Promise<void> {
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
