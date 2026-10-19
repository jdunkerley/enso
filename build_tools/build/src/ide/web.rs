//! Code for dealing with JS/TS components of the GUI1 and the Electron client (IDE).

use crate::prelude::*;

use crate::paths::generated;
use crate::project::IsArtifact;

use ide_ci::program::command::FallibleManipulator;
use ide_ci::program::command::Manipulator;
use ide_ci::programs::Pnpm;
use ide_ci::programs::node::PnpmCommand;
use sha2::Digest;
use std::process::Stdio;

// ==============
// === Export ===
// ==============

pub mod env {
    use super::*;

    use ide_ci::define_env_var;

    define_env_var! {
        ENSO_BUILD_IDE, PathBuf;
        ENSO_BUILD_BACKEND, PathBuf;
        ENSO_BUILD_GUI, PathBuf;
        ENSO_BUILD_SIGN, bool;
        /// List of files that should be copied to the Gui.
        ENSO_BUILD_GUI_WASM_ARTIFACTS, Vec<PathBuf>;
        ENSO_BUILD_GUI_ASSETS, PathBuf;
        ENSO_BUILD_IDE_BUNDLED_ENGINE_VERSION, Version;
    }

    // === Electron Builder ===
    pub use ide_ci::env::known::electron_builder::*;

    // GUI-specific environment variables
    define_env_var! {
        /// The Enso web host, for the contact page link.
        ENSO_IDE_HOST, String;

        /// The Sentry DSN for error reporting in this environment.
        ENSO_IDE_SENTRY_DSN, String;

        /// The Sentry organization to push the source maps to.
        ENSO_IDE_SENTRY_ORGANIZATION, String;

        /// The Sentry project to push the source maps to.
        ENSO_IDE_SENTRY_PROJECT, String;

        /// The Google Analytics tag to which Google Analytics events should be sent.
        ENSO_IDE_GOOGLE_ANALYTICS_TAG, String;

        /// License key for the AG Grid library.
        ENSO_IDE_AG_GRID_LICENSE_KEY, String;

        ENSO_IDE_COMMIT_HASH, String;
        ENSO_IDE_VERSION, String;

        /// `auto` or `manual`: whether the packaged app may update itself.
        ENSO_IDE_UPDATES, String;

        /// Vite mode.
        MODE, String;
    }
}

/// Name of the directory with the unpacked Electron package.
///
/// The directory is created by the `electron-builder` utility in the output directory when run
/// with the `dir` target. It is also usually created for other targets, as it is an intermediate
/// step in the packaging process.
///
/// # Panics
/// This function panics if the provided OS and architecture combination is not supported.
pub fn unpacked_dir(output_path: impl AsRef<Path>, os: OS, arch: Arch) -> PathBuf {
    let segment_name = match (os, arch) {
        (OS::Linux, Arch::X86_64) => "linux-unpacked",
        (OS::MacOS, Arch::AArch64) => "mac-arm64",
        (OS::MacOS, Arch::X86_64) => "mac",
        (OS::Windows, Arch::X86_64) => "win-unpacked",
        _ => todo!("{os}-{arch} combination is not supported"),
    };
    output_path.as_ref().join(segment_name)
}

/// Computes the SHA-256 checksum of a file and writes it to a file.
///
/// This is a Rust equivalent of the `app/electron-client/tasks/computeHashes.ts`.
pub fn store_sha256_checksum(file: impl AsRef<Path>, checksum_file: impl AsRef<Path>) -> Result {
    let mut hasher = sha2::Sha256::new();
    let mut file = ide_ci::fs::open(&file)?;
    // `sha2` 0.11 dropped its `io::Write` impl, so stream the file by hand.
    let mut buffer = vec![0; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let hash: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    ide_ci::fs::write(&checksum_file, hash)?;
    Ok(())
}

/// When secrets are not available in CI builds (e.g. when building a PR from a fork), the variables
/// are set to empty strings. This manipulator removes such variables from the environment.
#[derive(Clone, Copy, Debug)]
pub struct RemoveEmptyCscEnvVars;

impl Manipulator for RemoveEmptyCscEnvVars {
    fn apply<C: IsCommandWrapper + ?Sized>(&self, command: &mut C) {
        for var in ide_ci::env::known::electron_builder::CI_CSC_SECRETS {
            match std::env::var(var) {
                Ok(value) if value.is_empty() => {
                    command.env_remove(var);
                }
                _ => {}
            }
        }
    }
}

pub fn target_os_flag(os: OS) -> Result<&'static str> {
    match os {
        OS::Windows => Ok("--win"),
        OS::Linux => Ok("--linux"),
        OS::MacOS => Ok("--mac"),
    }
}

/// Context information about Backend bundle that we provide to the client.
#[derive(Clone, Debug)]
pub struct BackendInfo {
    /// Latest bundled engine version, that will be used as this IDE's default.
    pub latest_bundled_engine: Version,
    /// Root of the Backend bundle.
    pub bundle_location: PathBuf,
}

impl BackendInfo {
    /// Collect information about the bundle that the client will need.
    pub fn new(bundle: &crate::project::backend::Artifact) -> Result<Self> {
        let latest_bundled_engine = bundle.latest_engine_version()?.clone();
        let bundle_location = bundle.path.to_path_buf();
        Ok(Self { latest_bundled_engine, bundle_location })
    }
}

impl FallibleManipulator for BackendInfo {
    fn try_applying<C: IsCommandWrapper + ?Sized>(&self, command: &mut C) -> Result {
        command.set_env(env::ENSO_BUILD_BACKEND, &self.bundle_location)?;
        command.set_env(env::ENSO_BUILD_IDE_BUNDLED_ENGINE_VERSION, &self.latest_bundled_engine)?;
        Ok(())
    }
}

