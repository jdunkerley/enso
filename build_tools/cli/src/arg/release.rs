use crate::prelude::*;

use clap::Args;
use clap::Subcommand;

/// Structure that represents `promote` subcommand arguments.
#[derive(Args, Clone, Copy, Debug)]
pub struct Promote {
    /// What kind of version is to be created.
    #[clap(value_enum)]
    pub designation: enso_build::version::promote::Designation,
}

#[derive(Subcommand, Clone, Debug)]
pub enum Action {
    /// Create a release draft on GitHub.
    CreateDraft,
    Publish,
    Promote(Promote),
    /// Record the released version as the latest one in `build-config.yaml`.
    ///
    /// A no-op for prereleases. Sets the `ENSO_LATEST_RELEASE_UPDATED` step output, so that CI
    /// only raises a pull request when the entry actually moved.
    UpdateLatestVersion,
}

#[derive(Args, Clone, Debug)]
pub struct Target {
    #[clap(subcommand)]
    pub action: Action,
}
