//! yaz as an MCP server.
//!
//! An agent can ask the editor what project is open, read a file from it, and
//! compile it — and a plugin can add tools of its own
//! ([ADR-0022](https://github.com/texyaz/yaz/blob/main/docs/adr/0022-mcp-and-tool-declaration.md)).
//!
//! # Why HTTP on loopback, and not stdio
//!
//! Most MCP servers are spawned by their client and talk over stdin. yaz
//! cannot be: it is a window somebody already has open, with a project already
//! loaded, and the whole point is to drive *that* — an agent spawning a second
//! copy would get an editor with nothing in it.
//!
//! So it listens, on `127.0.0.1` only. Not because loopback is a security
//! boundary by itself, but because binding anywhere else would put an editor
//! that can write to your disk on the network, and nothing about this feature
//! needs that.
//!
//! # And it is not open just because it is listening
//!
//! A token is generated when the server starts and every request must carry
//! it. Any local process can reach a loopback port — including a web page's
//! JavaScript, which is the case worth designing against — so the port alone
//! grants nothing.
//!
//! # The HTTP is hand-written, on purpose
//!
//! One method, one path, one content type. A framework would be a large
//! dependency and a much larger attack surface for a listener that accepts
//! exactly one shape of request, and refusing everything else is easier to
//! read here than to configure elsewhere.

pub mod protocol;
pub mod tools;

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::RwLock;

pub use tools::{Registry, Tool, ToolFuture, ToolHandler};

/// What can go wrong starting the server.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The port could not be bound — most often, something else has it.
    #[error("could not listen on {address}: {source}")]
    Listen {
        /// What was attempted.
        address: SocketAddr,
        /// Why it failed.
        source: std::io::Error,
    },
}

/// A running server.
#[derive(Debug)]
pub struct Server {
    /// Where it is listening, with the port the operating system chose.
    pub address: SocketAddr,
    /// The token every request must carry.
    pub token: String,
    registry: Arc<RwLock<Registry>>,
}

/// The largest request body accepted.
///
/// A tool call is a name and some arguments. A megabyte is already absurd for
/// that, and a bound means a malformed `Content-Length` cannot ask this process
/// to allocate the machine.
const MAX_BODY: usize = 1024 * 1024;

impl Server {
    /// Start listening.
    ///
    /// Port `0` lets the operating system choose, which is the right default:
    /// a fixed port is one more thing to collide, and the chosen one is
    /// reported back for the client's configuration anyway.
    pub async fn start(
        port: u16,
        name: String,
        version: String,
        registry: Arc<RwLock<Registry>>,
    ) -> Result<Self, Error> {
        let requested = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = TcpListener::bind(requested)
            .await
            .map_err(|source| Error::Listen {
                address: requested,
                source,
            })?;
        let address = listener.local_addr().unwrap_or(requested);
        let token = generate_token();

        let server = Self {
            address,
            token: token.clone(),
            registry: Arc::clone(&registry),
        };

        tokio::spawn(async move {
            tracing::info!(%address, "mcp server listening");
            loop {
                match listener.accept().await {
                    Ok((stream, peer)) => {
                        let registry = Arc::clone(&registry);
                        let token = token.clone();
                        let name = name.clone();
                        let version = version.clone();
                        tokio::spawn(async move {
                            if let Err(error) = serve(stream, registry, token, name, version).await
                            {
                                tracing::debug!(%peer, %error, "mcp connection ended");
                            }
                        });
                    }
                    Err(error) => {
                        tracing::warn!(%error, "mcp accept failed");
                        break;
                    }
                }
            }
        });

        Ok(server)
    }

    /// The tools an agent can currently reach.
    pub fn registry(&self) -> Arc<RwLock<Registry>> {
        Arc::clone(&self.registry)
    }
}

/// A token with enough entropy that guessing it is not a strategy.
///
/// Built from the system clock and the addresses of two fresh allocations,
/// hashed — which avoids a random-number dependency for a value that only has
/// to be unpredictable to another process on the same machine, not
/// cryptographically strong against an attacker who can grind at it. The
/// server is not reachable from off the machine, so there is nobody to grind.
fn generate_token() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut token = String::new();
    for round in 0..4u8 {
        let mut hasher = DefaultHasher::new();
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .hash(&mut hasher);
        round.hash(&mut hasher);
        let scratch = Box::new(round);
        (Box::into_raw(scratch) as usize).hash(&mut hasher);
        token.push_str(&format!("{:016x}", hasher.finish()));
    }
    token
}

