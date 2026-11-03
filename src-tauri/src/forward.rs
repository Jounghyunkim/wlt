//! SSH port forwarding over a terminal tab's connection.
//!
//! - Local (`ssh -L`): listen on this PC, tunnel each connection to `dest` as seen from the server.
//! - Remote (`ssh -R`): the server listens, connections come back and go to `dest` as seen from this PC.
//! - Dynamic (`ssh -D`): a SOCKS5 proxy on this PC; every connection goes out through the server.

use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::async_runtime::JoinHandle;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::ssh::SshHandle;
use crate::state::emit_output;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ForwardKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForward {
    pub kind: ForwardKind,
    /// Where to listen: on this PC (local/dynamic) or on the server (remote).
    #[serde(default)]
    pub bind_host: String,
    pub bind_port: u16,
    /// Where connections go (unused for dynamic).
    #[serde(default)]
    pub dest_host: String,
    #[serde(default)]
    pub dest_port: u16,
}

/// Remote forwards by server port → local destination; looked up by the SSH
/// handler when the server opens a `forwarded-tcpip` channel.
pub type RemoteForwards = Arc<Mutex<HashMap<u32, (String, u16)>>>;

fn or_default(s: &str, default: &str) -> String {
    if s.trim().is_empty() { default.to_string() } else { s.trim().to_string() }
}

fn describe(f: &PortForward, bind: &str, dest: &str) -> String {
    match f.kind {
        ForwardKind::Local => format!("L {bind}:{} → {dest}:{} (서버 기준)", f.bind_port, f.dest_port),
        ForwardKind::Remote => format!("R 서버 {bind}:{} → {dest}:{} (이 PC 기준)", f.bind_port, f.dest_port),
        ForwardKind::Dynamic => format!("D SOCKS5 {bind}:{}", f.bind_port),
    }
}

/// Starts every forward; failures (port in use, server refusal) are reported in
/// the terminal and don't stop the session. Returns the listener tasks, which
/// the caller aborts when the connection ends.
pub async fn start(
    app: &AppHandle,
    id: &str,
    handle: &Arc<SshHandle>,
    forwards: &[PortForward],
    remote: &RemoteForwards,
) -> Vec<JoinHandle<()>> {
    let mut tasks = Vec::new();
    for f in forwards {
        let bind = or_default(&f.bind_host, if f.kind == ForwardKind::Remote { "localhost" } else { "127.0.0.1" });
        let dest = or_default(&f.dest_host, "127.0.0.1");
        let label = describe(f, &bind, &dest);
        let result = match f.kind {
            ForwardKind::Local | ForwardKind::Dynamic => match TcpListener::bind((bind.as_str(), f.bind_port)).await {
                Ok(listener) => {
                    tasks.push(tauri::async_runtime::spawn(accept_loop(
                        listener,
                        handle.clone(),
                        f.kind,
                        dest.clone(),
                        f.dest_port,
                    )));
                    Ok(())
                }
                Err(e) => Err(e.to_string()),
            },
            ForwardKind::Remote => match handle.tcpip_forward(bind.clone(), u32::from(f.bind_port)).await {
                Ok(port) => {
                    // The server only reports a port when it picked one (bind port 0).
                    let port = if port == 0 { u32::from(f.bind_port) } else { port };
                    remote.lock().unwrap().insert(port, (dest.clone(), f.dest_port));
                    Ok(())
                }
                Err(e) => Err(format!("server refused: {e}")),
            },
        };
        let line = match result {
            Ok(()) => format!("\x1b[36m⇄ 포트 포워딩 {label}\x1b[0m\r\n"),
            Err(e) => format!("\x1b[33m⚠ 포트 포워딩 실패 {label}: {e}\x1b[0m\r\n"),
        };
        emit_output(app, id, line);
    }
    tasks
}

