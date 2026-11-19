import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useDocumentStore } from "@/stores/documentStore";
import { mockDatabase } from "@/test/fakes/mockDatabase";
import {
  mockProcessRelaunch,
  mockSecretsBackend,
  mockTauriInvoke,
  mockTauriStoreMap,
  mockUpdaterCheck,
} from "@/test/fakes/mockTauri";
import type { DocumentItem } from "@/types/document";

const TEST_DOC: DocumentItem = {
  id: "doc-update-guard-1",
  title: "Encrypted Storage Paper",
  pages: 1,
  filePath: "/mock/sample-1page.pdf",
  lastPage: 1,
  zoom: 100,
};

describe("Encrypted API key storage & legacy migration", () => {
  it("never writes API keys to localStorage or plaintext settings.json when updated", async () => {
    mockSecretsBackend.apiKeys = {};
    mockSecretsBackend.embeddingApiKey = "";
    useAiConfigStore.setState({
      apiKeys: {
        openrouter: "",
        "google-ai-studio": "",
        ollama: "",
        openai: "",
        anthropic: "",
      },
      embeddingApiKey: "",
    });

    await useAiConfigStore.getState().setApiKey("openai", "sk-live-openai-secret");
    await useAiConfigStore.getState().setEmbeddingApiKey("pa-live-voyage-secret");
    await useAiConfigStore.getState().setLlmModel("gpt-5.4");

    // Verify in-memory state is updated immediately
    expect(useAiConfigStore.getState().apiKeys.openai).toBe("sk-live-openai-secret");
    expect(useAiConfigStore.getState().embeddingApiKey).toBe("pa-live-voyage-secret");

    // Verify encrypted Rust commands were invoked
    expect(mockTauriInvoke).toHaveBeenCalledWith("save_api_secret", {
      slot: "openai",
      value: "sk-live-openai-secret",
    });
    expect(mockTauriInvoke).toHaveBeenCalledWith("save_api_secret", {
      slot: "embedding",
      value: "pa-live-voyage-secret",
    });

    // Verify localStorage contains zero plaintext secrets
    expect(localStorage.length).toBe(0);
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)!;
      const val = localStorage.getItem(k) ?? "";
      expect(val).not.toContain("sk-live-openai-secret");
      expect(val).not.toContain("pa-live-voyage-secret");
    }

    // Verify settings.json (tauri-plugin-store) contains non-secret settings ONLY, no apiKeys/embeddingApiKey
    const persistedSettings = mockTauriStoreMap
      .get("settings.json")
      ?.get("ai_settings") as Record<string, unknown> | undefined;
    expect(persistedSettings).toBeDefined();
    expect(persistedSettings?.llmModel).toBe("gpt-5.4");
    expect(persistedSettings).not.toHaveProperty("apiKeys");
    expect(persistedSettings).not.toHaveProperty("embeddingApiKey");
    const serialized = JSON.stringify(persistedSettings);
    expect(serialized).not.toContain("sk-live-openai-secret");
    expect(serialized).not.toContain("pa-live-voyage-secret");

    // Verify clearing keys deletes the slots via delete_api_secret
    await useAiConfigStore.getState().setApiKey("openai", "");
    await useAiConfigStore.getState().setEmbeddingApiKey("   ");
    expect(mockTauriInvoke).toHaveBeenCalledWith("delete_api_secret", {
      slot: "openai",
    });
    expect(mockTauriInvoke).toHaveBeenCalledWith("delete_api_secret", {
      slot: "embedding",
    });
    expect(mockSecretsBackend.apiKeys.openai).toBeUndefined();
    expect(mockSecretsBackend.embeddingApiKey).toBe("");
  });

  it("migrates legacy plaintext API keys from localStorage, settings.json, and SQLite, then scrubs all plaintext copies", async () => {
    mockSecretsBackend.apiKeys = {};
    mockSecretsBackend.embeddingApiKey = "";
    useAiConfigStore.setState({
      apiKeys: {
        openrouter: "",
        "google-ai-studio": "",
        ollama: "",
        openai: "",
        anthropic: "",
      },
      embeddingApiKey: "",
      secretsHydrated: false,
    });

    // Seed legacy plaintext keys in localStorage
    localStorage.setItem(
      "ai_settings",
      JSON.stringify({
        state: {
          llmProvider: "openai",
          apiKeys: {
            openai: "sk-legacy-localstorage-openai",
          },
          embeddingApiKey: "pa-legacy-localstorage-embed",
        },
        version: 0,
      }),
    );

    // Seed legacy plaintext keys in settings.json
    const settingsBucket = new Map<string, unknown>();
    settingsBucket.set("ai_settings", {
      llmProvider: "anthropic",
      apiKeys: {
        anthropic: "sk-legacy-settings-anthropic",
      },
      embeddingApiKey: "",
    });
    mockTauriStoreMap.set("settings.json", settingsBucket);

    // Seed legacy plaintext key in SQLite
    mockDatabase.legacySecrets = {
      apiKeys: {
        openrouter: "sk-legacy-sqlite-openrouter",
      },
      embeddingApiKey: "",
    };

    // Rehydrate non-secret settings from settings.json (verifying merge strips plaintext keys)
    await useAiConfigStore.persist.rehydrate();
    expect(useAiConfigStore.getState().llmProvider).toBe("anthropic");
    expect(useAiConfigStore.getState().apiKeys.anthropic).toBe("");

    await useAiConfigStore.getState().hydrateSecrets();

    // All three legacy sources were migrated into Rust encrypted store and hydrated in memory
    const state = useAiConfigStore.getState();
    expect(state.secretsHydrated).toBe(true);
    expect(state.apiKeys.openai).toBe("sk-legacy-localstorage-openai");
    expect(state.apiKeys.anthropic).toBe("sk-legacy-settings-anthropic");
    expect(state.apiKeys.openrouter).toBe("sk-legacy-sqlite-openrouter");
    expect(state.embeddingApiKey).toBe("pa-legacy-localstorage-embed");

    // Plaintext localStorage was scrubbed while keeping non-secret fields intact
    const scrubbedLocal = localStorage.getItem("ai_settings") ?? "";
    expect(scrubbedLocal).not.toContain("sk-legacy-localstorage-openai");
    expect(scrubbedLocal).not.toContain("pa-legacy-localstorage-embed");
    expect(scrubbedLocal).not.toContain("apiKeys");
    expect(scrubbedLocal).not.toContain("embeddingApiKey");

    // Plaintext settings.json was scrubbed while keeping non-secret fields intact
    const scrubbedSettings = mockTauriStoreMap
      .get("settings.json")
      ?.get("ai_settings") as Record<string, unknown>;
    expect(scrubbedSettings.llmProvider).toBe("anthropic");
    expect(scrubbedSettings).not.toHaveProperty("apiKeys");
    expect(scrubbedSettings).not.toHaveProperty("embeddingApiKey");

    // SQLite legacy secrets were consumed & scrubbed
    expect(mockDatabase.legacySecrets).toBeNull();
  });
});