/// Read one request, answer it, close.
///
/// One request per connection: HTTP keep-alive buys nothing for a client that
/// makes a call every few seconds, and not implementing it removes a whole
/// class of framing bug.
async fn serve(
    mut stream: TcpStream,
    registry: Arc<RwLock<Registry>>,
    token: String,
    name: String,
    version: String,
) -> std::io::Result<()> {
    let Some(request) = read_request(&mut stream).await? else {
        return respond(&mut stream, 400, &json!({ "error": "malformed request" })).await;
    };

    if request.token.as_deref() != Some(token.as_str()) {
        // No detail, deliberately: a wrong token and a missing one get the same
        // answer, so the reply says nothing about which.
        return respond(&mut stream, 401, &json!({ "error": "unauthorised" })).await;
    }

    let Ok(parsed) = serde_json::from_slice::<protocol::Request>(&request.body) else {
        return respond(&mut stream, 400, &json!({ "error": "not JSON-RPC" })).await;
    };

    // A notification expects no reply, and `notifications/initialized` is the
    // one every client sends.
    let Some(id) = parsed.id.clone() else {
        return respond(&mut stream, 202, &json!({})).await;
    };

    let response = dispatch(parsed, id, registry, &name, &version).await;
    let body = serde_json::to_value(&response).unwrap_or_else(|_| json!({}));
    respond(&mut stream, 200, &body).await
}

/// Answer one JSON-RPC request.
async fn dispatch(
    request: protocol::Request,
    id: Value,
    registry: Arc<RwLock<Registry>>,
    name: &str,
    version: &str,
) -> protocol::Response {
    match request.method.as_str() {
        "initialize" => protocol::Response::ok(id, protocol::initialize_result(name, version)),
        "tools/list" => {
            let tools = registry.read().await;
            protocol::Response::ok(id, tools.describe_all())
        }
        "tools/call" => {
            let Some(tool_name) = request.params.get("name").and_then(Value::as_str) else {
                return protocol::Response::failed(
                    id,
                    protocol::codes::INVALID_PARAMS,
                    "a tool call needs a name",
                );
            };
            let arguments = request
                .params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            // Cloned out of the registry before awaiting, so a tool that takes
            // a while does not hold the lock against `tools/list`.
            let tool = registry.read().await.get(tool_name).cloned();
            let Some(tool) = tool else {
                return protocol::Response::failed(
                    id,
                    protocol::codes::METHOD_NOT_FOUND,
                    format!("no tool called {tool_name}"),
                );
            };

            match tool.call(arguments).await {
                Ok(value) => protocol::Response::ok(id, protocol::tool_result(&value)),
                // A tool that ran and failed is a *result*, not a transport
                // error: the agent asked a reasonable question and got an
                // answer it can act on.
                Err(message) => protocol::Response::ok(id, protocol::tool_failure(&message)),
            }
        }
        other => protocol::Response::failed(
            id,
            protocol::codes::METHOD_NOT_FOUND,
            format!("yaz does not answer {other}"),
        ),
    }
}

/// What was read off the wire.
struct RawRequest {
    token: Option<String>,
    body: Vec<u8>,
}

/// Read headers and body far enough to answer.
///
/// Only what is needed: the bearer token and the body. Everything else about
/// the request is ignored rather than parsed, because parsing it would be
/// code that can be wrong about something nothing reads.
async fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<RawRequest>> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 2048];

    // Headers first, to the blank line.
    let header_end = loop {
        if let Some(at) = find_double_newline(&buffer) {
            break at;
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_BODY {
            return Ok(None);
        }
    };

    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut token = None;
    let mut length = 0_usize;
    for line in headers.lines().skip(1) {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        if key == "authorization" {
            token = value.strip_prefix("Bearer ").map(str::to_owned);
        } else if key == "content-length" {
            length = value.parse().unwrap_or(0);
        }
    }

    if length > MAX_BODY {
        return Ok(None);
    }

    let mut body = buffer[header_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);

    Ok(Some(RawRequest { token, body }))
}

/// Where the headers stop.
fn find_double_newline(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

/// Write a JSON response and close.
async fn respond(stream: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let payload = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&payload).await?;
    stream.flush().await?;
    Ok(())
}
