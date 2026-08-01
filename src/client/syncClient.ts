import { requestUrl } from "obsidian";
import {
  API_PREFIX,
  ChangesResponse,
  FileResponse,
  IndexResponse,
  PushRequest,
  PushResponse,
  StatusResponse,
} from "../protocol";

export class SyncApiClient {
  constructor(
    private getBaseUrl: () => string,
    private getApiKey: () => string
  ) {}

  private url(path: string, query?: Record<string, string>): string {
    const base = this.getBaseUrl().replace(/\/+$/, "");
    const u = new URL(`${base}${API_PREFIX}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: string; query?: Record<string, string> }
  ): Promise<T> {
    const { query, ...rest } = init ?? {};
    const response = await requestUrl({
      url: this.url(path, query),
      method: rest.method ?? "GET",
      contentType: "application/json",
      body: rest.body,
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
      },
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      const text = response.text || String(response.status);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return response.json as T;
  }

  status(): Promise<StatusResponse> {
    return this.request("/status");
  }

  changes(since: number): Promise<ChangesResponse> {
    return this.request("/changes", { query: { since: String(since) } });
  }

  index(): Promise<IndexResponse> {
    return this.request("/index");
  }

  file(path: string): Promise<FileResponse> {
    return this.request("/file", { query: { path } });
  }

  push(body: PushRequest): Promise<PushResponse> {
    return this.request("/push", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
