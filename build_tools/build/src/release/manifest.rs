//! Description of the release assets.
//!
//! See [Assets].

use crate::prelude::*;

use crate::paths::TargetTriple;
use crate::project;
use crate::version::Versions;

/// Name of the assets manifest file.
///
/// The website uses this name to find the assets manifest, so it should be kept in sync.
pub const ASSETS_MANIFEST_FILENAME: &str = "assets.json";

/// A platform-specific asset being part of the release, see [Assets] for the purpose.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Asset {
    pub os: OS,
    pub arch: Arch,
    pub url: Url,
    /// User-friendly description of the target platform.
    pub target_pretty: String,
}

impl Asset {
    pub fn new(url: Url, triple: &TargetTriple) -> Self {
        let target_pretty = match (triple.os, triple.arch) {
            (OS::Windows, Arch::X86_64) => "Windows".into(),
            (OS::Linux, Arch::X86_64) => "Linux".into(),
            (OS::MacOS, Arch::X86_64) => "macOS (Intel)".into(),
            (OS::MacOS, Arch::AArch64) => "macOS (Apple silicon)".into(),
            (os, arch) => format!("{os} {arch}"),
        };
        Self { os: triple.os, arch: triple.arch, url, target_pretty }
    }

    /// The file name the asset is downloaded as.
    pub fn file_name(&self) -> Option<&str> {
        self.url.path_segments()?.next_back()
    }

    /// Description of the asset with IDE image.
    pub fn new_ide(repo: &impl IsRepo, triple: &TargetTriple) -> Self {
        let filename =
            project::ide::electron_image_filename(triple.os, triple.arch, &triple.versions.version);
        let url = ide_ci::github::release::download_asset(repo, &triple.versions.version, filename);
        Self::new(url, triple)
    }
}

/// Describes the assets that are part of the release: the IDE installers.
///
/// The information is used to:
/// * create `assets.json` file used by the project's website,
/// * fill information in the release description template.
// When changing the structure, make sure that it does not break the website.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assets {
    /// IDE packages. The exact format (e.g. installer vs AppImage) depends on the platform.
    pub ide: Vec<Asset>,
    /// Version of the release.
    pub version: Version,
}

impl Assets {
    pub fn new(repo: &impl IsRepo, version: &Version) -> Self {
        let mut ret = Self { ide: vec![], version: version.clone() };
        for (os, arch) in crate::ci_gen::RELEASE_TARGETS {
            let triple = TargetTriple { os, arch, versions: Versions::new(version.clone()) };
            ret.ide.push(Asset::new_ide(repo, &triple));
        }
        ret
    }

    /// Like [`Assets::new`], but only with the installers named in `uploaded`; the installers left
    /// out are returned alongside.
    ///
    /// The macOS release jobs do not block publishing (see `add_release_steps` in `ci_gen`), so a
    /// release can go out without its `.dmg`; the manifest must not advertise it then.
    pub fn new_uploaded(
        repo: &impl IsRepo,
        version: &Version,
        uploaded: &[String],
    ) -> (Self, Vec<Asset>) {
        let all = Self::new(repo, version);
        let (ide, missing) = all
            .ide
            .into_iter()
            .partition(|asset| uploaded.iter().any(|name| asset.file_name() == Some(name)));
        (Self { ide, version: all.version }, missing)
    }

    /// Iterate all the assets described in this manifest.
    pub fn assets(&self) -> impl Iterator<Item = &Asset> {
        self.ide.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_are_ide_installers_only() {
        let repo = ide_ci::github::Repo::new("enso-org", "enso");
        let version = Version::from_str("2026.2.0").unwrap();
        let assets = Assets::new(&repo, &version);
        let names: Vec<_> = assets
            .assets()
            .map(|asset| asset.url.path_segments().unwrap().next_back().unwrap().to_owned())
            .collect();
        assert_eq!(names.len(), 3, "{names:?}");
        for name in &names {
            assert!(name.starts_with("enso-"), "{name}");
            assert!([".exe", ".AppImage", ".dmg"].iter().any(|ext| name.ends_with(ext)), "{name}");
        }
    }

    #[test]
    fn uploaded_manifest_leaves_out_missing_installers() {
        let repo = ide_ci::github::Repo::new("enso-org", "enso");
        let version = Version::from_str("2026.2.0-rc.1").unwrap();
        let uploaded = vec![
            "enso-win-x64-2026.2.0-rc.1.exe".to_owned(),
            "enso-win-x64-2026.2.0-rc.1.exe.blockmap".to_owned(),
            "enso-linux-x86_64-2026.2.0-rc.1.AppImage".to_owned(),
            "latest.yml".to_owned(),
        ];
        let (assets, missing) = Assets::new_uploaded(&repo, &version, &uploaded);
        let names: Vec<_> = assets.assets().filter_map(Asset::file_name).collect();
        assert_eq!(
            names,
            ["enso-win-x64-2026.2.0-rc.1.exe", "enso-linux-x86_64-2026.2.0-rc.1.AppImage"]
        );
        let missing: Vec<_> = missing.iter().map(|asset| asset.target_pretty.as_str()).collect();
        assert_eq!(missing, ["macOS (Apple silicon)"]);
    }
}
