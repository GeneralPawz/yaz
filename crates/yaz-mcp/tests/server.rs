//! The server, spoken to over a real socket.
//!
//! Over a socket rather than by calling `dispatch` directly, because the HTTP
//! framing is hand-written and that is exactly the part that can be quietly
//! wrong. A test that skipped the wire would pass for a server no client can
//! talk to.

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use yaz_mcp::{Registry, Server, Tool};

/// A registry with one tool that echoes, and one that always fails.
fn registry() -> Arc<RwLock<Registry>> {
    let mut registry = Registry::new();

    registry.insert(Tool::new(
        "echo",
        "Return whatever it is given.",
        json!({ "type": "object", "properties": { "text": { "type": "string" } } }),
        Arc::new(|arguments: Value| Box::pin(async move { Ok(arguments) })),
    ));

    registry.insert(
        Tool::new(
            "explode",
            "Always fails.",
            json!({ "type": "object" }),
            Arc::new(|_| Box::pin(async move { Err("it exploded".to_owned()) })),
        )
        .from_plugin("com.example.demo", "explode"),
    );

    Arc::new(RwLock::new(registry))
}

/// Send one request and read the whole reply.
async fn call(server: &Server, token: &str, body: Value) -> (u16, Value) {
    let mut stream = TcpStream::connect(server.address)
        .await
        .expect("the server accepts connections");
    let payload = serde_json::to_vec(&body).expect("serialisable");
    let request = format!(
        "POST / HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        payload.len()
    );
    stream.write_all(request.as_bytes()).await.expect("write");
    stream.write_all(&payload).await.expect("write");

    let mut reply = Vec::new();
    stream.read_to_end(&mut reply).await.expect("read");
    let text = String::from_utf8_lossy(&reply).to_string();

    let status: u16 = text
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .expect("a status line");
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("");
    (status, serde_json::from_str(body).unwrap_or(Value::Null))
}

async fn started() -> Server {
    Server::start(0, "yaz".to_owned(), "0.2.0".to_owned(), registry())
        .await
        .expect("it binds a loopback port")
}

#[tokio::test]
async fn binds_loopback_only() {
    // Not because loopback is a boundary by itself, but because binding
    // anywhere else would put an editor that can write to the disk on the
    // network for no reason.
    let server = started().await;
    assert!(server.address.ip().is_loopback());
}

#[tokio::test]
async fn refuses_a_request_without_the_token() {
    let server = started().await;
    let (status, _) = call(
        &server,
        "not-the-token",
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list"
        }),
    )
    .await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn answers_initialize_with_a_protocol_version() {
    let server = started().await;
    let token = server.token.clone();
    let (status, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize"
        }),
    )
    .await;

    assert_eq!(status, 200);
    assert_eq!(
        body["result"]["protocolVersion"],
        yaz_mcp::protocol::PROTOCOL_VERSION
    );
    assert_eq!(body["result"]["serverInfo"]["name"], "yaz");
}

#[tokio::test]
async fn lists_the_tools_it_has() {
    let server = started().await;
    let token = server.token.clone();
    let (_, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/list"
        }),
    )
    .await;

    let tools = body["result"]["tools"].as_array().expect("a list");
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    // A plugin's tool is namespaced by the last segment of its id, so two
    // plugins may both provide `explode` without knowing about each other.
    assert_eq!(names, vec!["demo.explode", "echo"]);
}

#[tokio::test]
async fn calls_a_tool_and_returns_what_it_said() {
    let server = started().await;
    let token = server.token.clone();
    let (_, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "echo", "arguments": { "text": "hallo" } }
        }),
    )
    .await;

    let text = body["result"]["content"][0]["text"].as_str().expect("text");
    assert!(text.contains("hallo"));
    assert_eq!(body["result"]["isError"], false);
}

#[tokio::test]
async fn a_failing_tool_is_a_result_and_not_a_transport_error() {
    // The agent asked a reasonable question and got an answer it can act on.
    // Reporting it as a JSON-RPC error would tell the agent the *call* was
    // malformed, which it was not.
    let server = started().await;
    let token = server.token.clone();
    let (status, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "demo.explode", "arguments": {} }
        }),
    )
    .await;

    assert_eq!(status, 200);
    assert!(body["error"].is_null());
    assert_eq!(body["result"]["isError"], true);
    assert!(
        body["result"]["content"][0]["text"]
            .as_str()
            .expect("text")
            .contains("exploded")
    );
}

#[tokio::test]
async fn an_unknown_tool_is_a_transport_error() {
    // This one *is* the caller's mistake: it named something that does not
    // exist, which is a different thing from a tool that ran and failed.
    let server = started().await;
    let token = server.token.clone();
    let (_, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": { "name": "nonexistent", "arguments": {} }
        }),
    )
    .await;

    assert_eq!(body["error"]["code"], -32601);
}

#[tokio::test]
async fn an_unknown_method_says_so() {
    let server = started().await;
    let token = server.token.clone();
    let (_, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 6, "method": "resources/list"
        }),
    )
    .await;

    assert_eq!(body["error"]["code"], -32601);
}

#[tokio::test]
async fn a_notification_gets_no_reply_body() {
    // `notifications/initialized` is the one every client sends, and a server
    // that answered it with a JSON-RPC response would be violating the spec at
    // the first thing a client does.
    let server = started().await;
    let token = server.token.clone();
    let (status, _) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "method": "notifications/initialized"
        }),
    )
    .await;
    assert_eq!(status, 202);
}

#[tokio::test]
async fn a_plugins_tools_go_when_the_plugin_does() {
    // A tool whose plugin has been disabled must go with it: an agent calling
    // into a plugin that is no longer there would hang until it timed out,
    // which reads as the editor being broken rather than the plugin being off.
    let registry = registry();
    registry.write().await.remove_provider("com.example.demo");

    let server = Server::start(0, "yaz".to_owned(), "0.2.0".to_owned(), registry)
        .await
        .expect("it binds");
    let token = server.token.clone();
    let (_, body) = call(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 7, "method": "tools/list"
        }),
    )
    .await;

    let tools = body["result"]["tools"].as_array().expect("a list");
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert_eq!(names, vec!["echo"]);
}

#[tokio::test]
async fn two_servers_get_different_tokens() {
    // Or the token would be a formality rather than a secret.
    let first = started().await;
    let second = started().await;
    assert_ne!(first.token, second.token);
    assert!(first.token.len() >= 32);
}
