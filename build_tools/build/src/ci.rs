// ==============
// === Export ===
// ==============

pub mod input;

/// Labels used in the repositories where this library is used for CI.
/// They should be defined in the `.github/settings.yml` file.
pub mod labels {
    /// Name of the label that is used to mark the PRs that should not require changelog entry.
    pub const NO_CHANGELOG_CHECK: &str = "CI: No changelog needed";

    /// Name of the label that is used to mark the PRs that require clean builds.
    pub const CLEAN_BUILD_REQUIRED: &str = "CI: Clean build required";

    /// Name of the label that forces the GUI checks and the IDE packaging to run on a PR even when
    /// no file they depend on changed.
    ///
    /// The generated workflows do not use it: it is matched in the hand-written
    /// `.github/workflows/ide-pull-request.yml` and `gui-pull-request.yml`, which decide whether
    /// those jobs run. It is listed here so that this module remains the catalogue of CI labels.
    pub const BUILD_IDE: &str = "CI: Build IDE";
}

/// Names used to represent common workflow dispatch events inputs.
pub mod inputs {
    /// Input allowing to request a clean build for the workflow.
    pub const CLEAN_BUILD_REQUIRED: &str = "clean_build_required";
}

/// Check if this is a "big memory" machine.
///
/// Our self-hosted runners are big memory machines, but the GitHub-hosted ones are not.
///
/// Certain CI operations are only performed on big machines, as they require a lot of memory.
pub fn big_memory_machine() -> bool {
    let github_hosted_macos_memory = 15_032_385_536;
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.total_memory() > github_hosted_macos_memory
}
