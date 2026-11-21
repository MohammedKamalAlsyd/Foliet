# Publishing Foliet to the Microsoft Store (MSIX)

Foliet includes an automated Windows x64 **MSIX** packaging pipeline for submitting to the **Microsoft Store**. When distributed through the Microsoft Store, Microsoft reviews and signs the MSIX package with its trusted Store certificate—eliminating Windows Defender SmartScreen `"Unknown publisher"` warnings for users at **$0 cost**.

---

## 1. Free Microsoft Partner Center Registration ($0)

1. Go to [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com) and register an **Individual developer account** (no registration fee or credit card required; verified via government-issued ID and selfie).
2. In **Microsoft Partner Center → Apps and games**, click **New product → MSIX or PWA app** and reserve the name **Foliet**.
3. Open **Product management → Product Identity** and copy these three exact values:
   - `Package/Identity/Name` (e.g. `12345YourPublisher.Foliet`)
   - `Package/Identity/Publisher` (e.g. `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`)
   - `Package/Properties/PublisherDisplayName` (e.g. `Mohammed Kamal Alsyd`)

---

## 2. Configure GitHub Actions Secrets / Variables

In your GitHub repository, open **Settings → Secrets and variables → Actions** and add:

| Name | Example Value |
| :--- | :--- |
| `MSIX_IDENTITY_NAME` | `12345YourPublisher.Foliet` |
| `MSIX_PUBLISHER` | `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX` |
| `MSIX_PUBLISHER_DISPLAY_NAME` | `Mohammed Kamal Alsyd` |

*(Works whether added under **Secrets** or **Variables**.)*

---

## 3. Build via GitHub Actions (Recommended)

Every release tag push (`v*.*.*`)—or manual **Actions → Release Foliet → Run workflow** with `Build Windows Microsoft Store package (MSIX)` checked—runs the `build-msix` job on `windows-latest`:

1. Compiles Foliet with `VITE_STORE_BUILD=true`, which automatically disables the external GitHub self-updater in `src/App.tsx` (required by Microsoft Store Policy 10.2.7 so updates are managed by the Microsoft Store).
2. Packages `foliet.exe`, sibling runtime DLLs, exact-dimension Store PNG assets (`src-tauri/msix/Assets/`), and rendered `AppxManifest.xml` (including `.pdf` file type association) using Windows SDK `MakeAppx.exe`.
3. Uploads the finished unsigned **`windows-msix-store-package`** artifact (`foliet_<version>_x64.msix`).

Download that `.msix` artifact from the GitHub Actions run and upload it directly under **Packages** in your Microsoft Partner Center submission—Microsoft signs it automatically upon certification.

---

## 4. Build Locally on Windows

Requires the Windows 10/11 SDK (`MakeAppx.exe` in `C:\Program Files (x86)\Windows Kits\10\bin\*\x64\`).

```powershell
$env:VITE_STORE_BUILD = "true"
$env:MSIX_IDENTITY_NAME = "12345YourPublisher.Foliet"
$env:MSIX_PUBLISHER = "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
$env:MSIX_PUBLISHER_DISPLAY_NAME = "Mohammed Kamal Alsyd"

pnpm tauri build --no-bundle
pnpm run msix:build
```

Output package:
`src-tauri/target/release/bundle/msix/foliet_<version>_x64.msix`

---

## Key Files

- `src-tauri/msix/AppxManifest.template.xml` — Desktop Bridge (`runFullTrust`) manifest template with `.pdf` file association
- `src-tauri/msix/Assets/` — Store-compliant visual assets (`StoreLogo.png` 50×50, `Square44x44Logo.png` 44×44, `Square150x150Logo.png` 150×150, `Wide310x150Logo.png` 310×150)
- `scripts/build-msix.mjs` — Node.js staging & `MakeAppx.exe` packager
- `.github/workflows/release.yml` — `build-msix` GitHub Actions job
