use enso_build_cli::prelude::*;

use ide_ci::github::RepoRef;
use ide_ci::github::setup_octocrab;

const REPO: RepoRef = RepoRef { owner: "enso-org", name: "enso" };

#[tokio::main]
async fn main() -> Result {
    setup_logging()?;
    info!("Removing draft releases from GitHub.");
    let octo = setup_octocrab().await?;
    if let Err(e) = octo.current().user().await {
        bail!(
            "Failed to authenticate: {}.\nBeing authenticated is necessary to see draft releases.",
            e
        );
    }
    let repo = REPO.handle(&octo);
    info!("Fetching all releases.");
    let releases = repo.all_releases().await?;
    let draft_releases = releases.into_iter().filter(|r| r.draft).collect_vec();
    info!("Found {} draft releases.", draft_releases.len());
    for release in draft_releases {
        let id = release.id;

        let route = format!("/repos/{repo}/releases/{id}");
        info!("Will delete {}: {route}.", release.name.unwrap_or_default());
        // Not `ReleasesHandler::delete`: it discards the response, so a failed delete would pass.
        let response = octo._delete(route, Option::<&()>::None).await?;
        let status = response.status();
        if !status.is_success() {
            let body = octo.body_to_string(response).await.unwrap_or_default();
            bail!("Failed to delete release {id}: {status}: {body}");
        }
    }

    info!("Done.");
    Ok(())
}