describe("In-app auto-updater & dirty document safety guard", () => {
  it("guards Update & Restart with ConfirmModal when annotations are unsaved, and installs + relaunches after confirmation", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn(
      async (onEvent?: (event: any) => void) => {
        onEvent?.({ event: "Started", data: { contentLength: 1000 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 600 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 400 } });
        onEvent?.({ event: "Finished" });
      },
    );
    const close = vi.fn(async () => {});

    mockUpdaterCheck.mockResolvedValueOnce({
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: "2026-11-20T00:00:00Z",
      body: "- Encrypted API key storage\n- Faster PDF rendering",
      downloadAndInstall,
      close,
    });

    useDocumentStore.getState().openDocument(TEST_DOC);
    render(<App />);

    await waitFor(() => {
      expect(useAnnotationStore.getState().docId).toBe(TEST_DOC.id);
    });

    // Make document dirty with an unsaved annotation
    act(() => {
      useAnnotationStore.getState().addAnnotation({
        id: "annot-update-dirty-1",
        pageNumber: 1,
        toolType: "popup_note",
        color: "#0284C7",
        comment: "Important unsaved note",
        x: 0.25,
        y: 0.35,
        createdAt: "2026-11-20T00:00:00Z",
      });
    });
    expect(useDocumentStore.getState().isDirty).toBe(true);

    // Manually trigger "Check for updates" in Titlebar
    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    // Update modal opens with version and release notes
    expect(await screen.findByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("v0.2.0")).toBeInTheDocument();
    expect(screen.getByText(/Encrypted API key storage/i)).toBeInTheDocument();

    // Clicking "Update & Restart" while dirty MUST show ConfirmModal and NOT relaunch yet
    await user.click(screen.getByRole("button", { name: "Update & Restart" }));
    expect(await screen.findByText("Unsaved annotations")).toBeInTheDocument();
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(mockProcessRelaunch).not.toHaveBeenCalled();

    // Canceling ConfirmModal keeps app running without updating
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
    });
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(mockProcessRelaunch).not.toHaveBeenCalled();

    // Confirming "Discard & update" installs update and calls relaunch()
    await user.click(screen.getByRole("button", { name: "Update & Restart" }));
    expect(await screen.findByText("Unsaved annotations")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard & update" }));

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(mockProcessRelaunch).toHaveBeenCalledTimes(1);
    });
  });
});
