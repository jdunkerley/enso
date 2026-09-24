use crate::prelude::*;

use crate::cache::Cache;
use crate::cache::Storable;
use crate::io::filename_from_url;
use crate::io::web::filename_from_response;
use crate::io::web::handle_error_response;
use crate::io::web::stream_response_to_file;

use reqwest::Client;
use reqwest::IntoUrl;
use reqwest::Response;
use reqwest::header::HeaderMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Key {
    pub url: Url,

    /// We keep this as part of the key, as some GitHub API endpoints change their meaning based on
    /// the headers set.
    #[serde(with = "http_serde::header_map")]
    pub additional_headers: HeaderMap,
}

/// What performs a [`DownloadFile`] request.
#[derive(Clone, Debug)]
pub enum Fetcher {
    /// A plain HTTP client.
    Http(Client),
    /// A GitHub API client, for endpoints that need whatever authentication it was configured
    /// with. Only the key URL's path and query are sent, so the request goes to the client's own
    /// API base (e.g. GitHub Enterprise or a mock server), not to the host in the key. Its
    /// redirect policy drops credentials on a cross-origin redirect, so release assets served
    /// from GitHub's CDN do not receive the token.
    GitHub(Octocrab),
}

#[derive(Clone, Debug)]
pub struct DownloadFile {
    pub key: Key,
    pub fetcher: Fetcher,
}

impl DownloadFile {
    pub fn new(url: impl IntoUrl) -> Result<Self> {
        Ok(Self {
            key: Key { url: url.into_url()?, additional_headers: default() },
            fetcher: Fetcher::Http(
                crate::io::web::client::builder().user_agent("enso-build").build()?,
            ),
        })
    }

    pub fn send_request(&self) -> BoxFuture<'static, Result<Response>> {
        let url = self.key.url.clone();
        let headers = self.key.additional_headers.clone();
        let span = info_span!("Downloading a file.", url = %url);
        let response: BoxFuture<'static, Result<Response>> = match &self.fetcher {
            Fetcher::Http(client) => {
                let response = client.get(url).headers(headers).send();
                async move { Ok(response.await?) }.boxed()
            }
            Fetcher::GitHub(octocrab) => {
                let octocrab = octocrab.clone();
                // Relative, so that octocrab resolves it against its own API base.
                let route = match url.query() {
                    Some(query) => format!("{}?{query}", url.path()),
                    None => url.path().to_owned(),
                };
                async move {
                    let response =
                        octocrab._get_with_headers(route.as_str(), Some(headers)).await?;
                    // Hand back the same response type as the plain client, so that callers can
                    // stream, name and check it identically.
                    Ok(Response::from(response.map(reqwest::Body::wrap)))
                }
                .boxed()
            }
        };
        async move { handle_error_response(response.await?).await }.instrument(span).boxed()
    }
}

impl Storable for DownloadFile {
    type Metadata = PathBuf;
    type Output = PathBuf;
    type Key = Key;

    fn generate(
        &self,
        _cache: Cache,
        store: PathBuf,
    ) -> BoxFuture<'static, Result<Self::Metadata>> {
        // FIXME use `download_to_dir`
        let this = self.clone();
        let filename_from_url = filename_from_url(&self.key.url).ok();
        // Downloads from GitHub's release-asset CDN occasionally drop the connection mid-stream
        // ("Connection reset by peer"); a fresh request almost always succeeds.
        crate::io::retry(move || {
            let this = this.clone();
            let store = store.clone();
            let filename_from_url = filename_from_url.clone();
            async move {
                let response = this.send_request().await?;
                let filename = filename_from_response(&response)
                    .ok()
                    .map(ToOwned::to_owned)
                    .or(filename_from_url)
                    .unwrap_or_else(|| PathBuf::from("data"));
                let output = store.join(&filename);
                stream_response_to_file(response, &output).await?;
                Ok(filename) // We don't store absolute paths to keep cache relocatable.
            }
        })
        .boxed()
    }

    fn adapt(
        &self,
        store: PathBuf,
        metadata: Self::Metadata,
    ) -> BoxFuture<'static, Result<Self::Output>> {
        ready(Ok(store.join(metadata))).boxed()
    }

    fn key(&self) -> Self::Key {
        self.key.clone()
    }
}

