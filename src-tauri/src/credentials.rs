//! Saved SSH secrets in the Windows Credential Manager ("Windows 자격 증명").
//!
//! Secrets are written from the frontend but only ever read here in Rust (at
//! connect time), so a saved password never travels back into the webview.

#[cfg(windows)]
mod win {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    const CRED_TYPE_GENERIC: u32 = 1;
    /// Kept for this Windows user on this PC (not roamed).
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: i32 = 1168;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    pub fn write(target: &str, user: &str, secret: &str) -> Result<(), String> {
        let mut target_w = wide(target);
        let mut user_w = wide(user);
        let mut blob = secret.as_bytes().to_vec();
        let cred = CredentialW {
            flags: 0,
            kind: CRED_TYPE_GENERIC,
            target_name: target_w.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: std::ptr::null_mut(),
            target_alias: std::ptr::null_mut(),
            user_name: user_w.as_mut_ptr(),
        };
        // SAFETY: every pointer in `cred` refers to a buffer that outlives the call.
        if unsafe { CredWriteW(&cred, 0) } == 0 {
            return Err(format!("cannot save to Credential Manager: {}", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    pub fn read(target: &str) -> Result<Option<String>, String> {
        let target_w = wide(target);
        let mut cred: *mut CredentialW = std::ptr::null_mut();
        // SAFETY: on success Windows hands us a buffer we must release with CredFree.
        if unsafe { CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred) } == 0 {
            let err = std::io::Error::last_os_error();
            return if err.raw_os_error() == Some(ERROR_NOT_FOUND) {
                Ok(None)
            } else {
                Err(format!("cannot read from Credential Manager: {err}"))
            };
        }
        // SAFETY: `cred` is valid until CredFree; the blob is `blob_size` bytes long.
        let secret = unsafe {
            let c = &*cred;
            let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize);
            let s = String::from_utf8_lossy(bytes).into_owned();
            CredFree(cred.cast());
            s
        };
        Ok(Some(secret))
    }

    pub fn delete(target: &str) -> Result<(), String> {
        let target_w = wide(target);
        // SAFETY: `target_w` is a NUL-terminated UTF-16 string that outlives the call.
        if unsafe { CredDeleteW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(ERROR_NOT_FOUND) {
                return Err(format!("cannot delete from Credential Manager: {err}"));
            }
        }
        Ok(())
    }
}

/// Which secret of a saved session.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Password,
    Passphrase,
}

/// Entry name shown in Credential Manager, e.g. `WLT/ssh/<session id>/password`.
fn target_name(session_id: &str, kind: SecretKind) -> String {
    let kind = match kind {
        SecretKind::Password => "password",
        SecretKind::Passphrase => "passphrase",
    };
    format!("WLT/ssh/{session_id}/{kind}")
}

pub fn read_secret(session_id: &str, kind: SecretKind) -> Result<Option<String>, String> {
    #[cfg(windows)]
    return win::read(&target_name(session_id, kind));
    #[cfg(not(windows))]
    return Ok(None);
}

/// Saves `secret` for a session (empty = delete). `label` (user@host) is shown as the user name.
#[tauri::command]
pub async fn credential_set(session_id: String, kind: SecretKind, secret: String, label: String) -> Result<(), String> {
    let target = target_name(&session_id, kind);
    #[cfg(windows)]
    return if secret.is_empty() { win::delete(&target) } else { win::write(&target, &label, &secret) };
    #[cfg(not(windows))]
    return Err(format!("Credential Manager is only available on Windows ({target}, {label}, {})", secret.len()));
}

/// Deletes every secret of a session (when the session itself is deleted).
#[tauri::command]
pub async fn credential_delete(session_id: String) -> Result<(), String> {
    #[cfg(windows)]
    for kind in [SecretKind::Password, SecretKind::Passphrase] {
        win::delete(&target_name(&session_id, kind))?;
    }
    #[cfg(not(windows))]
    let _ = session_id;
    Ok(())
}

/// Copies a session's secrets to another session (session "duplicate").
#[tauri::command]
pub async fn credential_copy(from: String, to: String, label: String) -> Result<(), String> {
    #[cfg(windows)]
    for kind in [SecretKind::Password, SecretKind::Passphrase] {
        if let Some(secret) = read_secret(&from, kind)? {
            win::write(&target_name(&to, kind), &label, &secret)?;
        }
    }
    #[cfg(not(windows))]
    let _ = (from, to, label);
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let id = format!("unit-test-{}", std::process::id());
        let target = target_name(&id, SecretKind::Password);
        win::write(&target, "tester@example", "p@ss 한글").unwrap();
        assert_eq!(read_secret(&id, SecretKind::Password).unwrap().as_deref(), Some("p@ss 한글"));
        win::delete(&target).unwrap();
        assert_eq!(read_secret(&id, SecretKind::Password).unwrap(), None);
        win::delete(&target).unwrap(); // deleting a missing entry is fine
    }
}