async fn accept_loop(listener: TcpListener, handle: Arc<SshHandle>, kind: ForwardKind, dest: String, dest_port: u16) {
    while let Ok((socket, peer)) = listener.accept().await {
        let handle = handle.clone();
        let dest = dest.clone();
        tauri::async_runtime::spawn(async move {
            let _ = match kind {
                ForwardKind::Dynamic => socks5(&handle, socket, peer).await,
                _ => tunnel(&handle, socket, peer, dest, dest_port).await,
            };
        });
    }
}

/// Opens a `direct-tcpip` channel to `host:port` and pipes `socket` through it.
async fn tunnel(handle: &SshHandle, mut socket: TcpStream, peer: SocketAddr, host: String, port: u16) -> Result<(), String> {
    let channel = handle
        .channel_open_direct_tcpip(host, u32::from(port), peer.ip().to_string(), u32::from(peer.port()))
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut socket, &mut stream).await.map(drop).map_err(|e| e.to_string())
}

/// Minimal SOCKS5 server (RFC 1928): no authentication, CONNECT only.
async fn socks5(handle: &SshHandle, mut socket: TcpStream, peer: SocketAddr) -> Result<(), String> {
    let io = |e: std::io::Error| e.to_string();
    // Greeting: VER NMETHODS METHODS…
    let mut head = [0u8; 2];
    socket.read_exact(&mut head).await.map_err(io)?;
    if head[0] != 5 {
        return Err("not a SOCKS5 client".into());
    }
    let mut methods = vec![0u8; usize::from(head[1])];
    socket.read_exact(&mut methods).await.map_err(io)?;
    if !methods.contains(&0) {
        socket.write_all(&[5, 0xff]).await.map_err(io)?;
        return Err("client requires SOCKS authentication".into());
    }
    socket.write_all(&[5, 0]).await.map_err(io)?;

    // Request: VER CMD RSV ATYP DST.ADDR DST.PORT
    let reply = |code: u8| [5, code, 0, 1, 0, 0, 0, 0, 0, 0];
    let mut req = [0u8; 4];
    socket.read_exact(&mut req).await.map_err(io)?;
    if req[1] != 1 {
        socket.write_all(&reply(7)).await.map_err(io)?; // command not supported
        return Err("only CONNECT is supported".into());
    }
    let host = match req[3] {
        1 => {
            let mut a = [0u8; 4];
            socket.read_exact(&mut a).await.map_err(io)?;
            Ipv4Addr::from(a).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            socket.read_exact(&mut len).await.map_err(io)?;
            let mut name = vec![0u8; usize::from(len[0])];
            socket.read_exact(&mut name).await.map_err(io)?;
            String::from_utf8_lossy(&name).into_owned()
        }
        4 => {
            let mut a = [0u8; 16];
            socket.read_exact(&mut a).await.map_err(io)?;
            Ipv6Addr::from(a).to_string()
        }
        _ => {
            socket.write_all(&reply(8)).await.map_err(io)?; // address type not supported
            return Err("unsupported address type".into());
        }
    };
    let mut port = [0u8; 2];
    socket.read_exact(&mut port).await.map_err(io)?;
    let port = u16::from_be_bytes(port);

    match handle
        .channel_open_direct_tcpip(host, u32::from(port), peer.ip().to_string(), u32::from(peer.port()))
        .await
    {
        Ok(channel) => {
            socket.write_all(&reply(0)).await.map_err(io)?;
            let mut stream = channel.into_stream();
            tokio::io::copy_bidirectional(&mut socket, &mut stream).await.map(drop).map_err(io)
        }
        Err(e) => {
            let _ = socket.write_all(&reply(5)).await; // connection refused
            Err(e.to_string())
        }
    }
}

/// Bridges a `forwarded-tcpip` channel opened by the server (remote forward) to its local destination.
pub fn accept_remote(channel: russh::Channel<russh::client::Msg>, dest: (String, u16)) {
    tauri::async_runtime::spawn(async move {
        if let Ok(mut socket) = TcpStream::connect((dest.0.as_str(), dest.1)).await {
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
        }
    });
}
