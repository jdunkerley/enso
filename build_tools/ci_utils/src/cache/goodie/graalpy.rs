use crate::prelude::*;

use crate::cache::Cache;
use crate::cache::goodie;
use crate::env::known::PATH;
use crate::github::RepoRef;
use crate::programs::graalpy::GraalPy as GraalPyProgram;

use regex::Regex;

pub const CE_BUILDS_REPOSITORY: RepoRef = RepoRef { owner: "oracle", name: "graalpython" };

#[derive(Clone, Debug)]
pub struct GraalPy {
    pub version: Version,
    pub os: OS,
    pub arch: Arch,
}

fn graalpy_version_from_str(version_string: &str) -> Result<Version> {
    let line = version_string.lines().find(|line| line.contains("GraalVM CE")).context(
        "There is a Java environment available but it is not recognizable as GraalVM one.",
    )?;
    let re = Regex::new(r"GraalPy.*\((.+)\)").unwrap();
    let caps = re.captures(line).unwrap();
    Version::find_in_text(caps.get(1).context("graalpy wrong version text").unwrap().as_str())
}

async fn find_graalpy_version() -> Result<Version> {
    let text = GraalPyProgram.version_string().await?;
    graalpy_version_from_str(&text)
}

impl Goodie for GraalPy {
    fn get(&self, cache: &Cache) -> BoxFuture<'static, Result<PathBuf>> {
        goodie::download_try_url(self.url(), cache)
    }

    fn is_active(&self) -> BoxFuture<'static, Result<bool>> {
        let expected_graalpy_version = self.version.clone();
        async move {
            let found_version = find_graalpy_version().await?;
            ensure!(found_version == expected_graalpy_version, "GraalPy version mismatch. Expected {expected_graalpy_version}, found {found_version}.");
            Ok(true)
        }
            .boxed()
    }

    fn activation_env_changes(&self, package_path: &Path) -> Result<Vec<crate::env::Modification>> {
        let dir_entries = package_path
            .read_dir()
            .context("Failed to read GraalPy cache directory")?
            .collect_vec();
        let [graalpy_dir] = dir_entries.as_slice() else {
            bail!("GraalPy cache directory should contain exactly one directory");
        };
        let graalpy_dir = match graalpy_dir {
            Ok(dir_entry) => dir_entry,
            Err(err) => bail!("Failed to read GraalPy cache directory: {}", err),
        };
        let dir_name = graalpy_dir.file_name();
        let dir_name = dir_name.as_str();
        ensure!(dir_name.contains("graalpy"));
        ensure!(dir_name.contains(self.version.to_string_core().as_str()));
        Ok(vec![crate::env::Modification::prepend_path(&PATH, graalpy_dir.path().join("bin"))])
    }
}

impl GraalPy {
    /// Get the download URL.
    ///
    /// Built from the release's naming scheme rather than looked up through the GitHub API, so
    /// that a build whose cache is already warm needs no network access at all.
    ///
    /// ```
    /// use ide_ci::prelude::*;
    /// use ide_ci::cache::goodie::graalpy::GraalPy;
    ///
    /// # fn main() -> Result {
    /// let version = Version::from_str("25.0.1")?;
    /// let graalpy = GraalPy { version, os: OS::MacOS, arch: Arch::AArch64 };
    /// assert_eq!(
    ///     graalpy.url()?.as_str(),
    ///     "https://github.com/oracle/graalpython/releases/download/graal-25.0.1/graalpy-community-25.0.1-macos-aarch64.tar.gz"
    /// );
    /// # Ok(())
    /// # }
    /// ```
    pub fn url(&self) -> Result<Url> {
        let arch_name = match self.arch {
            Arch::X86_64 | Arch::AArch64 => self.arch.as_str(),
            other_arch => bail!("Unsupported architecture: {other_arch}."),
        };
        let extension = match self.os {
            OS::Windows => "zip",
            OS::Linux | OS::MacOS => "tar.gz",
        };
        let tag = format!("graal-{}", self.version);
        let asset_name =
            format!("graalpy-community-{}-{}-{arch_name}.{extension}", self.version, self.os);
        Ok(crate::github::release::download_asset(&CE_BUILDS_REPOSITORY, &tag, asset_name))
    }
}

#[cfg(test)]
mod tests {
    use crate::Arch;
    use crate::OS;
    use crate::cache::goodie::graalpy::GraalPy;
    use crate::cache::goodie::graalpy::graalpy_version_from_str;
    use semver::Version;

    #[test]
    fn version_recognize() {
        let expected_version = Version::new(23, 1, 0);
        let version_string = "GraalPy 3.10.8 (GraalVM CE Native 23.1.0)";
        let found_version = graalpy_version_from_str(version_string).unwrap();
        assert_eq!(found_version, expected_version);
    }

    #[test]
    fn download_url_per_platform() {
        let version = Version::new(25, 0, 1);
        let url =
            |os, arch| GraalPy { version: version.clone(), os, arch }.url().unwrap().to_string();
        let prefix = "https://github.com/oracle/graalpython/releases/download/graal-25.0.1";
        assert_eq!(
            url(OS::Linux, Arch::X86_64),
            format!("{prefix}/graalpy-community-25.0.1-linux-amd64.tar.gz")
        );
        assert_eq!(
            url(OS::MacOS, Arch::AArch64),
            format!("{prefix}/graalpy-community-25.0.1-macos-aarch64.tar.gz")
        );
        assert_eq!(
            url(OS::Windows, Arch::X86_64),
            format!("{prefix}/graalpy-community-25.0.1-windows-amd64.zip")
        );
    }
}
