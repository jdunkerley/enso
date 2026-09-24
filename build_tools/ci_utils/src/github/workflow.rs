use crate::prelude::*;

use crate::github;

/// HTTP body payload for the workflow dispatch.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct RequestBody<S, T> {
    /// Reference to the commit or branch to build. Should be string-like.
    pub r#ref: S,

    /// Inputs to the workflow.
    pub inputs: T,
}

// Function that invokes GitHub API REST API workflow dispatch.
pub async fn dispatch<R: IsRepo>(
    repo: &github::repo::Handle<R>,
    workflow_id: impl AsRef<str> + Send + Sync + 'static,
    r#ref: impl AsRef<str> + Send + Sync + 'static,
    inputs: &impl Serialize,
) -> Result {
    // We check the status ourselves rather than use octocrab's `WorkflowDispatchBuilder`: octocrab
    // 0.17 treated an error response (e.g. 404 for an unknown workflow) as success, which is what
    // the old `enso-org/octocrab` fork patched. Upstream fixed it since, but a raw POST keeps the
    // error body in our message and does not depend on the builder staying fixed.
    let workflow_id = workflow_id.as_ref();
    let name = repo.name();
    let owner = repo.owner();
    let route = format!("/repos/{owner}/{name}/actions/workflows/{workflow_id}/dispatches");
    let r#ref = r#ref.as_ref();
    let body = RequestBody { r#ref, inputs };
    let response = repo.octocrab._post(route, Some(&body)).await?;
    let status = response.status();
    if !status.is_success() {
        let body = repo
            .octocrab
            .body_to_string(response)
            .await
            .unwrap_or_else(|e| format!("<failed to read the response body: {e}>"));
        bail!("Dispatching workflow {workflow_id} in {repo} failed with {status}: {body}");
    }
    // Nothing interesting in OK response, so we just return empty struct.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::github::Repo;
    use wiremock::Mock;
    use wiremock::MockServer;
    use wiremock::ResponseTemplate;
    use wiremock::matchers::method;
    use wiremock::matchers::path;

    const DISPATCH_PATH: &str = "/repos/enso-org/enso/actions/workflows/build.yml/dispatches";

    async fn dispatch_against(status: u16) -> Result {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(DISPATCH_PATH))
            .respond_with(ResponseTemplate::new(status).set_body_string(r#"{"message":"Nope"}"#))
            .expect(1)
            .mount(&server)
            .await;
        let octocrab = Octocrab::builder().base_uri(server.uri())?.build()?;
        let repo = Repo::new("enso-org", "enso").into_handle(&octocrab);
        dispatch(&repo, "build.yml", "develop", &serde_json::json!({})).await
    }

    #[tokio::test]
    async fn successful_dispatch_is_ok() -> Result {
        dispatch_against(204).await
    }

    /// The behaviour the `enso-org/octocrab` fork existed for: an error status must be an error.
    #[tokio::test]
    async fn failed_dispatch_is_an_error() {
        for status in [404, 422, 500] {
            let error = dispatch_against(status).await.expect_err("Dispatch should have failed.");
            let message = format!("{error:#}");
            assert!(message.contains(&status.to_string()), "{message}");
            assert!(message.contains("Nope"), "{message}");
        }
    }
}
