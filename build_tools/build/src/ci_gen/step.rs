use crate::prelude::*;

use crate::ci_gen::not_a_fork;
use crate::engine;
use crate::paths;

use ide_ci::actions::workflow::definition::Shell;
use ide_ci::actions::workflow::definition::Step;
use ide_ci::actions::workflow::definition::Target;
use ide_ci::actions::workflow::definition::env_expression;
use ide_ci::cache::goodie::graalvm;

pub fn test_reporter(
    step_name: impl Into<String>,
    report_name: impl Into<serde_yaml::Value>,
    path: impl Into<serde_yaml::Value>,
) -> Step {
    Step {
        name: Some(step_name.into()),
        uses: Some("dorny/test-reporter@v1".into()),
        // The action does not support running on forks.
        r#if: Some(format!("(success() || failure()) && {}", not_a_fork())),
        ..default()
    }
    .with_custom_argument("reporter", "java-junit")
    .with_custom_argument("path", path)
    .with_custom_argument("path-replace-backslashes", true)
    .with_custom_argument("max-annotations", 50) // 50 is the max
    .with_custom_argument("name", report_name)
}

/// Test reporter for the standard-library test jobs.
///
/// `allow_empty` tolerates a run that produced no report at all — used by the AWS job, which
/// skips itself (successfully) when no AWS credentials are configured.
pub fn stdlib_test_reporter(
    (os, arch): Target,
    graal_edition: graalvm::Edition,
    allow_empty: bool,
) -> Step {
    let step_name = "Standard Library Test Reporter";
    let report_name = format!("Standard Library Tests Report ({graal_edition}, {os}, {arch})");
    let path = format!("{}/*/*.xml", env_expression(&paths::ENSO_TEST_JUNIT_DIR));
    let step = test_reporter(step_name, report_name, path);
    if allow_empty { step.with_custom_argument("fail-on-empty", false) } else { step }
}

pub fn engine_test_reporter((os, arch): Target, graal_edition: graalvm::Edition) -> Step {
    let step_name = "Engine Test Reporter";
    let report_name = format!("Engine Tests Report ({graal_edition}, {os}, {arch})");
    let path = format!("{}/*.xml", env_expression(&paths::ENSO_TEST_JUNIT_DIR));
    test_reporter(step_name, report_name, path)
}

pub fn extra_stdlib_test_reporter((os, arch): Target, graal_edition: graalvm::Edition) -> Step {
    let step_name = "Extra Library Test Reporter";
    let report_name = format!("Extra Library Tests Report ({graal_edition}, {os}, {arch})");
    let path = format!("{}/*/*.xml", env_expression(&paths::ENSO_TEST_JUNIT_DIR));
    test_reporter(step_name, report_name, path)
}

/// Upload heap dump of a crashed JVM on OutOfMemoryError.
/// Note that there may be multiple `*.hprof` files if multiple processes crashed.
/// `artifact_name` should be unique for each job in the whole workflow.
pub fn heapdump_upload(artifact_name: impl Into<String>) -> Step {
    let path = "test/**/*.hprof\nengine/**/*.hprof";

    let mut step = upload_artifact("Upload Heap Dumps")
        .with_custom_argument("name", artifact_name.into())
        .with_custom_argument("path", path)
        .with_custom_argument("retention-days", 3)
        .with_custom_argument("if-no-files-found", "ignore");
    // This step should be run every time, but not on forks.
    step.r#if = Some(format!("(success() || failure()) && {}", not_a_fork()));
    step
}

pub fn upload_engine_distribution(
    target: Target,
    engine_launcher: engine::EngineLauncher,
    graal_edition: graalvm::Edition,
) -> Step {
    upload_artifact("Upload Engine Distribution")
        .with_custom_argument(
            "name",
            format!(
                "Engine Distribution ({}) ({}) ({}, {})",
                graal_edition, engine_launcher, target.0, target.1
            ),
        )
        .with_custom_argument("path", "built-distribution.tar")
}

pub fn download_engine_distribution(
    target: Target,
    engine_launcher: engine::EngineLauncher,
    graal_edition: graalvm::Edition,
) -> Step {
    download_artifact("Download Engine Distribution").with_custom_argument(
        "name",
        format!(
            "Engine Distribution ({}) ({}) ({}, {})",
            graal_edition, engine_launcher, target.0, target.1
        ),
    )
}

