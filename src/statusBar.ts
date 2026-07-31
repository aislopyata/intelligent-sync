import type { Plugin } from "obsidian";

export interface StatusBarState {
  mode: "server" | "client";
  revision: number;
  online: boolean | null;
  lastSync: number | null;
  error?: string | null;
  serverRunning?: boolean;
}

export class SyncStatusBar {
  private el: HTMLElement;

  constructor(plugin: Plugin) {
    this.el = plugin.addStatusBarItem();
    this.el.addClass("intelligent-sync-status");
    this.render({
      mode: "client",
      revision: 0,
      online: null,
      lastSync: null,
    });
  }

  render(state: StatusBarState): void {
    const mode = state.mode;
    const rev = `rev ${state.revision}`;
    let conn = "—";
    if (mode === "server") {
      conn = state.serverRunning ? "listening" : "stopped";
    } else if (state.online === true) {
      conn = "ok";
    } else if (state.online === false) {
      conn = "err";
    }
    const time =
      state.lastSync != null
        ? new Date(state.lastSync).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "never";
    const err = state.error ? ` · ${state.error}` : "";
    this.el.setText(`IS · ${mode} · ${rev} · ${conn} · ${time}${err}`);
    this.el.title = state.error ?? "Intelligent Sync";
  }
}
