import {
  Notice,
  Plugin,
  Platform,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  ensureApiKey,
  ensureVaultId,
  type IntelligentSyncSettings,
} from "./settings";
import { IntelligentSyncSettingTab } from "./settingsTab";
import { SyncStatusBar } from "./statusBar";
import { RevisionStore, pluginDataDir } from "./revisionStore";
import { SyncHttpsServer } from "./server/httpsServer";
import { SyncApiClient } from "./client/syncClient";
import { PullPushEngine } from "./client/pullPush";
import { SyncEngine } from "./syncEngine";
import { PLUGIN_ID } from "./protocol";

export default class IntelligentSyncPlugin extends Plugin {
  settings: IntelligentSyncSettings = { ...DEFAULT_SETTINGS };
  private statusBar!: SyncStatusBar;
  private store: RevisionStore | null = null;
  private httpsServer: SyncHttpsServer | null = null;
  private apiClient: SyncApiClient | null = null;
  private pullPush: PullPushEngine | null = null;
  private syncEngine: SyncEngine | null = null;
  private syncing = false;
  private lastSync: number | null = null;
  private lastOnline: boolean | null = null;
  private lastError: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    ensureApiKey(this.settings);
    ensureVaultId(this.settings);
    await this.saveSettings();

    this.statusBar = new SyncStatusBar(this);
    this.addSettingTab(new IntelligentSyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => {
        void this.syncNow();
      },
    });

    if (Platform.isDesktopApp) {
      this.addCommand({
        id: "start-server",
        name: "Start sync server",
        callback: () => {
          void this.startServer();
        },
      });
      this.addCommand({
        id: "stop-server",
        name: "Stop sync server",
        callback: () => {
          void this.stopServer();
        },
      });
    }

    await this.applyMode();
    this.refreshStatusBar();
  }

  async onunload(): Promise<void> {
    this.syncEngine?.stop();
    await this.stopServer();
    await this.store?.flush();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  isServerRunning(): boolean {
    return this.httpsServer?.isRunning() ?? false;
  }

  async applyMode(): Promise<void> {
    this.syncEngine?.stop();
    await this.stopServer();
    this.store = null;
    this.httpsServer = null;
    this.pullPush = null;
    this.apiClient = null;

    if (this.settings.mode === "server") {
      if (!Platform.isDesktopApp) {
        new Notice("Intelligent Sync: server mode requires desktop Obsidian");
        this.settings.mode = "client";
        await this.saveSettings();
      } else {
        await this.initServerMode();
      }
    }

    if (this.settings.mode === "client") {
      this.initClientMode();
    }

    this.syncEngine = new SyncEngine(
      this.app,
      () => this.settings.mode,
      this.store,
      this.pullPush,
      () => this.settings.syncOnSave,
      () => {
        void this.syncNow(false);
      },
      () => this.pullPush?.applyingRemote ?? false
    );

    this.syncEngine.registerVaultEvents((event, cb) => {
      // Obsidian event map is loosely typed across versions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.registerEvent((this.app.vault as any).on(event, cb));
    });

    this.restartPolling();
    this.refreshStatusBar();
  }

  private async initServerMode(): Promise<void> {
    const configDir = this.app.vault.configDir;
    const pluginDir = pluginDataDir(configDir);
    this.store = new RevisionStore(
      this.app,
      () => ensureVaultId(this.settings),
      pluginDir
    );
    await this.store.load();

    const adapter = this.app.vault.adapter;
    // Absolute path for TLS files — best-effort via adapter base path
    let pluginAbs = pluginDir;
    if ("getBasePath" in adapter && typeof adapter.getBasePath === "function") {
      pluginAbs = `${adapter.getBasePath()}/${pluginDir}`;
    }

    this.httpsServer = new SyncHttpsServer(
      this.app,
      this.store,
      () => this.settings.apiKey,
      () => ({
        host: this.settings.bindHost,
        port: this.settings.bindPort,
        certPath: this.settings.tlsCertPath,
        keyPath: this.settings.tlsKeyPath,
      }),
      pluginAbs
    );

    if (this.settings.autoStartServer) {
      await this.startServer();
    }
  }

  private initClientMode(): void {
    this.apiClient = new SyncApiClient(
      () => this.settings.serverUrl,
      () => this.settings.apiKey
    );
    this.pullPush = new PullPushEngine(
      this.app,
      this.apiClient,
      () => this.settings,
      () => this.saveSettings()
    );
  }

  async startServer(): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("Server mode is desktop-only");
      return;
    }
    if (!this.httpsServer) {
      await this.applyMode();
    }
    if (!this.httpsServer) return;
    try {
      ensureApiKey(this.settings);
      await this.saveSettings();
      const { host, port } = await this.httpsServer.start();
      new Notice(`Intelligent Sync server listening on ${host}:${port}`);
      this.lastOnline = true;
      this.lastError = null;
    } catch (err) {
      this.lastOnline = false;
      this.lastError = String(err);
      new Notice(`Failed to start sync server: ${String(err)}`);
    }
    this.refreshStatusBar();
  }

  async stopServer(): Promise<void> {
    if (this.httpsServer?.isRunning()) {
      await this.httpsServer.stop();
      new Notice("Intelligent Sync server stopped");
    }
    this.refreshStatusBar();
  }

  restartPolling(): void {
    this.syncEngine?.startPolling(
      this.settings.mode === "client" ? this.settings.pollIntervalSec : 0
    );
  }

  async syncNow(showNotice = true): Promise<void> {
    if (this.settings.mode === "server") {
      if (showNotice) {
        new Notice(
          `Intelligent Sync server revision ${this.store?.getRevision() ?? 0}`
        );
      }
      this.refreshStatusBar();
      return;
    }

    if (!this.pullPush) {
      this.initClientMode();
    }
    if (!this.pullPush || this.syncing) return;

    this.syncing = true;
    this.refreshStatusBar();
    try {
      const result = await this.pullPush.sync();
      this.lastSync = Date.now();
      this.lastOnline = result.online;
      this.lastError = result.error ?? null;
      if (showNotice) {
        if (result.online) {
          new Notice(
            `Synced · pulled ${result.pulled} · pushed ${result.pushed}` +
              (result.rejected ? ` · rejected ${result.rejected}` : "")
          );
        } else {
          new Notice(`Sync failed: ${result.error}`);
        }
      }
    } finally {
      this.syncing = false;
      this.refreshStatusBar();
    }
  }

  private refreshStatusBar(): void {
    const revision =
      this.settings.mode === "server"
        ? this.store?.getRevision() ?? 0
        : this.settings.clientRevision;

    this.statusBar.render({
      mode: this.settings.mode,
      revision,
      online: this.lastOnline,
      lastSync: this.lastSync,
      error: this.lastError,
      serverRunning: this.isServerRunning(),
    });
  }
}

// Keep PLUGIN_ID referenced for tooling / future use
void PLUGIN_ID;
