use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tauri::State;

const ENVELOPE_VERSION: u8 = 1;
const MASTER_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEYRING_ACCOUNT: &str = "master-key";
const SECRETS_FILE_NAME: &str = "secrets.enc";
const FALLBACK_KEY_FILE_NAME: &str = "secrets.fallback.key";

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretPayload {
    #[serde(default)]
    pub api_keys: HashMap<String, String>,
    #[serde(default)]
    pub embedding_api_key: String,
}

impl fmt::Debug for SecretPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SecretPayload")
            .field("api_key_slots", &self.api_keys.len())
            .field("has_embedding_api_key", &!self.embedding_api_key.is_empty())
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
struct EncryptedEnvelope {
    version: u8,
    nonce: String,
    ciphertext: String,
}

enum SecretSlot {
    Embedding,
    LlmProvider(String),
}

fn parse_slot(slot: &str) -> Result<SecretSlot, String> {
    let trimmed = slot.trim();
    if trimmed.is_empty() {
        return Err("Secret slot name cannot be empty.".to_string());
    }
    match trimmed {
        "embedding" | "embeddingApiKey" | "embedding_api_key" => Ok(SecretSlot::Embedding),
        other => Ok(SecretSlot::LlmProvider(other.to_string())),
    }
}

pub fn derive_keyring_service_name(app_identifier: &str) -> String {
    let trimmed = app_identifier.trim();
    if trimmed.is_empty() {
        return "com.foliet.app".to_string();
    }
    if trimmed.contains('.') {
        trimmed.to_string()
    } else {
        format!("com.{}.app", trimmed)
    }
}

fn generate_random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    OsRng.fill_bytes(&mut buf);
    buf
}

fn decode_master_key(encoded: &str) -> Option<[u8; MASTER_KEY_LEN]> {
    let bytes = BASE64.decode(encoded.trim()).ok()?;
    if bytes.len() != MASTER_KEY_LEN {
        return None;
    }
    let mut key = [0u8; MASTER_KEY_LEN];
    key.copy_from_slice(&bytes);
    Some(key)
}

#[cfg(unix)]
fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create secrets directory: {}", e))?;
    }

    let tmp_path = path.with_extension("tmp");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp_path)
        .map_err(|e| format!("Failed to create temporary secrets file: {}", e))?;
    file.write_all(contents)
        .map_err(|e| format!("Failed to write temporary secrets file: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temporary secrets file: {}", e))?;
    drop(file);

    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to finalize secrets file: {}", e))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    use std::io::Write;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create secrets directory: {}", e))?;
    }

    let tmp_path = path.with_extension("tmp");
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| format!("Failed to create temporary secrets file: {}", e))?;
        file.write_all(contents)
            .map_err(|e| format!("Failed to write temporary secrets file: {}", e))?;
        let _ = file.sync_all();
    }

    if path.exists() {
        // On Windows, fs::rename fails if the target already exists.
        if let Err(_rename_err) = fs::rename(&tmp_path, path) {
            fs::write(path, contents)
                .map_err(|e| format!("Failed to update secrets file: {}", e))?;
            let _ = fs::remove_file(&tmp_path);
        }
    } else {
        fs::rename(&tmp_path, path)
            .map_err(|e| format!("Failed to finalize secrets file: {}", e))?;
    }
    Ok(())
}

pub fn encrypt_payload(
    payload: &SecretPayload,
    master_key: &[u8; MASTER_KEY_LEN],
) -> Result<Vec<u8>, String> {
    let plaintext = serde_json::to_vec(payload)
        .map_err(|e| format!("Failed to serialize secrets payload: {}", e))?;
    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|_| "Failed to initialize AES-256-GCM cipher.".to_string())?;
    let nonce_bytes = generate_random_bytes::<NONCE_LEN>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|_| "Failed to encrypt secrets payload.".to_string())?;

    let envelope = EncryptedEnvelope {
        version: ENVELOPE_VERSION,
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    };
    serde_json::to_vec(&envelope)
        .map_err(|e| format!("Failed to encode encrypted envelope: {}", e))
}

