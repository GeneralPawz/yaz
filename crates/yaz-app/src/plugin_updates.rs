//! Asking a plugin's own repository what it has released.
//!
//! yaz holds no list of plugins it knows about. Each plugin says where its
//! releases come from, in its manifest's `updates` block, and this goes and
//! looks ([ADR-0021]). A plugin hosted somewhere nobody has written support for
//! is a `source` this does not handle yet, rather than a plugin we forbade.
//!
//! [ADR-0021]: https://github.com/texyaz/yaz/blob/main/docs/adr/0021-plugin-distribution.md

use crate::commands::{CommandError, Result};
use serde::Deserialize;
use yaz_plugin::{UpdateChannel, UpdateSource, Updates};

use crate::plugin_host::PluginHost;

/// How long to wait on a repository before giving up.
///
/// Short, because this is a button in a settings dialog and the honest answer
/// to a slow network is "could not reach it" rather than a spinner that never
/// stops.
const TIMEOUT_SECONDS: u64 = 10;

/// What GitHub says about one release. Only the fields that are needed.
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

/// The newest version a plugin's repository offers, if any.
///
/// `None` covers three situations that a person reads the same way: the plugin
/// takes no updates, the repository has no releases, and every release there is
/// a draft. The caller says "no release found" for all three, which is true and
/// is as much as anyone needs.
#[tauri::command]
pub async fn plugin_latest_release(
    plugin_id: String,
    host: tauri::State<'_, PluginHost>,
) -> Result<Option<String>> {
    let Some(updates) = host.updates_for(&plugin_id).await else {
        return Ok(None);
    };
    latest(&updates).await
}

/// Ask the source named in the manifest.
async fn latest(updates: &Updates) -> Result<Option<String>> {
    match updates.source {
        UpdateSource::Github => github(&updates.repository, updates.channel).await,
    }
}

/// GitHub's releases, newest first.
///
/// The list endpoint rather than `/releases/latest`, because "latest" on GitHub
/// means the newest non-prerelease — so a plugin following the prerelease
/// channel would be told it was up to date while its own prereleases sat there.
async fn github(repository: &str, channel: UpdateChannel) -> Result<Option<String>> {
    // A repository is `owner/name`, and anything else is a manifest mistake
    // worth refusing rather than pasting into a URL.
    if repository.split('/').count() != 2 || repository.contains("..") {
        return Err(CommandError::new(
            "error-plugin-repository",
            format!("not an owner/name repository: {repository}"),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECONDS))
        .user_agent(concat!("yaz/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| CommandError::new("error-plugin-update-check", error))?;

    let response = client
        .get(format!(
            "https://api.github.com/repos/{repository}/releases"
        ))
        .header("accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| CommandError::new("error-plugin-update-check", error))?;

    if !response.status().is_success() {
        return Err(CommandError::new(
            "error-plugin-update-check",
            format!("{repository} answered {}", response.status()),
        ));
    }

    let releases: Vec<Release> = response
        .json()
        .await
        .map_err(|error| CommandError::new("error-plugin-update-check", error))?;

    Ok(newest(&releases, channel))
}

/// The first release the channel accepts, with its `v` prefix taken off.
///
/// Separated from the request so it can be tested without a network: the
/// channel rule is the part with a decision in it.
fn newest(releases: &[Release], channel: UpdateChannel) -> Option<String> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .find(|release| match channel {
            UpdateChannel::Release => !release.prerelease,
            UpdateChannel::Prerelease => true,
            // The plugin says it takes no updates. Nothing here is for it, and
            // the caller has already said so — this arm exists so that adding
            // a channel is a compile error rather than a silent default.
            UpdateChannel::Manual => false,
        })
        .map(|release| release.tag_name.trim_start_matches('v').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool, draft: bool) -> Release {
        Release {
            tag_name: tag.to_owned(),
            prerelease,
            draft,
        }
    }

    #[test]
    fn takes_the_newest_published_release() {
        let releases = [
            release("v0.3.0", false, false),
            release("v0.2.0", false, false),
        ];
        assert_eq!(
            newest(&releases, UpdateChannel::Release),
            Some("0.3.0".to_owned())
        );
    }

    #[test]
    fn skips_a_prerelease_on_the_release_channel() {
        // The reason this does not use GitHub's `/releases/latest`: a plugin
        // following prereleases has to be able to see them, and one following
        // releases must not be offered one by accident.
        let releases = [
            release("v0.4.0-rc.1", true, false),
            release("v0.3.0", false, false),
        ];
        assert_eq!(
            newest(&releases, UpdateChannel::Release),
            Some("0.3.0".to_owned())
        );
        assert_eq!(
            newest(&releases, UpdateChannel::Prerelease),
            Some("0.4.0-rc.1".to_owned())
        );
    }

    #[test]
    fn ignores_a_draft_on_either_channel() {
        // A draft is not published. Offering one would send everybody to a
        // release page that only its author can see.
        let releases = [
            release("v0.5.0", false, true),
            release("v0.3.0", false, false),
        ];
        for channel in [UpdateChannel::Release, UpdateChannel::Prerelease] {
            assert_eq!(newest(&releases, channel), Some("0.3.0".to_owned()));
        }
    }

    #[test]
    fn a_plugin_that_takes_no_updates_is_offered_none() {
        // `manual` means the plugin arrives with the application and stays as
        // it is. A release existing does not change that.
        let releases = [release("v9.0.0", false, false)];
        assert_eq!(newest(&releases, UpdateChannel::Manual), None);
    }

    #[test]
    fn a_repository_with_no_releases_has_no_newest() {
        assert_eq!(newest(&[], UpdateChannel::Release), None);
    }

    #[tokio::test]
    async fn a_repository_that_is_not_owner_slash_name_is_refused() {
        // Straight into a URL otherwise. `..` in a path segment is the shape
        // that turns a repository name into a request somewhere else entirely.
        for bad in ["../../etc", "just-a-name", "a/b/c"] {
            let updates = Updates {
                source: UpdateSource::Github,
                repository: bad.to_owned(),
                channel: UpdateChannel::Release,
            };
            assert!(latest(&updates).await.is_err(), "{bad} was accepted");
        }
    }
}
