// Copyright Motia LLC and/or licensed to Motia LLC under one or more
// contributor license agreements. Licensed under the Elastic License 2.0;
// you may not use this file except in compliance with the Elastic License 2.0.
// This software is patent protected. We welcome discussions - reach out at support@motia.dev
// See LICENSE and PATENTS files for details.

use semver::Version;
use serde::Deserialize;

use super::error::{NetworkError, RegistryError};
use super::registry::BinarySpec;

/// A GitHub release from the /releases/latest endpoint.
#[derive(Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
    pub assets: Vec<ReleaseAsset>,
}

/// A single asset in a GitHub release.
#[derive(Debug, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

/// Build an HTTP client with proper configuration.
pub fn build_client() -> Result<reqwest::Client, reqwest::Error> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("iii/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30));

    // Support optional GitHub token for higher rate limits
    if let Some(token) = github_token() {
        use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
        let mut headers = HeaderMap::new();
        if let Ok(val) = HeaderValue::from_str(&format!("token {}", token)) {
            headers.insert(AUTHORIZATION, val);
        }
        builder = builder.default_headers(headers);
    }

    builder.build()
}

/// Get the GitHub token from environment variables.
fn github_token() -> Option<String> {
    std::env::var("III_GITHUB_TOKEN")
        .or_else(|_| std::env::var("GITHUB_TOKEN"))
        .ok()
}

pub async fn fetch_latest_release(
    client: &reqwest::Client,
    spec: &BinarySpec,
) -> Result<Release, IiiGithubError> {
    match spec.tag_prefix {
        Some(prefix) => fetch_latest_release_by_prefix(client, spec, prefix).await,
        None => fetch_latest_release_simple(client, spec).await,
    }
}

async fn fetch_latest_release_simple(
    client: &reqwest::Client,
    spec: &BinarySpec,
) -> Result<Release, IiiGithubError> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", spec.repo);

    let response = client.get(&url).send().await?;

    match response.status() {
        status if status.is_success() => {
            let release: Release = response.json().await?;
            Ok(release)
        }
        status if status == reqwest::StatusCode::FORBIDDEN => {
            Err(IiiGithubError::Network(NetworkError::RateLimited))
        }
        status if status == reqwest::StatusCode::NOT_FOUND => Err(IiiGithubError::Registry(
            RegistryError::NoReleasesAvailable {
                binary: spec.name.to_string(),
            },
        )),
        _status => Err(IiiGithubError::Network(NetworkError::RequestFailed(
            response.error_for_status().unwrap_err(),
        ))),
    }
}

async fn fetch_latest_release_by_prefix(
    client: &reqwest::Client,
    spec: &BinarySpec,
    prefix: &str,
) -> Result<Release, IiiGithubError> {
    let include_prereleases = current_version_allows_prereleases();

    if !include_prereleases {
        // Try /releases/latest first — single API call, GitHub guarantees non-prerelease
        let latest_url = format!("https://api.github.com/repos/{}/releases/latest", spec.repo);

        if let Ok(response) = client.get(&latest_url).send().await
            && response.status().is_success()
            && let Ok(release) = response.json::<Release>().await
            && tag_matches_prefix(&release.tag_name, prefix)
            && !release.prerelease
        {
            return Ok(release);
        }
    }

    // Fallback: list releases and filter by prefix (monorepo edge case)
    let list_url = format!(
        "https://api.github.com/repos/{}/releases?per_page=30",
        spec.repo
    );

    let response = client.get(&list_url).send().await?;

    match response.status() {
        status if status.is_success() => {
            let releases: Vec<Release> = response.json().await?;
            select_release_by_prefix(releases, prefix, include_prereleases).ok_or_else(|| {
                IiiGithubError::Registry(RegistryError::NoReleasesAvailable {
                    binary: spec.name.to_string(),
                })
            })
        }
        status if status == reqwest::StatusCode::FORBIDDEN => {
            Err(IiiGithubError::Network(NetworkError::RateLimited))
        }
        _status => Err(IiiGithubError::Network(NetworkError::RequestFailed(
            response.error_for_status().unwrap_err(),
        ))),
    }
}

fn current_version_allows_prereleases() -> bool {
    version_allows_prereleases(env!("CARGO_PKG_VERSION"))
}

fn version_allows_prereleases(version: &str) -> bool {
    Version::parse(version)
        .map(|version| !version.pre.is_empty())
        .unwrap_or(false)
}

fn select_release_by_prefix(
    releases: Vec<Release>,
    prefix: &str,
    include_prereleases: bool,
) -> Option<Release> {
    let tag_prefix = format!("{}/v", prefix);

    releases
        .into_iter()
        .filter(|release| {
            release.tag_name.starts_with(&tag_prefix)
                && (include_prereleases || !release.prerelease)
        })
        .filter_map(|release| {
            parse_release_version(&release.tag_name)
                .ok()
                .map(|v| (v, release))
        })
        .max_by(|(left, _), (right, _)| left.cmp(right))
        .map(|(_, release)| release)
}

/// Helper error that can be either Network or Registry.
#[derive(Debug, thiserror::Error)]
pub enum IiiGithubError {
    #[error(transparent)]
    Network(#[from] NetworkError),
    #[error(transparent)]
    Registry(#[from] RegistryError),
    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),
}

/// Find the download URL for a specific asset in a release.
pub fn find_asset<'a>(release: &'a Release, asset_name: &str) -> Option<&'a ReleaseAsset> {
    release.assets.iter().find(|a| a.name == asset_name)
}

