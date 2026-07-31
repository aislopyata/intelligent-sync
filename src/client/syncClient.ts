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
    init?: RequestInit & { query?: Record<string, string> }
  ): Promise<T> {
    const { query, ...rest } = init ?? {};
    const res = await fetch(this.url(path, query), {
      ...rest,
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
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
