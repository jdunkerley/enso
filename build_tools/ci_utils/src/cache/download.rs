use crate::prelude::*;

use crate::cache::Cache;
use crate::cache::Storable;
use crate::io::filename_from_url;
use crate::io::web::filename_from_response;
use crate::io::web::handle_error_response;
use crate::io::web::stream_response_to_file;

use headers::HeaderMap;
use reqwest::Client;
use reqwest::ClientBuilder;
use reqwest::IntoUrl;
use reqwest::Response;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Key {
    pub url: Url,

    /// We keep this as part of the key, as some GitHub API endpoints change their meaning based on
    /// the headers set.
    #[serde(with = "http_serde::header_map")]
    pub additional_headers: HeaderMap,
}

#[derive(Clone, Debug)]
pub struct DownloadFile {
    pub key: Key,
    pub client: Client,
}

impl DownloadFile {
    pub fn new(url: impl IntoUrl) -> Result<Self> {
        Ok(Self {
            key: Key { url: url.into_url()?, additional_headers: default() },
            client: ClientBuilder::new().user_agent("enso-build").build()?,
        })
    }

    pub fn send_request(&self) -> BoxFuture<'static, Result<Response>> {
        let response = self
            .client
            .get(self.key.url.clone())
            .headers(self.key.additional_headers.clone())
            .send();

        let span = info_span!("Downloading a file.", url = %self.key.url);
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
