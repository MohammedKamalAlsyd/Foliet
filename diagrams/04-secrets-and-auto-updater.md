# 04 — Encrypted Secrets Vault & Signed Auto-Updater

This diagram illustrates how Foliet keeps API keys out of plaintext storage (`localStorage` / `settings.json` / SQLite) and how signed releases flow from GitHub Actions to the in-app updater with a dirty-document safety guard.

```mermaid
flowchart LR
    subgraph SecretsVault["Encrypted API Key Lifecycle (secrets.rs + aiConfigStore.ts)"]
        Startup["App.tsx Startup\nhydrateSecrets()"] --> Migrate["Scan legacy plaintext:\nlocalStorage, settings.json, SQLite"]
        Migrate -->|"Encrypt & scrub"| RustSec["secrets.rs\n(SecretsState)"]
        KeyInput["User types API key\n(masked type=password)"] -->|"Coalesced async IPC\nsave_api_secret / delete_api_secret"| RustSec

        Keyring[("OS Credential Manager\nWindows / macOS Keychain / Secret Service")] <-->|"Lazy 32-byte master key\n(headless fallback if unavailable)"| RustSec
        RustSec <-->|"AES-256-GCM\nFresh 12-byte OsRng nonce per write"| EncFile[("secrets.enc\napp_data_dir")]
        RustSec -->|"load_api_secrets()\nIn-memory Zustand state ONLY"| MemState["useAiConfigStore\n(apiKeys, embeddingApiKey)\n0 bytes persisted in JS storage"]
    end
```

```mermaid
sequenceDiagram
    autonumber
    participant Dev as "Release Tag Push (v*.*.*)"
    participant GHA as ".github/workflows/release.yml"
    participant GH as "GitHub Releases"
    participant App as "App.tsx + updater.ts"
    participant Doc as "documentStore.isDirty"
    participant Modal as "UpdateModal + ConfirmModal"

    Dev->>GHA: git push origin main --tags
    GHA->>GHA: Verify job: version:check + tsc + vitest
    GHA->>GHA: Matrix build: Windows x64, macOS arm64, Linux x64
    GHA->>GH: tauri-action (uploadUpdaterJson: true + Minisign .sig)
    Note over GH: Draft release created -> Publish release makes latest.json live

    alt Production Startup (import.meta.env.PROD)
        App->>GH: Silent checkForUpdates() -> GET releases/latest/download/latest.json
    else User clicks Titlebar "Check for updates"
        App->>GH: Manual checkForUpdates()
    end

    GH-->>App: Update metadata (version, release notes, Minisign signature)
    App->>Modal: Open UpdateModal

    Note over App,Modal: Dirty-Document Safety Guard
    App->>Doc: Check useDocumentStore.getState().isDirty
    alt Unsaved PDF annotations exist (isDirty == true)
        App->>Modal: Show ConfirmModal ("Discard & update" or "Cancel")
    end

    App->>GH: update.downloadAndInstall() (Started -> Progress -> Finished)
    App->>Doc: Re-check isDirty before relaunch()
    App->>App: tauri-plugin-process relaunch()
```
