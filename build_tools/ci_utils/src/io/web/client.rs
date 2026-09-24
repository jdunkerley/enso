use crate::prelude::*;

use crate::archive::Format;
use crate::global::progress_bar;
use crate::io::web;

use reqwest::Client;
use reqwest::ClientBuilder;
use reqwest::IntoUrl;
use reqwest::Response;
use std::sync::LazyLock;
use std::time::Duration;

// ====================
// === Construction ===
// ====================

/// Start building an HTTP client that uses our TLS configuration.
///
/// This is the only supported way to create a [`Client`] in the build tooling; see
/// Note [TLS Backend] in the workspace `Cargo.toml`. `reqwest` is built without a crypto provider,
/// so a client created through [`Client::new`] or [`Client::builder`] panics on its first request.
#[allow(clippy::disallowed_methods)] // This is the one sanctioned call site.
pub fn builder() -> ClientBuilder {
    Client::builder().tls_backend_preconfigured(tls_config())
}

/// Create an HTTP client with the default settings and our TLS configuration.
pub fn new() -> Client {
    // Building only fails on an invalid TLS configuration, which `tls_config` does not produce.
    builder().build().expect("Failed to build the HTTP client.")
}

/// TLS configuration for all our HTTPS clients: `rustls` with the `ring` provider and the bundled
/// Mozilla root store.
fn tls_config() -> rustls::ClientConfig {
    static CONFIG: LazyLock<rustls::ClientConfig> = LazyLock::new(|| {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
        rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("The ring provider supports the default TLS versions.")
            .with_root_certificates(roots)
            .with_no_client_auth()
    });
    CONFIG.clone()
}

// ================
// === Requests ===
// ================

pub async fn get(client: &Client, url: impl IntoUrl) -> Result<Response> {
    let url = url.into_url()?;
    web::execute(client.get(url.clone())).await.with_context(|| format!("Failed to get {url}"))
}

/// Get the the response body as a byte stream.
pub async fn download(
    client: &Client,
    url: impl IntoUrl,
) -> Result<impl Stream<Item = reqwest::Result<Bytes>>> {
    let url = url.into_url()?;
    debug!("Downloading {url}.");
    Ok(client.get(url).send().await?.error_for_status()?.bytes_stream())
}

/// Get the full response body from URL as bytes.
pub async fn download_all(client: &Client, url: impl IntoUrl) -> Result<Bytes> {
    let url = url.into_url()?;
    let bar = progress_bar(indicatif::ProgressBar::new_spinner);
    bar.enable_steady_tick(Duration::from_millis(100));
    bar.set_message(format!("Downloading {url}"));
    let response = web::execute(client.get(url.clone())).await?;
    response.bytes().await.with_context(|| format!("Failed to download body of {url}"))
}

/// Downloads archive from URL and extracts it into an output path.
pub async fn download_and_extract(
    client: &Client,
    url: impl IntoUrl,
    output_dir: impl AsRef<Path>,
) -> anyhow::Result<()> {
    let url = url.into_url()?;
    let url_text = url.to_string();
    let filename = crate::io::filename_from_url(&url)?;
    let format = Format::from_filename(&filename)?;

    debug!("Downloading {}", url_text);
    // FIXME: dont keep the whole download in the memory.
    let contents = download_all(client, url).await?;
    let buffer = std::io::Cursor::new(contents);

    debug!("Extracting {} to {}", filename.display(), output_dir.as_ref().display());
    format.extract(buffer, output_dir.as_ref()).with_context(|| {
        format!("Failed to extract data from {} to {}.", url_text, output_dir.as_ref().display(),)
    })
}

/// Download file at base_url/subpath to output_dir_base/subpath.
pub async fn download_relative(
    client: &Client,
    base_url: &Url,
    output_dir_base: impl AsRef<Path>,
    subpath: &Path,
) -> Result<PathBuf> {
    let url_to_get = base_url.join(&subpath.display().to_string())?;
    let output_path = output_dir_base.as_ref().join(subpath);

    debug!("Will download {} => {}", url_to_get, output_path.display());
    let response = client.get(url_to_get).send().await?.error_for_status()?;

    if let Some(parent_dir) = output_path.parent() {
        crate::fs::create_dir_if_missing(parent_dir)?;
    }

    web::stream_to_file(response.bytes_stream(), &output_path).await?;
    debug!("Download finished: {}", output_path.display());
    Ok(output_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `tls_backend_preconfigured` degrades to an "unknown TLS backend" when the `rustls` version
    /// we build the configuration with differs from the one `reqwest` links, and that only shows
    /// at `build`. Catch it here rather than on the first download.
    #[test]
    fn client_builds_with_our_tls_configuration() {
        builder().build().expect("Client with our TLS configuration should build.");
    }
}