/// Parse a version from a release tag (strips leading 'v' if present).
pub fn parse_release_version(tag: &str) -> Result<Version, semver::Error> {
    let without_prefix = tag.rsplit_once('/').map(|(_, rest)| rest).unwrap_or(tag);
    let cleaned = without_prefix.strip_prefix('v').unwrap_or(without_prefix);
    Version::parse(cleaned)
}

/// Check if a release tag matches the expected prefix pattern (`{prefix}/v*`).
fn tag_matches_prefix(tag: &str, prefix: &str) -> bool {
    tag.starts_with(&format!("{}/v", prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_release_version() {
        assert_eq!(
            parse_release_version("v0.2.4").unwrap(),
            Version::new(0, 2, 4)
        );
        assert_eq!(
            parse_release_version("0.2.4").unwrap(),
            Version::new(0, 2, 4)
        );
        assert_eq!(
            parse_release_version("v1.0.0").unwrap(),
            Version::new(1, 0, 0)
        );
        assert_eq!(
            parse_release_version("iii/v1.2.3").unwrap(),
            Version::new(1, 2, 3)
        );
        assert_eq!(
            parse_release_version("motia/v0.5.0").unwrap(),
            Version::new(0, 5, 0)
        );
        assert_eq!(
            parse_release_version("iii/v0.11.0-next.7").unwrap(),
            Version::parse("0.11.0-next.7").unwrap()
        );
    }

    #[test]
    fn test_find_asset() {
        let release = Release {
            tag_name: "v0.2.4".to_string(),
            prerelease: false,
            assets: vec![
                ReleaseAsset {
                    name: "iii-console-aarch64-apple-darwin.tar.gz".to_string(),
                    browser_download_url: "https://example.com/a".to_string(),
                    size: 1000,
                },
                ReleaseAsset {
                    name: "iii-console-x86_64-apple-darwin.tar.gz".to_string(),
                    browser_download_url: "https://example.com/b".to_string(),
                    size: 2000,
                },
            ],
        };

        let found = find_asset(&release, "iii-console-aarch64-apple-darwin.tar.gz");
        assert!(found.is_some());
        assert_eq!(found.unwrap().browser_download_url, "https://example.com/a");

        let not_found = find_asset(&release, "nonexistent.tar.gz");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_github_token_not_set() {
        // In test environment, token is typically not set
        // This just exercises the function
        let _ = github_token();
    }

    #[test]
    fn test_tag_matches_prefix() {
        assert!(tag_matches_prefix("iii/v0.10.0", "iii"));
        assert!(tag_matches_prefix("iii/v1.0.0", "iii"));
        assert!(!tag_matches_prefix("v0.10.0", "iii"));
        assert!(!tag_matches_prefix("console/v1.0.0", "iii"));
        assert!(!tag_matches_prefix("iii/0.10.0", "iii")); // missing 'v'
        assert!(!tag_matches_prefix("", "iii"));
    }

    #[test]
    fn test_latest_release_tag_validation_accepts_matching_prefix() {
        let release = Release {
            tag_name: "iii/v0.10.0".to_string(),
            prerelease: false,
            assets: vec![],
        };
        assert!(tag_matches_prefix(&release.tag_name, "iii"));
    }

    #[test]
    fn test_latest_release_tag_validation_rejects_wrong_prefix() {
        let release = Release {
            tag_name: "sdk/v1.0.0".to_string(),
            prerelease: false,
            assets: vec![],
        };
        assert!(!tag_matches_prefix(&release.tag_name, "iii"));
    }

    #[test]
    fn test_stable_version_does_not_allow_prereleases() {
        assert!(!version_allows_prereleases("0.10.0"));
    }

    #[test]
    fn test_prerelease_version_allows_prereleases() {
        assert!(version_allows_prereleases("0.11.0-next.6"));
        assert!(version_allows_prereleases("0.11.0-next.7"));
    }

    #[test]
    fn test_select_release_by_prefix_skips_prereleases_for_stable_builds() {
        let selected = select_release_by_prefix(
            vec![
                release("iii/v0.11.0-next.7", true),
                release("iii/v0.10.0", false),
            ],
            "iii",
            false,
        )
        .expect("should select latest stable release");

        assert_eq!(selected.tag_name, "iii/v0.10.0");
    }

    #[test]
    fn test_select_release_by_prefix_allows_prereleases_for_prerelease_builds() {
        let selected = select_release_by_prefix(
            vec![
                release("iii/v0.11.0-next.6", true),
                release("iii/v0.10.0", false),
                release("iii/v0.11.0-next.7", true),
            ],
            "iii",
            true,
        )
        .expect("should select latest matching release");

        assert_eq!(selected.tag_name, "iii/v0.11.0-next.7");
    }

    #[test]
    fn test_select_release_by_prefix_rejects_wrong_prefix() {
        let selected = select_release_by_prefix(
            vec![
                release("sdk/v0.12.0", false),
                release("iii/v0.11.0-next.7", true),
            ],
            "iii",
            false,
        );

        assert!(selected.is_none());
    }

    fn release(tag_name: &str, prerelease: bool) -> Release {
        Release {
            tag_name: tag_name.to_string(),
            prerelease,
            assets: vec![],
        }
    }
}
