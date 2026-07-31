import { generateApiKey } from "./protocol";
import type { IntelligentSyncSettings } from "./settings";

export function ensureApiKey(settings: Pick<IntelligentSyncSettings, "apiKey">): string {
  if (!settings.apiKey) {
    settings.apiKey = generateApiKey();
  }
  return settings.apiKey;
}

export async function generateSafeCopy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard unavailable");
}
