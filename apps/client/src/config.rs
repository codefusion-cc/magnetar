use std::sync::LazyLock;

/// Stamped by package.ts from the release tag; dev builds report the crate version with `+dev`
/// build metadata, which compares equal to it (a dev build is never "outdated" by its own release).
pub const VERSION: &str = match option_env!("MAGNETAR_VERSION") {
    Some(version) => version,
    None => concat!(env!("CARGO_PKG_VERSION"), "+dev"),
};

/// The commit the build came from (short), stamped by package.ts; `dev` for `cargo run`.
pub const COMMIT: &str = match option_env!("MAGNETAR_COMMIT") {
    Some(commit) => commit,
    None => "dev",
};

/// How the build introduces itself: `1.2.0 (abc1234)`.
pub fn build_label() -> String {
    format!("{VERSION} ({COMMIT})")
}

/// Ed25519 public key (base64url) whose private half signs release manifests in CI.
pub const RELEASE_PUBLIC_KEY: &str = env!("MAGNETAR_RELEASE_PUBLIC_KEY");

pub const PLATFORM: &str = if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(windows) {
    "windows"
} else {
    "linux"
};

pub const ARCH: &str = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };

pub const DEFAULT_PORT: u16 = 47820;

pub const DEFAULT_CLOUD_URL: &str = "https://magnetar.codefusion.cc";

pub static IS_DEV: LazyLock<bool> =
    LazyLock::new(|| option_env!("MAGNETAR_VERSION").is_none() || std::env::var("MAGNETAR_DEV").as_deref() == Ok("1"));

/// Where the dashboard and relay live: production, or the Worker `MAGNETAR_CLOUD_URL` names (see `cloud_url`).
pub static CLOUD_URL: LazyLock<String> =
    LazyLock::new(|| cloud_url(option_env!("MAGNETAR_VERSION").is_some(), std::env::var("MAGNETAR_CLOUD_URL").ok().as_deref()));

/// The Worker a build talks to. A dev build (`cargo run`) takes any `configured` one: staging, a branch Preview, or
/// `wrangler dev`. A released build takes only a Worker on this computer (end-to-end runs of a packaged app), so a
/// released app never reaches staging or a Preview, whose data is for testing and whose code nobody released.
pub fn cloud_url(released: bool, configured: Option<&str>) -> String {
    let Some(url) = configured.map(|url| url.trim().trim_end_matches('/')).filter(|url| !url.is_empty()) else {
        return DEFAULT_CLOUD_URL.to_owned();
    };
    if released && !is_loopback(url) {
        eprintln!("MAGNETAR_CLOUD_URL is ignored: a released build talks to {DEFAULT_CLOUD_URL} or a Worker on this computer");
        return DEFAULT_CLOUD_URL.to_owned();
    }
    url.to_owned()
}

/// An http(s) address on this computer, with nothing else in it.
fn is_loopback(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|parsed| {
        matches!(parsed.scheme(), "http" | "https")
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.host_str().is_some_and(crate::http::agent_auth::is_loopback_hostname)
    })
}

/// Where releases come from. Clients built before the move to codefusion-cc ask for XeonFX/Magnetar, which GitHub
/// redirects here as long as no repository takes that name again.
pub static GITHUB_REPO: LazyLock<String> =
    LazyLock::new(|| std::env::var("MAGNETAR_GITHUB_REPO").unwrap_or_else(|_| "codefusion-cc/magnetar".to_owned()));

pub static USER_AGENT: LazyLock<String> = LazyLock::new(|| format!("Magnetar/{VERSION}"));

/// The client every outgoing HTTP request uses, introducing itself as the app.
pub fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder().user_agent(USER_AGENT.as_str()).build()
}

/// A response's body, refusing more than `max` bytes, whatever its length header claims.
pub async fn read_body(mut response: reqwest::Response, max: u64) -> anyhow::Result<Vec<u8>> {
    let url = response.url().clone();
    anyhow::ensure!(response.content_length().is_none_or(|length| length <= max), "{url} is too large");
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        body.extend_from_slice(&chunk);
        anyhow::ensure!(body.len() as u64 <= max, "{url} is too large");
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dev_build_talks_to_the_worker_it_is_given() {
        for (configured, expected) in [
            (None, DEFAULT_CLOUD_URL),
            (Some(""), DEFAULT_CLOUD_URL),
            (Some("  "), DEFAULT_CLOUD_URL),
            (Some("https://preview.magnetar.codefusion.cc/"), "https://preview.magnetar.codefusion.cc"),
            (Some("https://feat-x.preview.magnetar.codefusion.cc"), "https://feat-x.preview.magnetar.codefusion.cc"),
            (Some(" http://localhost:8790// "), "http://localhost:8790"),
        ] {
            assert_eq!(cloud_url(false, configured), expected, "{configured:?}");
        }
    }

    #[test]
    fn a_released_build_never_reaches_staging_or_a_preview() {
        for configured in [
            "https://preview.magnetar.codefusion.cc",
            "https://feat-x.preview.magnetar.codefusion.cc",
            "https://example.com",
            "http://localhost.example.com:8790",
            "http://localhost@preview.magnetar.codefusion.cc",
            "http://127.0.0.1@preview.magnetar.codefusion.cc",
            "http://user:pass@localhost:8790",
            "http://10.0.0.1:8790",
            "http://0.0.0.0:8790",
            "ws://localhost:8790",
            "file:///etc/passwd",
            "localhost:8790",
            "not a url",
        ] {
            assert_eq!(cloud_url(true, Some(configured)), DEFAULT_CLOUD_URL, "{configured}");
        }
        assert_eq!(cloud_url(true, None), DEFAULT_CLOUD_URL);
    }

    #[test]
    fn a_released_build_takes_a_worker_on_this_computer() {
        for configured in
            ["http://localhost:8790", "http://127.0.0.1:9", "http://127.8.0.1:8790/", "http://[::1]:8790", "https://localhost"]
        {
            assert_eq!(cloud_url(true, Some(configured)), configured.trim_end_matches('/'), "{configured}");
        }
    }
}
