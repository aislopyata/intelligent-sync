import { App, PluginSettingTab, Setting, Notice, Platform } from "obsidian";
import type IntelligentSyncPlugin from "./main";
import { generateApiKey } from "./protocol";
import { generateSafeCopy } from "./settingsHelpers";

export class IntelligentSyncSettingTab extends PluginSettingTab {
  plugin: IntelligentSyncPlugin;

  constructor(app: App, plugin: IntelligentSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Intelligent Sync" });

    new Setting(containerEl)
      .setName("Mode")
      .setDesc(
        "Server hosts the canonical vault. Client pushes/pulls changes. Server mode requires desktop."
      )
      .addDropdown((dd) => {
        dd.addOption("client", "Client");
        if (Platform.isDesktopApp) {
          dd.addOption("server", "Server");
        }
        dd.setValue(this.plugin.settings.mode);
        dd.onChange(async (value) => {
          if (value === "server" && !Platform.isDesktopApp) {
            new Notice("Server mode is desktop-only");
            dd.setValue("client");
            return;
          }
          this.plugin.settings.mode = value as "server" | "client";
          await this.plugin.saveSettings();
          await this.plugin.applyMode();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Shared secret. Clients must use the same key as the server.")
      .addText((text) => {
        text
          .setPlaceholder("API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      })
      .addButton((btn) => {
        btn.setButtonText("Generate").onClick(async () => {
          this.plugin.settings.apiKey = generateApiKey();
          await this.plugin.saveSettings();
          new Notice("API key generated");
          this.display();
        });
      })
      .addButton((btn) => {
        btn.setButtonText("Copy").onClick(async () => {
          await generateSafeCopy(this.plugin.settings.apiKey);
          new Notice("API key copied");
        });
      });

    if (this.plugin.settings.mode === "server") {
      this.renderServerSettings(containerEl);
    } else {
      this.renderClientSettings(containerEl);
    }
  }

  private renderServerSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Server" });

    new Setting(containerEl)
      .setName("Bind host")
      .setDesc("Use 0.0.0.0 to listen on all interfaces.")
      .addText((text) =>
        text.setValue(this.plugin.settings.bindHost).onChange(async (value) => {
          this.plugin.settings.bindHost = value.trim() || "0.0.0.0";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Bind port")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.bindPort)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0 && n < 65536) {
            this.plugin.settings.bindPort = Math.floor(n);
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("TLS certificate path")
      .setDesc(
        "Absolute path to cert.pem. Leave empty to auto-generate a self-signed cert (desktop peers only)."
      )
      .addText((text) =>
        text
          .setPlaceholder("/path/to/cert.pem")
          .setValue(this.plugin.settings.tlsCertPath)
          .onChange(async (value) => {
            this.plugin.settings.tlsCertPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("TLS private key path")
      .setDesc("Absolute path to key.pem. Required together with the certificate path.")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/key.pem")
          .setValue(this.plugin.settings.tlsKeyPath)
          .onChange(async (value) => {
            this.plugin.settings.tlsKeyPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-start server")
      .setDesc("Start the HTTPS server when Obsidian loads.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoStartServer).onChange(async (value) => {
          this.plugin.settings.autoStartServer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Server control")
      .addButton((btn) => {
        const running = this.plugin.isServerRunning();
        btn
          .setButtonText(running ? "Stop server" : "Start server")
          .setCta()
          .onClick(async () => {
            if (this.plugin.isServerRunning()) {
              await this.plugin.stopServer();
            } else {
              await this.plugin.startServer();
            }
            this.display();
          });
      });
  }

  private renderClientSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Client" });

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("HTTPS base URL of the sync server, e.g. https://10.8.0.1:27183")
      .addText((text) =>
        text
          .setPlaceholder("https://host:27183")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Poll interval (seconds)")
      .setDesc("Periodic pull/push while Obsidian is open. Set 0 to disable.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pollIntervalSec))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 0) {
              this.plugin.settings.pollIntervalSec = Math.floor(n);
              await this.plugin.saveSettings();
              this.plugin.restartPolling();
            }
          })
      );

    new Setting(containerEl)
      .setName("Sync on save")
      .setDesc("Debounced sync after markdown create/modify/delete.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
          this.plugin.settings.syncOnSave = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .addButton((btn) => {
        btn
          .setButtonText("Sync now")
          .setCta()
          .onClick(async () => {
            await this.plugin.syncNow();
          });
      });
  }
}