pub fn check_engine_distribution() -> Step {
    Step {
        run: Some("ls -l built-distribution.tar".into()),
        shell: Some(Shell::Bash),
        ..Default::default()
    }
}

pub fn unpack_engine_distribution() -> Step {
    Step {
        name: Some("Unpack Engine Distribution".into()),
        run: Some(
            "tar -xvf built-distribution.tar -C .
rm built-distribution.tar"
                .into(),
        ),
        ..Default::default()
    }
}

pub fn archive_engine_distribution(engine_launcher: engine::EngineLauncher) -> Step {
    let command = format!(
        "tar -cvf built-distribution.tar {}",
        built_distribution_directories(engine_launcher)
    );
    Step {
        name: Some("Archive Engine Distribution".into()),
        run: Some(command),
        ..Default::default()
    }
}

pub fn cleanup_engine_distribution(engine_launcher: engine::EngineLauncher) -> Step {
    Step {
        run: Some(format!("rm -rf {}", built_distribution_directories(engine_launcher))),
        shell: Some(Shell::Bash),
        ..Default::default()
    }
}

fn built_distribution_directories(engine_launcher: engine::EngineLauncher) -> String {
    format!(
        "built-distribution{}",
        match engine_launcher {
            engine::EngineLauncher::TestNative => " test",
            engine::EngineLauncher::TestDebugNative => " test",
            _ => "",
        }
    )
}

pub fn upload_artifact(step_name: impl Into<String>) -> Step {
    Step {
        name: Some(step_name.into()),
        uses: Some("actions/upload-artifact@v5".into()),
        ..default()
    }
}

pub fn download_artifact(step_name: impl Into<String>) -> Step {
    Step {
        name: Some(step_name.into()),
        uses: Some("actions/download-artifact@v5".into()),
        ..default()
    }
}

/// Name of the artifact holding the prebuilt Rust→WASM parser bindings and the generated
/// `ast.ts`. Downloaded into `app/` before `pnpm install` so the `build-wasm` / `generate-ast`
/// lifecycle scripts skip their (uncached, multi-minute) Cargo compile.
pub const WASM_ARTIFACTS_NAME: &str = "wasm-artifacts";

/// The two directories that make up [`WASM_ARTIFACTS_NAME`]. Their common ancestor is `app/`,
/// so the artifact is downloaded with `path: app`.
pub const WASM_ARTIFACTS_PATHS: &str = "app/rust-ffi/dist\napp/ydoc-shared/src/ast/generated";

/// A `Swatinem/rust-cache` step. `shared_key` groups the cache across jobs that compile the
/// same crates; the cache is only written from the default branch to keep PR runs from
/// thrashing it.
pub fn rust_cache(shared_key: impl Into<String>) -> Step {
    Step {
        name: Some("Cache Rust build".into()),
        uses: Some("Swatinem/rust-cache@v2".into()),
        ..default()
    }
    .with_custom_argument("shared-key", shared_key.into())
    .with_custom_argument("save-if", "${{ github.ref == 'refs/heads/develop' }}")
}

/// Installs the pinned `wasm-bindgen-cli` from a prebuilt binary (seconds, versus the
/// multi-minute `cargo install` that `build-wasm.mjs` falls back to). Keep the version in
/// lockstep with `wasm-bindgen` in `Cargo.toml` and `WASM_BINDGEN_VERSION` in `build-wasm.mjs`.
pub fn install_wasm_bindgen() -> Step {
    Step {
        name: Some("Install wasm-bindgen-cli".into()),
        uses: Some("taiki-e/install-action@v2".into()),
        ..default()
    }
    .with_custom_argument("tool", "wasm-bindgen-cli@0.2.100")
}

/// Uploads [`WASM_ARTIFACTS_NAME`] from the current checkout.
pub fn upload_wasm_artifacts() -> Step {
    upload_artifact("Upload WASM parser artifacts")
        .with_custom_argument("name", WASM_ARTIFACTS_NAME)
        .with_custom_argument("path", WASM_ARTIFACTS_PATHS)
        .with_custom_argument("if-no-files-found", "error")
        .with_custom_argument("retention-days", 1)
}

/// Downloads [`WASM_ARTIFACTS_NAME`] into `app/` (see [`WASM_ARTIFACTS_PATHS`]).
pub fn download_wasm_artifacts() -> Step {
    download_artifact("Download WASM parser artifacts")
        .with_custom_argument("name", WASM_ARTIFACTS_NAME)
        .with_custom_argument("path", "app")
}