#[derive(Clone)]
#[derive_where(Debug)]
pub struct IdeDesktop {
    pub repo_root: generated::RepoRoot,
    #[derive_where(skip)]
    pub octocrab: Octocrab,
    pub cache: ide_ci::cache::Cache,
}

impl IdeDesktop {
    pub fn new(
        repo_root: &generated::RepoRoot,
        octocrab: Octocrab,
        cache: ide_ci::cache::Cache,
    ) -> Self {
        Self { repo_root: repo_root.clone(), octocrab, cache }
    }

    pub fn pnpm(&self) -> Result<PnpmCommand> {
        let mut command = Pnpm.cmd()?;
        command.current_dir(&self.repo_root);
        command.stdin(Stdio::null()); // nothing in that process subtree should require input
        Ok(command)
    }

    /// Build the full Electron package, using the electron-builder.
    #[allow(clippy::too_many_arguments)]
    #[tracing::instrument(name="Preparing distribution of the IDE.", skip_all, fields(
        dest = %output_path.as_ref().display(),
        ?gui,
        ?backend,
        ?target_os,
        ?target,
        ?sign,
        err))]
    pub async fn dist(
        &self,
        version: &Version,
        commit_hash: &str,
        gui: &impl IsArtifact,
        backend: &crate::project::backend::Artifact,
        output_path: impl AsRef<Path>,
        target_os: OS,
        target: Option<String>,
        sign: bool,
    ) -> Result {
        let output_path = output_path.as_ref();
        if TARGET_OS == OS::MacOS && env::CSC_KEY_PASSWORD.is_set() {
            // This means that we will be doing code signing on MacOS. This requires JDK environment
            // to be set up.
            let graalvm =
                crate::engine::deduce_graal(&self.repo_root.project.dependencies_scala).await?;
            graalvm.install_if_missing(&self.cache).await?;
        }

        let version_string = version.to_string();
        crate::web::install(&self.repo_root).await?;
        let backend_bundle = BackendInfo::new(backend)?;
        let sign_artifacts = &sign;
        let mac_signed = std::env::var("CSC_LINK").is_ok_and(|link| !link.is_empty()) && sign;
        let updates = update_mode(version, target_os, mac_signed);
        self.pnpm()?
            .set_env(env::ENSO_IDE_COMMIT_HASH, &commit_hash)?
            .set_env(env::ENSO_IDE_VERSION, &version_string)?
            .set_env(env::ENSO_IDE_UPDATES, &updates)?
            .set_env(env::ENSO_BUILD_GUI, gui.as_ref())?
            .set_env(env::ENSO_BUILD_IDE, output_path)?
            .set_env(env::ENSO_BUILD_SIGN, sign_artifacts)?
            .try_applying(&backend_bundle)?
            .run("build:ide")
            .run_ok()
            .await?;

        let target_args = match target {
            Some(target) => vec!["--target".to_string(), target],
            None => vec![],
        };

        self.pnpm()?
            .apply(&RemoveEmptyCscEnvVars)
            .set_env(env::ENSO_IDE_COMMIT_HASH, &commit_hash)?
            .set_env(env::ENSO_IDE_VERSION, &version_string)?
            .set_env(env::ENSO_IDE_UPDATES, &updates)?
            .set_env(env::ENSO_BUILD_GUI, gui.as_ref())?
            .set_env(env::ENSO_BUILD_IDE, output_path)?
            .set_env(env::ENSO_BUILD_SIGN, sign_artifacts)?
            .set_env(env::ENSO_BUILD_BACKEND, backend.as_ref())?
            .run("dist:ide")
            .arg("--")
            .arg(target_os_flag(target_os)?)
            .args(target_args)
            .run_ok()
            .await?;
        Ok(())
    }
}

/// Whether the packaged app may update itself: not for dev builds, and on macOS only when signed
/// (an unsigned app cannot replace itself there).
pub fn update_mode(version: &Version, target_os: OS, mac_signed: bool) -> &'static str {
    let is_dev = version.pre.as_str().contains("dev");
    if is_dev || (target_os == OS::MacOS && !mac_signed) { "manual" } else { "auto" }
}

#[cfg(test)]
mod update_mode_tests {
    use super::*;

    #[test]
    fn dev_builds_and_unsigned_macos_are_manual() {
        let release = Version::parse("2026.2.0").unwrap();
        let rc = Version::parse("2026.2.0-rc.1").unwrap();
        let dev = Version::parse("2026.10.18-dev").unwrap();
        assert_eq!(update_mode(&release, OS::Windows, false), "auto");
        assert_eq!(update_mode(&rc, OS::Linux, false), "auto");
        assert_eq!(update_mode(&dev, OS::Windows, false), "manual");
        assert_eq!(update_mode(&release, OS::MacOS, false), "manual");
        assert_eq!(update_mode(&release, OS::MacOS, true), "auto");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FIPS 180-2 test vectors. The million-byte input spans several reads of the buffer.
    #[test]
    fn sha256_checksum_matches_known_vectors() -> Result {
        let dir = tempfile::tempdir()?;
        let cases = [
            (b"abc".to_vec(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            (
                vec![b'a'; 1_000_000],
                "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            ),
        ];
        for (input, expected) in cases {
            let file = dir.path().join("input");
            let checksum = dir.path().join("checksum");
            ide_ci::fs::write(&file, &input)?;
            store_sha256_checksum(&file, &checksum)?;
            assert_eq!(ide_ci::fs::read_to_string(&checksum)?, expected);
        }
        Ok(())
    }
}
