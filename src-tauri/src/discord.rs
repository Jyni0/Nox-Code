//! Discord Rich Presence over Discord's local IPC socket (no SDK needed):
//! `\\.\pipe\discord-ipc-N` on Windows, `$XDG_RUNTIME_DIR/discord-ipc-N` on
//! Linux / macOS. Each frame is `op: u32 LE, len: u32 LE, JSON`.
//!
//! The socket lives on its own thread so a Discord that stops answering
//! can't hang a command: every request waits at most a few seconds.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::Duration;

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;

trait Pipe: Read + Write + Send {}
impl<T: Read + Write + Send> Pipe for T {}

fn open_pipe() -> Result<Box<dyn Pipe>, String> {
    for i in 0..10 {
        #[cfg(windows)]
        {
            let path = format!(r"\\.\pipe\discord-ipc-{i}");
            if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open(&path) {
                return Ok(Box::new(f));
            }
        }
        #[cfg(unix)]
        {
            let base = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
                .iter()
                .find_map(|k| std::env::var(k).ok())
                .unwrap_or_else(|| "/tmp".into());
            // Plain, Flatpak and Snap installs.
            for dir in ["", "app/com.discordapp.Discord/", "snap.discord/"] {
                let path = format!("{}/{dir}discord-ipc-{i}", base.trim_end_matches('/'));
                if let Ok(s) = std::os::unix::net::UnixStream::connect(&path) {
                    return Ok(Box::new(s));
                }
            }
        }
    }
    Err("Discord is not running".into())
}

fn write_frame(p: &mut dyn Pipe, op: u32, body: &Value) -> Result<(), String> {
    let data = body.to_string().into_bytes();
    let mut buf = Vec::with_capacity(8 + data.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
    buf.extend_from_slice(&data);
    p.write_all(&buf).map_err(|e| e.to_string())?;
    p.flush().map_err(|e| e.to_string())
}

fn read_frame(p: &mut dyn Pipe) -> Result<(u32, Value), String> {
    let mut head = [0u8; 8];
    p.read_exact(&mut head).map_err(|e| e.to_string())?;
    let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err("Discord sent an oversized frame".into());
    }
    let mut body = vec![0u8; len];
    p.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

/// Discord's answer to a frame: an error message when it rejected it.
fn check(op: u32, reply: &Value) -> Result<(), String> {
    if op == OP_CLOSE || reply.get("evt").and_then(Value::as_str) == Some("ERROR") {
        let msg = reply
            .pointer("/data/message")
            .or_else(|| reply.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Discord refused the request");
        return Err(msg.to_string());
    }
    Ok(())
}

struct Conn {
    pipe: Box<dyn Pipe>,
    client_id: String,
}

fn connect(client_id: &str) -> Result<Conn, String> {
    let mut pipe = open_pipe()?;
    write_frame(pipe.as_mut(), OP_HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))?;
    let (op, reply) = read_frame(pipe.as_mut())?;
    check(op, &reply)?;
    Ok(Conn { pipe, client_id: client_id.to_string() })
}

static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn set_activity(conn: &mut Conn, activity: &Value) -> Result<(), String> {
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let frame = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": format!("nox-{nonce}"),
    });
    write_frame(conn.pipe.as_mut(), OP_FRAME, &frame)?;
    // Discord answers every command; read it so the pipe never fills up.
    let (op, reply) = read_frame(conn.pipe.as_mut())?;
    check(op, &reply)
}

enum Request {
    /// `None` clears the status.
    Set(String, Option<Value>),
    Close,
}

fn worker(rx: Receiver<(Request, Sender<Result<(), String>>)>) {
    let mut conn: Option<Conn> = None;
    for (req, reply) in rx {
        let result = match req {
            Request::Close => {
                if let Some(mut c) = conn.take() {
                    let _ = write_frame(c.pipe.as_mut(), OP_CLOSE, &json!({}));
                }
                Ok(())
            }
            Request::Set(client_id, activity) => {
                // A different application id needs a new handshake.
                if conn.as_ref().is_some_and(|c| c.client_id != client_id) {
                    conn = None;
                }
                let run = |conn: &mut Option<Conn>| -> Result<(), String> {
                    if conn.is_none() {
                        *conn = Some(connect(&client_id)?);
                    }
                    set_activity(conn.as_mut().unwrap(), activity.as_ref().unwrap_or(&Value::Null))
                };
                // Discord restarted since the last update: reconnect once.
                run(&mut conn).or_else(|_| {
                    conn = None;
                    run(&mut conn)
                })
            }
        };
        if result.is_err() {
            conn = None;
        }
        let _ = reply.send(result);
    }
}

type Job = (Request, Sender<Result<(), String>>);

pub struct Presence {
    tx: Mutex<Option<Sender<Job>>>,
}

impl Default for Presence {
    fn default() -> Self {
        Self { tx: Mutex::new(None) }
    }
}

impl Presence {
    fn send(&self, req: Request) -> Result<(), String> {
        let (reply_tx, reply_rx) = channel();
        let mut tx = self.tx.lock().map_err(|e| e.to_string())?;
        let sender = tx.get_or_insert_with(|| {
            let (tx, rx) = channel();
            std::thread::Builder::new().name("discord-ipc".into()).spawn(move || worker(rx)).expect("spawn discord thread");
            tx
        });
        if sender.send((req, reply_tx)).is_err() {
            *tx = None;
            return Err("Discord connection closed".into());
        }
        drop(tx);
        match reply_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(r) => r,
            Err(_) => {
                // Stuck on a Discord that stopped answering: start over next time.
                *self.tx.lock().map_err(|e| e.to_string())? = None;
                Err("Discord did not answer".into())
            }
        }
    }

    pub fn set(&self, client_id: String, activity: Option<Value>) -> Result<(), String> {
        if !client_id.chars().all(|c| c.is_ascii_digit()) || client_id.len() < 15 {
            return Err("The Discord Application ID is a long number (Developer Portal → your app → Application ID)".into());
        }
        self.send(Request::Set(client_id, activity))
    }

    pub fn close(&self) -> Result<(), String> {
        if self.tx.lock().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
        self.send(Request::Close)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_errors_are_read() {
        let mut buf = std::io::Cursor::new(Vec::new());
        write_frame(&mut buf, OP_FRAME, &json!({ "cmd": "SET_ACTIVITY" })).unwrap();
        let bytes = buf.get_ref().clone();
        assert_eq!(&bytes[0..4], &1u32.to_le_bytes());
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize, bytes.len() - 8);
        buf.set_position(0);
        let (op, body) = read_frame(&mut buf).unwrap();
        assert_eq!((op, body["cmd"].as_str()), (OP_FRAME, Some("SET_ACTIVITY")));

        assert_eq!(check(OP_CLOSE, &json!({ "code": 4000, "message": "Invalid Client ID" })), Err("Invalid Client ID".into()));
        assert_eq!(check(OP_FRAME, &json!({ "evt": "ERROR", "data": { "message": "bad activity" } })), Err("bad activity".into()));
        assert!(check(OP_FRAME, &json!({ "evt": null, "cmd": "SET_ACTIVITY" })).is_ok());
        assert!(Presence::default().set("123".into(), None).is_err());
    }
}