pub fn decrypt_payload(
    encrypted_bytes: &[u8],
    master_key: &[u8; MASTER_KEY_LEN],
) -> Result<SecretPayload, String> {
    let envelope: EncryptedEnvelope = serde_json::from_slice(encrypted_bytes)
        .map_err(|_| "Encrypted secrets file is malformed.".to_string())?;

    if envelope.version != ENVELOPE_VERSION {
        return Err(format!(
            "Unsupported encrypted secrets version: {}",
            envelope.version
        ));
    }

    let nonce_bytes = BASE64
        .decode(envelope.nonce.trim())
        .map_err(|_| "Encrypted secrets nonce is invalid.".to_string())?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("Encrypted secrets nonce has invalid length.".to_string());
    }

    let ciphertext = BASE64
        .decode(envelope.ciphertext.trim())
        .map_err(|_| "Encrypted secrets ciphertext is invalid.".to_string())?;

    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|_| "Failed to initialize AES-256-GCM cipher.".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "Failed to decrypt secrets (invalid key or tampered ciphertext).".to_string())?;

    serde_json::from_slice(&plaintext)
        .map_err(|_| "Decrypted secrets payload is malformed.".to_string())
}

struct SecretsInner {
    app_data_dir: PathBuf,
    service_name: String,
    cached_master_key: Option<[u8; MASTER_KEY_LEN]>,
    warned_keyring_fallback: bool,
}

impl SecretsInner {
    fn secrets_file_path(&self) -> PathBuf {
        self.app_data_dir.join(SECRETS_FILE_NAME)
    }

    fn fallback_key_path(&self) -> PathBuf {
        self.app_data_dir.join(FALLBACK_KEY_FILE_NAME)
    }

    fn log_keyring_warning_once(&mut self, reason: &str) {
        if !self.warned_keyring_fallback {
            self.warned_keyring_fallback = true;
            eprintln!(
                "[foliet::secrets] OS keyring unavailable ({}); falling back to local protected key storage.",
                reason
            );
        }
    }

    fn load_or_create_fallback_key(&mut self) -> [u8; MASTER_KEY_LEN] {
        let path = self.fallback_key_path();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Some(key) = decode_master_key(&raw) {
                return key;
            }
        }

        let key = generate_random_bytes::<MASTER_KEY_LEN>();
        let encoded = BASE64.encode(key);
        if let Err(err) = write_private_file(&path, encoded.as_bytes()) {
            eprintln!(
                "[foliet::secrets] Unable to persist fallback key ({}); using ephemeral session key.",
                err
            );
        }
        key
    }

    fn get_or_init_master_key(&mut self) -> [u8; MASTER_KEY_LEN] {
        if let Some(key) = self.cached_master_key {
            return key;
        }

        let key = match keyring::Entry::new(&self.service_name, KEYRING_ACCOUNT) {
            Ok(entry) => match entry.get_password() {
                Ok(encoded) => {
                    if let Some(key) = decode_master_key(&encoded) {
                        key
                    } else {
                        let fresh = generate_random_bytes::<MASTER_KEY_LEN>();
                        if let Err(err) = entry.set_password(&BASE64.encode(fresh)) {
                            self.log_keyring_warning_once(&err.to_string());
                            self.load_or_create_fallback_key()
                        } else {
                            fresh
                        }
                    }
                }
                Err(keyring::Error::NoEntry) => {
                    // If a fallback key already exists on disk (e.g. previous headless run),
                    // preserve compatibility when keyring write fails; otherwise create a new key in keyring.
                    let fresh = generate_random_bytes::<MASTER_KEY_LEN>();
                    match entry.set_password(&BASE64.encode(fresh)) {
                        Ok(()) => fresh,
                        Err(err) => {
                            self.log_keyring_warning_once(&err.to_string());
                            self.load_or_create_fallback_key()
                        }
                    }
                }
                Err(err) => {
                    self.log_keyring_warning_once(&err.to_string());
                    self.load_or_create_fallback_key()
                }
            },
            Err(err) => {
                self.log_keyring_warning_once(&err.to_string());
                self.load_or_create_fallback_key()
            }
        };

        self.cached_master_key = Some(key);
        key
    }

    fn load_payload(&mut self) -> Result<SecretPayload, String> {
        let path = self.secrets_file_path();
        if !path.exists() {
            return Ok(SecretPayload::default());
        }
        let bytes = fs::read(&path)
            .map_err(|e| format!("Failed to read encrypted secrets file: {}", e))?;
        let key = self.get_or_init_master_key();
        decrypt_payload(&bytes, &key)
    }

    fn save_payload(&mut self, payload: &SecretPayload) -> Result<(), String> {
        let key = self.get_or_init_master_key();
        let encrypted = encrypt_payload(payload, &key)?;
        write_private_file(&self.secrets_file_path(), &encrypted)
    }

    fn save_slot(&mut self, slot: &str, value: String) -> Result<(), String> {
        let parsed = parse_slot(slot)?;
        if value.trim().is_empty() {
            return self.delete_slot(slot);
        }

        let mut payload = self.load_payload().unwrap_or_default();
        match parsed {
            SecretSlot::Embedding => {
                payload.embedding_api_key = value;
            }
            SecretSlot::LlmProvider(provider) => {
                payload.api_keys.insert(provider, value);
            }
        }
        self.save_payload(&payload)
    }

    fn delete_slot(&mut self, slot: &str) -> Result<(), String> {
        let parsed = parse_slot(slot)?;
        if !self.secrets_file_path().exists() {
            return Ok(());
        }

        let mut payload = self.load_payload().unwrap_or_default();
        let changed = match parsed {
            SecretSlot::Embedding => {
                let had = !payload.embedding_api_key.is_empty();
                payload.embedding_api_key.clear();
                had
            }
            SecretSlot::LlmProvider(provider) => payload.api_keys.remove(&provider).is_some(),
        };

        if changed {
            self.save_payload(&payload)?;
        }
        Ok(())
    }
}

