//! Read-only checks of our GitHub and HTTP client code against the live services.
//!
//! These exercise the real `octocrab` and `reqwest` stacks — TLS, redirects, pagination and
//! (de)serialization of the models we depend on — which unit tests with a mocked server cannot.
//! They are `#[ignore]`d because they need network access. Run them with:
//!
//! ```text
//! GITHUB_TOKEN=$(gh auth token) cargo test -p ide-ci --test github_live_api -- --ignored --nocapture
//! ```
//!
//! Every call here is a read. Do not add anything that creates, modifies or deletes GitHub state
//! (releases, assets, workflow dispatches): these tests run against a real, shared repository.
//!
//! The artifact test needs a token (GitHub refuses anonymous artifact downloads) and a run whose
//! artifacts have not expired yet; it is skipped when either is missing. Set
//! `ENSO_LIVE_TEST_RUN_ID` and `ENSO_LIVE_TEST_ARTIFACT` to point it at a current run.

use ide_ci::prelude::*;

use ide_ci::github::Repo;
use ide_ci::github::setup_octocrab;
use octocrab::params::repos::Reference;

/// A public repository with enough releases to need several pages.
fn enso_repo() -> Repo {
    Repo::new("enso-org", "enso")
}

/// A small, stable release asset: the launcher manifest of release 2025.3.4.
const RELEASE_TAG: &str = "2025.3.4";
const SMALL_ASSET_NAME: &str = "launcher-manifest.yaml";
const MANIFEST_PREFIX: &str = "minimum-version-for-upgrade:";

#[tokio::test]
#[ignore]
async fn releases_are_listed_across_all_pages() -> Result {
    let octocrab = setup_octocrab().await?;
    let repo = enso_repo().into_handle(&octocrab);
    let releases = repo.all_releases().await?;
    println!("all_releases: {} releases", releases.len());
    // `MAX_PER_PAGE` is 100, so anything above that proves pagination followed `next` links.
    ensure!(releases.len() > 100, "Expected more than one page, got {}.", releases.len());
    let ids: HashSet<_> = releases.iter().map(|release| release.id).collect();
    ensure!(ids.len() == releases.len(), "Pagination returned duplicate releases.");
    Ok(())
}

#[tokio::test]
#[ignore]
async fn release_and_asset_fields_are_populated() -> Result {
    let octocrab = setup_octocrab().await?;
    let repo = enso_repo().into_handle(&octocrab);

    let latest = repo.latest_release().await?;
    println!(
        "latest_release: {} (id={}, assets={})",
        latest.tag_name,
        latest.id,
        latest.assets.len()
    );
    ensure!(!latest.assets.is_empty(), "Latest release has no assets.");

    let by_tag = repo.find_release_by_tag(RELEASE_TAG).await?;
    let by_id = repo.find_release_by_id(by_tag.id).await?;
    ensure!(by_id.tag_name == RELEASE_TAG, "Release fetched by id has tag {}.", by_id.tag_name);
    ensure!(by_id.assets.len() == by_tag.assets.len(), "Asset lists differ between endpoints.");

    let asset = by_id
        .assets
        .iter()
        .find(|asset| asset.name == SMALL_ASSET_NAME)
        .context("Small asset missing from the release.")?;
    let fetched = repo.asset(asset.id).await?;
    println!(
        "asset: {} id={} size={} content_type={} url={}",
        fetched.name, fetched.id, fetched.size, fetched.content_type, fetched.browser_download_url
    );
    ensure!(fetched.name == SMALL_ASSET_NAME && fetched.size == asset.size, "Asset mismatch.");
    Ok(())
}

#[tokio::test]
#[ignore]
async fn release_asset_is_downloaded_through_the_api() -> Result {
    let octocrab = setup_octocrab().await?;
    let repo = enso_repo().into_handle(&octocrab);
    let release = repo.find_release_by_tag(RELEASE_TAG).await?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == SMALL_ASSET_NAME)
        .context("Small asset missing from the release.")?;

    // The API endpoint answers with a redirect to the asset CDN, so this also checks that the
    // redirect is followed.
    let temp = tempfile::tempdir()?;
    let path = repo.download_asset_to(asset, temp.path().to_owned()).await?;
    let contents = ide_ci::fs::read_to_string(&path)?;
    println!("download_asset_to: {} bytes, starts with {:?}", contents.len(), &contents[..20]);
    ensure!(contents.len() as u64 == asset.size as u64, "Downloaded size differs from asset size.");
    ensure!(contents.starts_with(MANIFEST_PREFIX), "Unexpected manifest contents.");
    Ok(())
}

