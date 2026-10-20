//! Support code for managing Enso releases.

use crate::prelude::*;

use crate::changelog::Changelog;
use crate::context::BuildContext;
use crate::project;
use crate::version;
use crate::version::Versions;
use crate::version::promote::Designation;

use ide_ci::github;
use octocrab::models::repos::Release;
use octocrab::params::repos::Reference;
use tempfile::tempdir;

// ==============
// === Export ===
// ==============

pub mod manifest;

/// Generate placeholders for the release notes.
pub fn release_body_placeholders(
    context: &BuildContext,
) -> Result<BTreeMap<&'static str, serde_json::Value>> {
    let mut ret = BTreeMap::new();
    ret.insert(
        "is_stable",
        (!version::Kind::deduce(&context.triple.versions.version)?.is_prerelease()).into(),
    );
    ret.insert("version", context.triple.versions.version.to_string().into());
    ret.insert("edition", context.triple.versions.edition_name().into());
    ret.insert("repo", serde_json::to_value(&context.remote_repo)?);
    ret.insert(
        "assets",
        serde_json::to_value(manifest::Assets::new(
            &context.remote_repo,
            &context.triple.versions.version,
        ))?,
    );

    // Generate the release notes.
    let changelog_contents = ide_ci::fs::read_to_string(&context.repo_root.changelog_md)?;
    let latest_changelog_body = Changelog(&changelog_contents).top_release_notes()?;
    ret.insert("changelog", latest_changelog_body.contents.into());
    Ok(ret)
}

/// Generate the release notes.
///
/// They are generated from the template file `release-body.md` by replacing the placeholders.
pub async fn generate_release_body(context: &BuildContext) -> Result<String> {
    let available_placeholders = release_body_placeholders(context)?;

    let handlebars = handlebars::Handlebars::new();
    let template = include_str!("../release-body.md");
    let body = handlebars.render_template(template, &available_placeholders)?;
    Ok(body)
}

/// Create a new release draft on GitHub.
///
/// As it is a draft, it will not be visible to the public until it is published.
#[context("Failed to draft a new release {} from the commit {}.", context.triple.versions.tag(),
commit)]
pub async fn draft_a_new_release(context: &BuildContext, commit: &str) -> Result<Release> {
    let versions = &context.triple.versions;
    let tag = versions.tag();

    // We don't require being run from a git repository context, but if we do happen to be, then
    // the local HEAD is required to be the same as the commit we read from environment.
    if let Ok(git) = context.git().await {
        let head_hash = git.head_hash().await?;
        ensure!(
            head_hash == commit,
            "Local HEAD {} is not the same as the commit {} we were ordered to build.",
            head_hash,
            commit
        );
    }

    // Make sure that this version has not been released yet.
    let repo = &context.remote_repo_handle();
    if let Ok(colliding_release) = repo.find_release_by_tag(&tag).await {
        ensure!(colliding_release.draft, "Release {} has already been published.", tag);
        warn!(
            "Release {tag} has already been drafted: {}. Creating a new one.",
            colliding_release.html_url
        );
    }

    // Check if the remote repository contains a conflicting tag.
    let colliding_remote_tag = repo.get_ref(&Reference::Tag(tag.clone())).await;
    if let Ok(colliding_remote_tag) = colliding_remote_tag {
        bail!("Tag {} already exists on remote as {:?}.", tag, colliding_remote_tag.object);
    }

    let is_prerelease = version::Kind::deduce(&versions.version)?.is_prerelease();

    debug!("Preparing release {} for commit {}", versions.version, commit);
    let release = context
        .remote_repo_handle()
        .repos()
        .releases()
        .create(&versions.tag())
        .target_commitish(&commit)
        .name(&versions.pretty_name())
        .body(&generate_release_body(context).await?)
        .prerelease(is_prerelease)
        .draft(true)
        .send()
        .await?;

    ide_ci::actions::workflow::set_output(&crate::env::ENSO_RELEASE_ID, &release.id).await?;
    Ok(release)
}

/// Publish a previously drafted release and upload the assets manifest.
///
/// The draft was created with the prerelease flag already set according to the version (see
/// [`draft_a_new_release`]), so publishing it keeps prereleases marked as such.
///
/// Requires the release ID to be set in the environment variable `ENSO_RELEASE_ID`.
pub async fn publish_release(context: &BuildContext) -> Result {
    let remote_repo = context.remote_repo_handle();
    let BuildContext { inner: project::Context { .. }, triple, .. } = context;

    let release_id = crate::env::ENSO_RELEASE_ID.get()?;
    let release_handle = remote_repo.release_handle(release_id);

    debug!("Looking for release with id {release_id} on github.");
    let release = release_handle.get().await?;
    ensure!(release.draft, "Release has been already published!");

    // macOS does not block publishing, and is skipped when its runner is offline (see
    // `add_release_steps`), so its installer may be absent.
    let uploaded: Vec<String> = release.assets.iter().map(|asset| asset.name.clone()).collect();
    let (manifest, missing) =
        manifest::Assets::new_uploaded(&remote_repo, &triple.versions.version, &uploaded);
    if !missing.is_empty() {
        let platforms = missing.iter().map(|asset| asset.target_pretty.as_str()).join(", ");
        warn!("Publishing without installers for: {platforms}.");
        let note = format!(
            "\n\n> [!NOTE]\n> This release has no installer for {platforms}: that build failed or \
             was skipped. Re-run its jobs in the release workflow to add it."
        );
        let body = format!("{}{note}", release.body.as_deref().unwrap_or_default());
        // A draft's tag does not exist yet; editing the draft without restating the tag turns it
        // into `untagged-…`, and the release then publishes without a tag.
        remote_repo
            .repos()
            .releases()
            .update(release_id.0)
            .tag_name(&release.tag_name)
            .target_commitish(&release.target_commitish)
            .body(&body)
            .send()
            .await?;
    }

    debug!("Found the target release, will publish it.");
    release_handle.publish().await?;
    debug!("Done. Release URL: {}", release.url);

    // Add assets manifest.
    let tempdir = tempdir()?;
    let manifest_path = tempdir.path().join(manifest::ASSETS_MANIFEST_FILENAME);
    ide_ci::fs::write_json(&manifest_path, &manifest)?;
    release_handle.upload_asset_file(&manifest_path).await?;

    // The validation step is performed to enable issue reporting and enhance issue visibility.
    // Currently, even if the validation fails, the release will not be retracted.
    validate_release(release_handle).await?;

    Ok(())
}

