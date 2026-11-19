import { invoke } from "@tauri-apps/api/core";
import type { LlmProvider } from "@/types/chat";

export const EMBEDDING_SECRET_SLOT = "embedding";

export type SecretSlot = LlmProvider | typeof EMBEDDING_SECRET_SLOT;

export interface SecretPayload {
  apiKeys: Partial<Record<LlmProvider, string>>;
  embeddingApiKey: string;
}

const EMPTY_SECRETS: SecretPayload = {
  apiKeys: {},
  embeddingApiKey: "",
};

/**
 * Loads all decrypted API keys from the Rust AES-256-GCM encrypted store (`secrets.enc`).
 */
export async function loadApiSecrets(): Promise<SecretPayload> {
  const payload = await invoke<SecretPayload>("load_api_secrets");
  return {
    apiKeys: payload?.apiKeys ?? {},
    embeddingApiKey: payload?.embeddingApiKey ?? "",
  };
}

/**
 * Encrypts and persists a single API key slot in Rust.
 * Passing an empty or whitespace-only value deletes the slot.
 */
export async function saveApiSecret(
  slot: SecretSlot | string,
  value: string,
): Promise<void> {
  await invoke("save_api_secret", { slot, value });
}

/**
 * Removes a single API key slot from encrypted storage in Rust.
 */
export async function deleteApiSecret(slot: SecretSlot | string): Promise<void> {
  await invoke("delete_api_secret", { slot });
}

export function createEmptySecretPayload(): SecretPayload {
  return {
    apiKeys: { ...EMPTY_SECRETS.apiKeys },
    embeddingApiKey: "",
  };
}