#[tokio::test]
#[ignore]
async fn repository_metadata_is_read() -> Result {
    let octocrab = setup_octocrab().await?;
    let repo = enso_repo().into_handle(&octocrab);
    let default_branch = repo.default_branch().await?;
    println!("default_branch: {default_branch}");
    ensure!(default_branch == "develop", "Unexpected default branch {default_branch}.");
    let r#ref = repo.get_ref(&Reference::Branch(default_branch)).await?;
    println!("get_ref: {} -> {:?}", r#ref.ref_field, r#ref.object);
    ensure!(r#ref.ref_field == "refs/heads/develop", "Unexpected ref {}.", r#ref.ref_field);
    Ok(())
}

#[tokio::test]
#[ignore]
async fn runner_release_url_is_resolved() -> Result {
    let octocrab = setup_octocrab().await?;
    let url = ide_ci::github::latest_runner_url(&octocrab, OS::Linux).await?;
    println!("latest_runner_url: {url}");
    ensure!(url.as_str().contains("actions-runner-linux-"), "Unexpected runner URL {url}.");
    Ok(())
}

#[tokio::test]
#[ignore]
async fn workflow_artifact_is_found_and_downloaded() -> Result {
    if ide_ci::github::retrieve_github_access_token().is_err() {
        println!("Skipping: artifact downloads need GITHUB_TOKEN.");
        return Ok(());
    }
    let run_id = std::env::var("ENSO_LIVE_TEST_RUN_ID").unwrap_or("31007732004".into());
    let name = std::env::var("ENSO_LIVE_TEST_ARTIFACT").unwrap_or("Edition File".into());
    let run_id = octocrab::models::RunId(run_id.parse()?);

    let octocrab = setup_octocrab().await?;
    let repo = enso_repo().into_handle(&octocrab);
    let artifact = repo.find_artifact_by_name(run_id, &name).await?;
    println!(
        "find_artifact_by_name: {} id={} size={}",
        artifact.name, artifact.id, artifact.size_in_bytes
    );
    let temp = tempfile::tempdir()?;
    repo.download_and_unpack_artifact(artifact.id, temp.path()).await?;
    let files = walkdir::WalkDir::new(temp.path())
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.path().strip_prefix(temp.path()).unwrap().to_owned())
        .collect_vec();
    println!("download_and_unpack_artifact: {files:?}");
    ensure!(!files.is_empty(), "Artifact unpacked to nothing.");
    Ok(())
}

#[tokio::test]
#[ignore]
async fn plain_https_download_streams_to_file() -> Result {
    // Not a GitHub API call: goes through `reqwest` directly, over a redirect to the CDN.
    let url = format!(
        "https://github.com/enso-org/enso/releases/download/{RELEASE_TAG}/{SMALL_ASSET_NAME}"
    );
    let temp = tempfile::tempdir()?;
    let path = temp.path().join(SMALL_ASSET_NAME);
    ide_ci::io::web::download_file(&url, &path).await?;
    let contents = ide_ci::fs::read_to_string(&path)?;
    println!("download_file: {} bytes from {url}", contents.len());
    ensure!(contents.starts_with(MANIFEST_PREFIX), "Unexpected manifest contents.");

    // The cache's download job, which is what goodies and release assets go through.
    let cache = ide_ci::cache::Cache::new(temp.path().join("cache")).await?;
    let cached = ide_ci::cache::download::download(cache, &url).await?;
    let cached_contents = ide_ci::fs::read_to_string(&cached)?;
    println!("cache::download::download: {} -> {}", url, cached.display());
    ensure!(cached_contents == contents, "Cached download differs from the direct one.");
    Ok(())
}

/// The `Changelog` CI job deserializes the Actions event payload into octocrab's models. Rebuild
/// such a payload from the live objects it embeds and check that the models still accept them.
#[tokio::test]
#[ignore]
async fn pull_request_event_payload_deserializes() -> Result {
    let octocrab = setup_octocrab().await?;
    let pull_request: serde_json::Value =
        octocrab.get("/repos/enso-org/enso/pulls/15024", None::<&()>).await?;
    let repository: serde_json::Value = octocrab.get("/repos/enso-org/enso", None::<&()>).await?;
    let payload = serde_json::json!({
        "action": "opened",
        "sender": pull_request["user"],
        "pull_request": pull_request,
        "repository": repository,
    });
    let payload: ide_ci::actions::context::WebhookPayload = serde_json::from_value(payload)?;
    let pull_request = payload.pull_request.context("Missing pull request.")?;
    let labels = pull_request.labels.iter().flatten().map(|label| &label.name).collect_vec();
    println!("payload: PR #{} labels {labels:?}", pull_request.number);
    ensure!(labels.iter().any(|name| *name == "CI: No changelog needed"), "Label not parsed.");
    let repository = payload.repository.context("Missing repository.")?;
    ensure!(repository.default_branch.as_deref() == Some("develop"), "Default branch not parsed.");
    ensure!(payload.sender.is_some(), "Sender not parsed.");
    Ok(())
}

#[tokio::test]
#[ignore]
async fn missing_resources_are_errors() -> Result {
    let octocrab = setup_octocrab().await?;
    let repo = enso_repo().into_handle(&octocrab);
    let missing_asset = repo.asset(octocrab::models::AssetId(1)).await;
    let described = missing_asset.as_ref().map(|asset| &asset.name).map_err(|e| format!("{e:#}"));
    println!("asset(1): {described:?}");
    ensure!(missing_asset.is_err(), "A non-existent asset was reported as found.");
    let missing_release = repo.find_release_by_id(octocrab::models::ReleaseId(1)).await;
    ensure!(missing_release.is_err(), "A non-existent release was reported as found.");
    let missing_download = repo.download_asset(octocrab::models::AssetId(1)).await;
    ensure!(missing_download.is_err(), "A non-existent asset was downloaded.");
    Ok(())
}