/// Perform basic check if the release contains advertised assets.
///
/// This should be run only on a published (non-draft) release, as asset download URLs change after
/// publishing.
#[context("Failed to validate release: {release:?}")]
pub async fn validate_release(release: github::release::Handle) -> Result {
    let info = release.get().await?;
    ensure!(!info.draft, "Release is a draft.");
    let version = Version::from_str(&info.tag_name)?;
    let manifest_url = github::release::download_asset(
        &release.repo,
        &version,
        manifest::ASSETS_MANIFEST_FILENAME,
    );
    let manifest = ide_ci::io::download_all(manifest_url)
        .await
        .context("Failed to download assets manifest.")?;
    let manifest: manifest::Assets =
        serde_json::from_slice(&manifest).context("Failed to parse assets manifest.")?;
    for asset in manifest.assets() {
        let response = ide_ci::io::web::client::new().get(asset.url.clone()).send().await?;
        ensure!(response.status().is_success(), "Failed to download asset: {}", asset.url);
    }
    Ok(())
}

/// Step output reporting whether [`update_latest_release_version`] changed the build config.
pub const LATEST_RELEASE_UPDATED_OUTPUT: &str = "ENSO_LATEST_RELEASE_UPDATED";

/// Record the version being released as the latest stable one in `build-config.yaml`.
///
/// Returns whether the file changed, so that the caller can skip opening an empty pull request.
/// Prereleases are ignored: the entry is the version that local builds base their `-dev` version
/// on, which a prerelease never is.
pub async fn update_latest_release_version(context: &BuildContext) -> Result<bool> {
    let version = &context.triple.versions.version;
    if version::Kind::deduce(version)?.is_prerelease() {
        info!("{version} is a prerelease; leaving the latest-release entry untouched.");
        return Ok(false);
    }
    let path = &context.repo_root.build_config_yaml;
    let old_config = ide_ci::fs::tokio::read_to_string(path).await?;
    let new_config = crate::config::with_latest_release(&old_config, version)?;
    if new_config == old_config {
        info!("{} already records {version} as the latest release.", path.display());
        return Ok(false);
    }
    ide_ci::fs::tokio::write(path, &new_config).await?;
    info!("Recorded {version} as the latest release in {}.", path.display());
    Ok(true)
}

/// Generate a new version number of a requested kind.
pub async fn resolve_version_designation(
    context: &BuildContext,
    designation: Designation,
) -> Result<Version> {
    let git = context.git().await?;
    let version_set = version::promote::Releases::from_remote(&git).await?;
    version_set.generate_version(designation)
}

/// Generate a new version and make it visible to CI.
///
/// Sets `ENSO_VERSION`, `ENSO_EDITION` and `ENSO_RELEASE_MODE` environment variables.
#[instrument]
pub async fn promote_release(context: &BuildContext, version_designation: Designation) -> Result {
    let version = resolve_version_designation(context, version_designation).await?;
    let versions = Versions::new(version);
    versions.publish().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::TargetTriple;
    use ide_ci::cache::Cache;
    use ide_ci::github::setup_octocrab;

    #[tokio::test]
    #[ignore]
    async fn release_assets() -> Result {
        setup_logging().ok();

        let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = crate_dir.parent().unwrap().parent().unwrap();
        let version = Version::from_str("2024.1.1-nightly.2024.3.26")?;
        let triple = TargetTriple::new(Versions::new(version.clone()));
        let context = BuildContext {
            inner: project::Context {
                repo_root: crate::paths::new_repo_root(repo_root, &triple),
                octocrab: setup_octocrab().await?,
                cache: Cache::new_default().await?,
            },
            remote_repo: github::Repo::new("enso-org", "enso"),
            triple: TargetTriple::new(Versions::new(version.clone())),
        };

        let release_body = generate_release_body(&context).await?;
        debug!("Release body: {}", release_body);

        let manifest = manifest::Assets::new(&context.remote_repo, &version);
        let manifest_json = serde_json::to_string_pretty(&manifest)?;
        debug!("Manifest: {}", manifest_json);

        Ok(())
    }
}
