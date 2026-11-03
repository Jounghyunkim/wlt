use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, KeyboardInteractiveAuthResponse};
use russh::keys::{self, ssh_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use crate::credentials::{self, SecretKind};
use crate::files::{EditManager, SftpManager};
use crate::forward::{self, PortForward, RemoteForwards};
use crate::state::{emit_exit, emit_output, TerminalBackend, TerminalManager};
use crate::utf8::Utf8Decoder;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    Password,
    Key,
    /// Keys held by an SSH agent: Windows OpenSSH agent, then Pageant.
    Agent,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    /// Saved session id: a missing password / passphrase is read from the
    /// Windows Credential Manager under this id.
    pub session_id: Option<String>,
    #[serde(default)]
    pub forwards: Vec<PortForward>,
}

enum SshCommand {
    Data(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// Handle to a remote shell. All I/O happens on a dedicated async task; this
/// struct only forwards commands to it.
pub struct SshTerminal {
    tx: mpsc::UnboundedSender<SshCommand>,
}

impl TerminalBackend for SshTerminal {
    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.tx
            .send(SshCommand::Data(data.to_vec()))
            .map_err(|_| "ssh session is closed".to_string())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.tx
            .send(SshCommand::Resize(cols, rows))
            .map_err(|_| "ssh session is closed".to_string())
    }

    fn close(&self) {
        let _ = self.tx.send(SshCommand::Close);
    }
}

/// Live SSH connection; shared with the file explorer for SFTP channels.
pub(crate) type SshHandle = client::Handle<ClientHandler>;

/// Trust-on-first-use host key verification backed by an OpenSSH-format
/// known_hosts file in the app data directory.
pub(crate) struct ClientHandler {
    app: AppHandle,
    id: String,
    host: String,
    port: u16,
    known_hosts: PathBuf,
    remote_forwards: RemoteForwards,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    /// The server opened a channel for one of our remote (-R) forwards.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let dest = self.remote_forwards.lock().unwrap().get(&connected_port).cloned();
        match dest {
            Some(dest) => {
                reply.accept().await;
                forward::accept_remote(channel, dest);
            }
            None => drop(reply), // dropping rejects
        }
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Host certificates are pinned by their underlying public key.
        let cert_key;
        let server_public_key = match server_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key,
            PublicKeyOrCertificate::Certificate(cert) => {
                cert_key = ssh_key::PublicKey::new(cert.public_key().clone(), "");
                &cert_key
            }
        };
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256);
        match keys::check_known_hosts_path(&self.host, self.port, server_public_key, &self.known_hosts) {
            Ok(true) => Ok(true),
            Ok(false) => {
                keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    server_public_key,
                    &self.known_hosts,
                )?;
                emit_output(
                    &self.app,
                    &self.id,
                    format!(
                        "\x1b[33mWarning: permanently added '{}' ({}) to known hosts.\r\n  {}\x1b[0m\r\n",
                        self.host,
                        server_public_key.algorithm(),
                        fingerprint
                    ),
                );
                Ok(true)
            }
            Err(keys::Error::KeyChanged { line }) => {
                emit_output(
                    &self.app,
                    &self.id,
                    format!(
                        "\x1b[1;31m@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\x1b[0m\r\n\
                         Server key {} does not match line {} of {}\r\n\
                         Remove that line if the change is expected.\r\n",
                        fingerprint,
                        line,
                        self.known_hosts.display()
                    ),
                );
                Ok(false)
            }
            Err(e) => Err(e.into()),
        }
    }
}