pub async fn download(cache: Cache, url: impl IntoUrl) -> Result<PathBuf> {
    let download = DownloadFile::new(url)?;
    cache.get(download).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use reqwest::header::ACCEPT;
    use reqwest::header::HeaderValue;
    use wiremock::Mock;
    use wiremock::MockServer;
    use wiremock::ResponseTemplate;
    use wiremock::matchers::header;
    use wiremock::matchers::header_exists;
    use wiremock::matchers::method;
    use wiremock::matchers::path;

    /// A GitHub download of `url` through a client with its own token, not the environment's.
    ///
    /// Octocrab only attaches the token for its API and upload hosts, so `api` stands in as the
    /// API host.
    fn github_download(api: &MockServer, url: String) -> Result<DownloadFile> {
        let octocrab = Octocrab::builder()
            .base_uri(api.uri())?
            .personal_token("secret".to_string())
            .build()?;
        let accept = HeaderValue::from_static(mime::APPLICATION_OCTET_STREAM.as_ref());
        Ok(DownloadFile {
            key: Key {
                url: url.parse()?,
                additional_headers: HeaderMap::from_iter([(ACCEPT, accept)]),
            },
            fetcher: Fetcher::GitHub(octocrab),
        })
    }

    #[tokio::test]
    async fn github_download_uses_the_clients_authentication() -> Result {
        let api = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/asset"))
            .and(header("authorization", "Bearer secret"))
            .and(header("accept", "application/octet-stream"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-disposition", "attachment; filename=enso.zip")
                    .set_body_bytes(b"payload".to_vec()),
            )
            .expect(1)
            .mount(&api)
            .await;
        let response =
            github_download(&api, format!("{}/asset", api.uri()))?.send_request().await?;
        assert_eq!(filename_from_response(&response)?, Path::new("enso.zip"));
        assert_eq!(response.bytes().await?.as_ref(), b"payload");
        Ok(())
    }

    /// The key is built from the public API URL, but a client configured with another API base
    /// (GitHub Enterprise, or a mock) must be asked, not `api.github.com`.
    #[tokio::test]
    async fn github_download_goes_to_the_clients_api_base() -> Result {
        let api = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repos/enso-org/enso/releases/assets/1"))
            .and(header("authorization", "Bearer secret"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"payload".to_vec()))
            .expect(1)
            .mount(&api)
            .await;
        let url = "https://api.github.com/repos/enso-org/enso/releases/assets/1".to_owned();
        let response = github_download(&api, url)?.send_request().await?;
        assert_eq!(response.bytes().await?.as_ref(), b"payload");
        Ok(())
    }

    /// Release assets redirect to a CDN on another host, which must not receive our token.
    #[tokio::test]
    async fn github_download_does_not_send_the_token_across_origins() -> Result {
        let api = MockServer::start().await;
        let cdn = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/asset"))
            .and(header("authorization", "Bearer secret"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("location", format!("{}/blob", cdn.uri()).as_str()),
            )
            .expect(1)
            .mount(&api)
            .await;
        // Mounted first, so it wins whenever it matches.
        Mock::given(header_exists("authorization"))
            .respond_with(ResponseTemplate::new(400))
            .expect(0)
            .mount(&cdn)
            .await;
        Mock::given(method("GET"))
            .and(path("/blob"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"payload".to_vec()))
            .expect(1)
            .mount(&cdn)
            .await;
        let response =
            github_download(&api, format!("{}/asset", api.uri()))?.send_request().await?;
        assert_eq!(response.bytes().await?.as_ref(), b"payload");
        Ok(())
    }

    #[tokio::test]
    async fn failed_github_download_is_an_error() -> Result {
        let api = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404).set_body_string(r#"{"message":"Not Found"}"#))
            .expect(1)
            .mount(&api)
            .await;
        let result = github_download(&api, format!("{}/asset", api.uri()))?.send_request().await;
        let message = format!("{:#}", result.expect_err("The download should have failed."));
        assert!(message.contains("404"), "{message}");
        assert!(message.contains("Not Found"), "{message}");
        Ok(())
    }
}
