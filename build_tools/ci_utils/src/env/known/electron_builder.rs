//! Environment variables used by the Electron Builder.

use crate::define_env_var;

define_env_var! {
    /// The HTTPS link (or base64-encoded data, or file:// link, or local path) to certificate
    /// (*.p12 or *.pfx file). Shorthand ~/ is supported (home directory).
    WIN_CSC_LINK, String;

    /// The password to decrypt the certificate given in WIN_CSC_LINK.
    WIN_CSC_KEY_PASSWORD, String;

    /// The HTTPS link (or base64-encoded data, or file:// link, or local path) to certificate
    /// (*.p12 or *.pfx file). Shorthand ~/ is supported (home directory).
    CSC_LINK, String;

    /// The password to decrypt the certificate given in CSC_LINK.
    CSC_KEY_PASSWORD, String;

    /// The username of apple developer account.
    APPLEID, String;

    /// The app-specific password (not Apple ID password). See:
    /// https://support.apple.com/HT204397
    APPLEIDPASS, String;

    /// Apple Team ID.
    APPLETEAMID, String;

    /// `true` or `false`. Defaults to `true` — on a macOS development machine valid and
    /// appropriate identity from your keychain will be automatically used.
    CSC_IDENTITY_AUTO_DISCOVERY, bool;

    /// Note that enabling CSC_FOR_PULL_REQUEST can pose serious security risks. Refer to the
    /// [CircleCI documentation](https://circleci.com/docs/1.0/fork-pr-builds/) for more
    /// information. If the project settings contain SSH keys, sensitive environment variables,
    /// or AWS credentials, and untrusted forks can submit pull requests to your repository, it
    /// is not recommended to enable this option.
    CSC_FOR_PULL_REQUEST, bool;
}

/// Environment variables set from CI-provided secrets that allow code signing.
///
/// These variables might be set to empty strings if the secrets are not available in the CI.
pub const CI_CSC_SECRETS: &[&str] = &[
    WIN_CSC_LINK.name,
    WIN_CSC_KEY_PASSWORD.name,
    CSC_LINK.name,
    CSC_KEY_PASSWORD.name,
    APPLEID.name,
    APPLEIDPASS.name,
    APPLETEAMID.name,
];