pub async fn connect(
    app: AppHandle,
    id: String,
    cfg: SshConfig,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });
    let remote_forwards = RemoteForwards::default();
    let handler = ClientHandler {
        app: app.clone(),
        id: id.clone(),
        host: cfg.host.clone(),
        port: cfg.port,
        known_hosts: data_dir.join("known_hosts"),
        remote_forwards: remote_forwards.clone(),
    };

    emit_output(
        &app,
        &id,
        format!("Connecting to {}@{}:{} ...\r\n", cfg.username, cfg.host, cfg.port),
    );

    let mut handle = tokio::time::timeout(
        Duration::from_secs(15),
        client::connect(config, (cfg.host.as_str(), cfg.port), handler),
    )
    .await
    .map_err(|_| format!("connection to {}:{} timed out", cfg.host, cfg.port))?
    .map_err(|e| match e {
        russh::Error::UnknownKey => "host key verification failed".to_string(),
        e => format!("connection failed: {e}"),
    })?;

    authenticate(&mut handle, &cfg).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("failed to open channel: {e}"))?;
    channel
        .request_pty(false, "xterm-256color", cols.max(1) as u32, rows.max(1) as u32, 0, 0, &[])
        .await
        .map_err(|e| format!("pty request failed: {e}"))?;
    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("shell request failed: {e}"))?;

    let handle = Arc::new(handle);
    app.state::<SftpManager>().register(id.clone(), handle.clone());
    let forward_tasks = forward::start(&app, &id, &handle, &cfg.forwards, &remote_forwards).await;

    let (tx, rx) = mpsc::unbounded_channel();
    app.state::<TerminalManager>()
        .insert(id.clone(), Arc::new(SshTerminal { tx }));
    tauri::async_runtime::spawn(io_loop(app, id, handle, channel, rx, forward_tasks));
    Ok(())
}

async fn authenticate(
    handle: &mut client::Handle<ClientHandler>,
    cfg: &SshConfig,
) -> Result<(), String> {
    let user = cfg.username.as_str();
    match cfg.auth_method {
        AuthMethod::Password => {
            let password = match &cfg.password {
                Some(p) => p.clone(),
                None => saved_secret(cfg, SecretKind::Password)?.ok_or("no password (not entered and none saved)")?,
            };
            let res = handle
                .authenticate_password(user, &password)
                .await
                .map_err(|e| e.to_string())?;
            if res.success() {
                return Ok(());
            }
            // Many servers only allow "keyboard-interactive" for passwords.
            let mut resp = handle
                .authenticate_keyboard_interactive_start(user, None::<String>)
                .await
                .map_err(|e| e.to_string())?;
            for _ in 0..5 {
                match resp {
                    KeyboardInteractiveAuthResponse::Success => return Ok(()),
                    KeyboardInteractiveAuthResponse::Failure { .. } => break,
                    KeyboardInteractiveAuthResponse::InfoRequest { ref prompts, .. } => {
                        let answers = prompts.iter().map(|_| password.clone()).collect();
                        resp = handle
                            .authenticate_keyboard_interactive_respond(answers)
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            Err("authentication failed (password)".into())
        }
        AuthMethod::Key => {
            let path = expand_home(cfg.private_key_path.as_deref().unwrap_or_default());
            if !path.is_file() {
                return Err(format!("private key not found: {}", path.display()));
            }
            let saved = match &cfg.passphrase {
                Some(_) => None,
                None => saved_secret(cfg, SecretKind::Passphrase)?,
            };
            let passphrase = cfg.passphrase.as_deref().or(saved.as_deref()).filter(|p| !p.is_empty());
            let key = keys::load_secret_key(&path, passphrase)
                .map_err(|e| format!("cannot load private key: {e}"))?;
            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| e.to_string())?
                .flatten();
            let res = handle
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
                .await
                .map_err(|e| e.to_string())?;
            if res.success() {
                Ok(())
            } else {
                Err("authentication failed (public key)".into())
            }
        }
        AuthMethod::Agent => authenticate_with_agent(handle, user).await,
    }
}

fn saved_secret(cfg: &SshConfig, kind: SecretKind) -> Result<Option<String>, String> {
    match &cfg.session_id {
        Some(id) => credentials::read_secret(id, kind),
        None => Ok(None),
    }
}

/// Windows OpenSSH agent (the "ssh-agent" service) is tried first, then Pageant.
const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

async fn authenticate_with_agent(handle: &mut client::Handle<ClientHandler>, user: &str) -> Result<(), String> {
    let mut tried = Vec::new();
    #[cfg(windows)]
    {
        match keys::agent::client::AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE).await {
            Ok(agent) => match try_agent_keys(handle, user, agent).await? {
                0 => tried.push("OpenSSH agent: no keys loaded (ssh-add)".to_string()),
                _ => return Ok(()),
            },
            Err(_) => tried.push("OpenSSH agent: not running".to_string()),
        }
        match keys::agent::client::AgentClient::connect_pageant().await {
            Ok(agent) => match try_agent_keys(handle, user, agent).await? {
                0 => tried.push("Pageant: no keys loaded".to_string()),
                _ => return Ok(()),
            },
            Err(_) => tried.push("Pageant: not running".to_string()),
        }
    }
    if tried.is_empty() {
        tried.push("no SSH agent available".into());
    }
    Err(format!("authentication failed (agent) — {}", tried.join("; ")))
}

/// Offers every key the agent holds. Returns 0 when the agent has no keys,
/// 1 on success, or an error when keys exist but the server accepted none.
async fn try_agent_keys<S>(
    handle: &mut client::Handle<ClientHandler>,
    user: &str,
    mut agent: keys::agent::client::AgentClient<S>,
) -> Result<usize, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let identities = agent.request_identities().await.map_err(|e| format!("agent: {e}"))?;
    if identities.is_empty() {
        return Ok(0);
    }
    let hash_alg = handle.best_supported_rsa_hash().await.map_err(|e| e.to_string())?.flatten();
    for identity in &identities {
        let key = identity.public_key().into_owned();
        let res = handle
            .authenticate_publickey_with(user, key, hash_alg, &mut agent)
            .await
            .map_err(|e| format!("agent signing failed: {e}"))?;
        if res.success() {
            return Ok(1);
        }
    }
    Err(format!("authentication failed (agent): the server accepted none of the {} key(s)", identities.len()))
}

