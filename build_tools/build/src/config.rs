use crate::prelude::*;

use ide_ci::program;
use ide_ci::programs;
use semver::VersionReq;

/// The `build-config.yaml` key recording the most recent stable Enso release.
pub const LATEST_RELEASE_KEY: &str = "latest-release";

/// Load the build configuration, based on the `build-config.yaml` and `.node-version` files in
/// the repo root.
pub fn load() -> Result<Config> {
    let yaml_text = include_str!("../../../build-config.yaml");
    let node_version = include_str!("../../../.node-version").trim();
    let mut raw = serde_yaml::from_str::<ConfigRaw>(yaml_text)?;
    raw.required_versions.insert("node".to_owned(), node_version.to_owned());
    raw.try_into()
}

#[derive(Clone, Debug, Display, PartialEq, Eq, Hash, Serialize, Deserialize, strum::EnumString)]
pub enum RecognizedProgram {
    #[strum(default)]
    Other(String),
}

impl RecognizedProgram {
    pub async fn version(&self) -> Result<Version> {
        match self {
            RecognizedProgram::Other(program) => {
                if let Some(cargo_program) = program.strip_prefix("cargo-") {
                    // Special case for cargo-programs. Cargo is able to find them even if they are
                    // not in PATH. Thus, we invoke them via cargo, not to spuriously fail the
                    // version check.
                    let version_string = programs::Cargo
                        .cmd()?
                        .arg(cargo_program)
                        .arg("--version")
                        .run_stdout()
                        .await?;
                    Version::find_in_text(&version_string)
                } else {
                    program::Unknown(program.clone()).version().await
                }
            }
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ConfigRaw {
    pub required_versions: HashMap<String, String>,
    #[serde(default)]
    pub latest_release: Option<Version>,
}

/// The configuration of the script that is being provided by the external environment.
///
/// In our case, it is usually a configuration file in the main repository.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Config {
    pub required_versions: HashMap<RecognizedProgram, VersionReq>,
    /// The most recent stable Enso release, as recorded in `build-config.yaml`.
    ///
    /// Builds that are not given an explicit `ENSO_VERSION` derive their `<next stable>-dev`
    /// version from this instead of listing the repository's remote tags. `None` (the key is
    /// absent) falls back to asking the remote.
    pub latest_release: Option<Version>,
}

impl Config {
    /// Check whether all the required programs are available and have the required versions.
    pub async fn check_programs(&self) -> Result {
        let check_tasks = self
            .required_versions
            .iter()
            .map(|(program, version_req)| check_program(program, version_req));
        let results = futures::future::join_all(check_tasks).await;
        let errors = results.into_iter().filter_map(Result::err).collect_vec();
        if !(errors.is_empty()) {
            bail!("Some required programs are not available or have wrong versions: {errors:?}")
        }
        Ok(())
    }
}

impl TryFrom<ConfigRaw> for Config {
    type Error = anyhow::Error;

    fn try_from(value: ConfigRaw) -> std::result::Result<Self, Self::Error> {
        let mut required_versions = HashMap::new();
        for (program, version_req) in value.required_versions {
            required_versions.insert(
                RecognizedProgram::from_str(&program)?,
                VersionReq::from_str(&version_req)?,
            );
        }

        Ok(Self { required_versions, latest_release: value.latest_release })
    }
}

/// Rewrite the [`LATEST_RELEASE_KEY`] entry of a `build-config.yaml` to `version`.
///
/// Line-wise rather than a serde round-trip, so that the file's comments and layout survive.
/// Fails if the key is absent — silently adding it would hide a renamed or removed entry.
pub fn with_latest_release(config_yaml: &str, version: &Version) -> Result<String> {
    let prefix = format!("{LATEST_RELEASE_KEY}:");
    let mut found = false;
    let mut lines = Vec::new();
    for line in config_yaml.lines() {
        if line.starts_with(&prefix) {
            found = true;
            lines.push(format!("{LATEST_RELEASE_KEY}: {version}"));
        } else {
            lines.push(line.to_owned());
        }
    }
    ensure!(found, "The build configuration has no `{LATEST_RELEASE_KEY}` entry to update.");
    let mut ret = lines.join("\n");
    if config_yaml.ends_with('\n') {
        ret.push('\n');
    }
    Ok(ret)
}

/// Check if the given program is installed in the system and has the required version.
pub async fn check_program(program: &RecognizedProgram, version_req: &VersionReq) -> Result {
    let found = program.version().await?;
    if !version_req.matches(&found) {
        bail!(
            "Found program `{}` in version `{}` that does not fulfill requirement `{}`.",
            program,
            found,
            version_req
        );
    } else {
        info!(
            "Found program `{}` in supported version `{}` (required `{}`).",
            program, found, version_req
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ide_ci::programs::Node;

    #[tokio::test]
    async fn check_node_version() -> Result {
        setup_logging().ok();

        let version = Node.parse_version("v16.13.2")?;
        let requirement = VersionReq::parse("=16.15.0")?;
        assert!(!requirement.matches(&version));
        Ok(())
    }

    #[tokio::test]
    #[ignore]
    async fn deserialize() -> Result {
        setup_logging().ok();
        let config = r#"
# Options intended to be common for all developers.
wasm-size-limit: "4.37MB"
required-versions:
  node: =16.15.0
  flatc: =1.12.0
"#;
        let config = serde_yaml::from_str::<ConfigRaw>(config)?;
        dbg!(&config);
        dbg!(Config::try_from(config))?.check_programs().await?;

        Ok(())
    }

    #[tokio::test]
    async fn deserialize_config_in_repo() -> Result {
        setup_logging().ok();
        // let config = include_str!("../../../build-config.yaml");
        let config = r#"# Options intended to be common for all developers.

wasm-size-limit: 15.25 MiB

required-versions:
  cargo-watch: ^8.1.1
  node: =16.15.0
#  TODO [mwu]: Script can install `flatc` later on (if `conda` is present), so this is not required. However it should
#              be required, if `conda` is missing.
#  flatc: =1.12.0
"#;
        let config = serde_yaml::from_str::<ConfigRaw>(config)?;
        dbg!(&config);
        dbg!(Config::try_from(config))?;
        Ok(())
    }

    #[test]
    fn updating_latest_release_keeps_the_rest_of_the_file() -> Result {
        let config =
            "# A comment.\n\nlatest-release: 2025.3.4\n\nrequired-versions:\n  node: =16.15.0\n";
        let updated = with_latest_release(config, &Version::from_str("2026.1.1")?)?;
        assert_eq!(
            updated,
            "# A comment.\n\nlatest-release: 2026.1.1\n\nrequired-versions:\n  node: =16.15.0\n"
        );
        // Re-applying the same version is a no-op, so a release that did not move the key leaves
        // the file (and therefore the pull request) empty.
        assert_eq!(with_latest_release(&updated, &Version::from_str("2026.1.1")?)?, updated);
        Ok(())
    }

    #[test]
    fn updating_latest_release_requires_the_key() {
        let config = "wasm-size-limit: 16.20 MiB\n";
        assert!(with_latest_release(config, &Version::new(2026, 1, 1)).is_err());
    }

    #[test]
    fn repo_build_config_is_updatable() -> Result {
        // The real file must stay parseable *and* rewritable, since the release workflow edits it.
        let config = include_str!("../../../build-config.yaml");
        let parsed = serde_yaml::from_str::<ConfigRaw>(config)?;
        assert!(parsed.latest_release.is_some());
        with_latest_release(config, &Version::new(2026, 1, 1))?;
        Ok(())
    }
}
