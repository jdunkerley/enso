//! `reqwest` is built without a crypto provider, so a client that does not come from
//! `ide_ci::io::web::client` panics on its first HTTPS request. See Note [TLS Backend] in the
//! workspace `Cargo.toml`.
//!
//! `clippy.toml` disallows most of the other constructors, but CI does not run clippy, and clippy
//! cannot express `Client::default()` at all (it resolves no trait-impl paths). This test runs in
//! CI and catches the spellings a source scan can see. `let c: Client = Default::default()` is
//! beyond it.

use ide_ci::prelude::*;

use regex::Regex;

/// The one place allowed to construct clients, and this file (its fixtures are examples).
const SKIPPED: [&str; 2] = ["ci_utils/src/io/web/client.rs", "ci_utils/tests/reqwest_clients.rs"];

/// Matches `Client::new(`, `ClientBuilder::default(`, `get(` and the like, capturing the path in
/// front.
fn pattern() -> Result<Regex> {
    Ok(Regex::new(
        r"(?P<prefix>[\w:]*?)\b(?P<call>(?:Client|ClientBuilder)::(?:new|builder|default)|get)\s*\(",
    )?)
}

/// Whether `code` constructs a `reqwest` client (or calls `reqwest::get`) directly.
///
/// The path in front of `Client` tells `reqwest::Client`, or a bare imported `Client`, apart from
/// other crates' clients such as `aws_sdk_s3::Client::new`.
fn constructs_reqwest_client(pattern: &Regex, code: &str) -> bool {
    pattern.captures_iter(code).any(|found| {
        let prefix = &found["prefix"];
        match &found["call"] {
            "get" => prefix.ends_with("reqwest::"),
            _ => prefix.is_empty() || prefix.ends_with("reqwest::"),
        }
    })
}

#[test]
fn http_clients_are_built_with_our_tls_configuration() -> Result {
    let pattern = pattern()?;
    let build_tools = Path::new(env!("CARGO_MANIFEST_DIR")).parent().context("No parent.")?;
    let mut offenders = Vec::new();
    for entry in walkdir::WalkDir::new(build_tools)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != "target")
    {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(build_tools)?.to_string_lossy().replace('\\', "/");
        if path.extension().is_none_or(|ext| ext != "rs") || SKIPPED.contains(&relative.as_str()) {
            continue;
        }
        for (number, line) in ide_ci::fs::read_to_string(path)?.lines().enumerate() {
            let code = line.split("//").next().unwrap_or_default();
            if constructs_reqwest_client(&pattern, code) {
                offenders.push(format!("{relative}:{}: {}", number + 1, line.trim()));
            }
        }
    }
    ensure!(
        offenders.is_empty(),
        "Build HTTP clients with `ide_ci::io::web::client::builder()`/`new()` instead:\n{}",
        offenders.join("\n")
    );
    Ok(())
}

#[test]
fn the_scan_tells_reqwest_apart_from_other_clients() -> Result {
    let pattern = pattern()?;
    for flagged in [
        "let c = reqwest::Client::new();",
        "let c = ::reqwest::Client::default();",
        "let c = Client::builder().build()?;",
        "let r = reqwest::get(url).await?;",
        "ClientBuilder::new()",
    ] {
        ensure!(constructs_reqwest_client(&pattern, flagged), "Missed: {flagged}");
    }
    for allowed in [
        "aws_sdk_s3::Client::new(&config)",
        "let r = client.get(url).send().await?;",
        "map.get(&key)",
        "ide_ci::io::web::client::new()",
    ] {
        ensure!(!constructs_reqwest_client(&pattern, allowed), "False positive: {allowed}");
    }
    Ok(())
}