async fn io_loop(
    app: AppHandle,
    id: String,
    handle: Arc<SshHandle>,
    mut channel: russh::Channel<client::Msg>,
    mut rx: mpsc::UnboundedReceiver<SshCommand>,
    forward_tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
) {
    let mut decoder = Utf8Decoder::default();
    let mut exit_code: Option<i64> = None;
    let mut reason: Option<String> = None;

    loop {
        tokio::select! {
            msg = channel.wait() => match msg {
                Some(ChannelMsg::Data { ref data }) => {
                    emit_output(&app, &id, decoder.decode(data));
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    emit_output(&app, &id, decoder.decode(data));
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status as i64),
                Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                    reason = Some(format!("killed by signal {signal_name:?}"));
                }
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            },
            cmd = rx.recv() => match cmd {
                Some(SshCommand::Data(bytes)) => {
                    if let Err(e) = channel.data(&bytes[..]).await {
                        reason = Some(format!("write failed: {e}"));
                        break;
                    }
                }
                Some(SshCommand::Resize(cols, rows)) => {
                    let _ = channel.window_change(cols.max(1) as u32, rows.max(1) as u32, 0, 0).await;
                }
                Some(SshCommand::Close) | None => {
                    let _ = channel.close().await;
                    break;
                }
            },
        }
    }

    for task in forward_tasks {
        task.abort();
    }
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    app.state::<EditManager>().stop_conn(&app, &id);
    app.state::<SftpManager>().unregister(&id).await;
    app.state::<TerminalManager>().remove(&id);
    emit_exit(&app, &id, exit_code, reason);
}

fn expand_home(path: &str) -> PathBuf {
    let path = path.trim();
    if let Some(rest) = path.strip_prefix('~') {
        if let Ok(home) = std::env::var("USERPROFILE") {
            return PathBuf::from(home).join(rest.trim_start_matches(['/', '\\']));
        }
    }
    PathBuf::from(path)
}