pub struct SecretsState {
    inner: Mutex<SecretsInner>,
}

impl SecretsState {
    pub fn init(app_data_dir: PathBuf, app_identifier: &str) -> Self {
        Self {
            inner: Mutex::new(SecretsInner {
                app_data_dir,
                service_name: derive_keyring_service_name(app_identifier),
                cached_master_key: None,
                warned_keyring_fallback: false,
            }),
        }
    }
}

#[tauri::command]
pub fn load_api_secrets(state: State<'_, SecretsState>) -> Result<SecretPayload, String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Secrets storage lock poisoned.".to_string())?;
    guard.load_payload()
}

#[tauri::command]
pub fn save_api_secret(
    state: State<'_, SecretsState>,
    slot: String,
    value: String,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Secrets storage lock poisoned.".to_string())?;
    guard.save_slot(&slot, value)
}

#[tauri::command]
pub fn delete_api_secret(state: State<'_, SecretsState>, slot: String) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Secrets storage lock poisoned.".to_string())?;
    guard.delete_slot(&slot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_payload() -> SecretPayload {
        let mut api_keys = HashMap::new();
        api_keys.insert("openrouter".to_string(), "sk-or-test-123456".to_string());
        api_keys.insert("openai".to_string(), "sk-openai-test-987654".to_string());
        SecretPayload {
            api_keys,
            embedding_api_key: "pa-voyage-secret-key".to_string(),
        }
    }

    fn temp_test_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("foliet_secrets_test_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trip_aes_256_gcm_encrypt_decrypt() {
        let key = generate_random_bytes::<MASTER_KEY_LEN>();
        let payload = sample_payload();

        let encrypted = encrypt_payload(&payload, &key).expect("encryption should succeed");
        let encrypted_str = String::from_utf8_lossy(&encrypted);
        assert!(
            !encrypted_str.contains("sk-or-test-123456"),
            "ciphertext must never contain plaintext API key"
        );
        assert!(
            !encrypted_str.contains("pa-voyage-secret-key"),
            "ciphertext must never contain plaintext embedding key"
        );

        let decrypted = decrypt_payload(&encrypted, &key).expect("decryption should succeed");
        assert_eq!(decrypted, payload);
    }

    #[test]
    fn wrong_key_is_rejected() {
        let key_a = generate_random_bytes::<MASTER_KEY_LEN>();
        let mut key_b = key_a;
        key_b[0] ^= 0xFF;

        let encrypted =
            encrypt_payload(&sample_payload(), &key_a).expect("encryption should succeed");
        let result = decrypt_payload(&encrypted, &key_b);
        assert!(result.is_err(), "decryption with a wrong key must fail");
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = generate_random_bytes::<MASTER_KEY_LEN>();
        let encrypted =
            encrypt_payload(&sample_payload(), &key).expect("encryption should succeed");

        let mut envelope: EncryptedEnvelope = serde_json::from_slice(&encrypted).unwrap();
        let mut raw_ct = BASE64.decode(&envelope.ciphertext).unwrap();
        raw_ct[0] ^= 0x01;
        envelope.ciphertext = BASE64.encode(raw_ct);
        let tampered = serde_json::to_vec(&envelope).unwrap();

        let result = decrypt_payload(&tampered, &key);
        assert!(result.is_err(), "tampered ciphertext must fail authentication");
    }

    #[test]
    fn tampered_nonce_is_rejected() {
        let key = generate_random_bytes::<MASTER_KEY_LEN>();
        let encrypted =
            encrypt_payload(&sample_payload(), &key).expect("encryption should succeed");

        let mut envelope: EncryptedEnvelope = serde_json::from_slice(&encrypted).unwrap();
        let mut raw_nonce = BASE64.decode(&envelope.nonce).unwrap();
        raw_nonce[0] ^= 0x80;
        envelope.nonce = BASE64.encode(raw_nonce);
        let tampered = serde_json::to_vec(&envelope).unwrap();

        let result = decrypt_payload(&tampered, &key);
        assert!(result.is_err(), "tampered nonce must fail authentication");
    }

    #[test]
    fn nonce_uniqueness_produces_different_ciphertexts_for_identical_saves() {
        let key = generate_random_bytes::<MASTER_KEY_LEN>();
        let payload = sample_payload();

        let first = encrypt_payload(&payload, &key).expect("first encrypt should succeed");
        let second = encrypt_payload(&payload, &key).expect("second encrypt should succeed");

        assert_ne!(
            first, second,
            "identical saves must produce different encrypted output"
        );

        let env_first: EncryptedEnvelope = serde_json::from_slice(&first).unwrap();
        let env_second: EncryptedEnvelope = serde_json::from_slice(&second).unwrap();
        assert_ne!(env_first.nonce, env_second.nonce, "nonces must be unique");
        assert_ne!(
            env_first.ciphertext, env_second.ciphertext,
            "ciphertexts must differ across identical saves"
        );
    }

    #[test]
    fn save_empty_value_deletes_slot_and_persists_encrypted_file() {
        let dir = temp_test_dir("slots");
        let mut inner = SecretsInner {
            app_data_dir: dir.clone(),
            service_name: "com.foliet.test".to_string(),
            cached_master_key: Some(generate_random_bytes::<MASTER_KEY_LEN>()),
            warned_keyring_fallback: false,
        };

        assert_eq!(inner.load_payload().unwrap(), SecretPayload::default());

        inner
            .save_slot("openai", "sk-secret-openai".to_string())
            .unwrap();
        inner
            .save_slot("embedding", "pa-secret-embed".to_string())
            .unwrap();

        let loaded = inner.load_payload().unwrap();
        assert_eq!(
            loaded.api_keys.get("openai").map(String::as_str),
            Some("sk-secret-openai")
        );
        assert_eq!(loaded.embedding_api_key, "pa-secret-embed");

        // Verify file on disk has no plaintext
        let on_disk = fs::read_to_string(dir.join(SECRETS_FILE_NAME)).unwrap();
        assert!(!on_disk.contains("sk-secret-openai"));
        assert!(!on_disk.contains("pa-secret-embed"));

        // Saving empty string deletes slot
        inner.save_slot("openai", "   ".to_string()).unwrap();
        let after_empty = inner.load_payload().unwrap();
        assert!(!after_empty.api_keys.contains_key("openai"));
        assert_eq!(after_empty.embedding_api_key, "pa-secret-embed");

        // Explicit delete_slot removes embedding key
        inner.delete_slot("embedding").unwrap();
        let after_delete = inner.load_payload().unwrap();
        assert!(after_delete.embedding_api_key.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn debug_impl_redacts_secret_values() {
        let payload = sample_payload();
        let debug_str = format!("{:?}", payload);
        assert!(!debug_str.contains("sk-or-test-123456"));
        assert!(!debug_str.contains("pa-voyage-secret-key"));
    }
}
