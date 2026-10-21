use async_trait::async_trait;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::search::http::{as_trimmed_str, post_json, to_int, to_number};
use crate::search::magnet::{DEFAULT_TRACKERS, build_magnet};
use crate::search::types::{Provider, TorrentSearchResult};

const NAME: &str = "Knaben";
const API: &str = "https://api.knaben.org/v1";
/// As many as the other sources send; the API allows up to 300.
const SIZE: u32 = 100;

/// Knaben's index (knaben.org): its own copy of The Pirate Bay, Nyaa, YTS, RuTracker and other sites, kept fresh and
/// searched in one request. Rows it copied from a site Magnetar also asks merge with that site's by their hash.
pub struct Knaben;

#[async_trait]
impl Provider for Knaben {
    fn name(&self) -> &'static str {
        NAME
    }

    fn id(&self) -> &'static str {
        "knaben"
    }

    async fn search(
        &self,
        http: &reqwest::Client,
        query: &str,
        cancel: &CancellationToken,
    ) -> anyhow::Result<Vec<TorrentSearchResult>> {
        // Every word must be in the title, as on the other sites; `hide_unsafe` leaves out what Knaben marks unsafe.
        // Nothing else is filtered, as on the other sources.
        let body = json!({
            "search_type": "100%",
            "search_field": "title",
            "query": query,
            "order_by": "seeders",
            "order_direction": "desc",
            "size": SIZE,
            "hide_unsafe": true,
        });
        parse(&post_json(http, API, &body, cancel).await?)
    }
}

/// Only the hash is taken from a row, as from every site: Knaben's own magnet and its trackers never get in.
pub fn parse(json: &str) -> anyhow::Result<Vec<TorrentSearchResult>> {
    let root: Value = serde_json::from_str(json)?;
    let rows = root["hits"].as_array().map(Vec::as_slice).unwrap_or_default();
    Ok(rows
        .iter()
        .filter_map(|row| {
            let title = as_trimmed_str(&row["title"]);
            let magnet = build_magnet(as_trimmed_str(&row["hash"]), title, &DEFAULT_TRACKERS)?;
            let details = as_trimmed_str(&row["details"]);
            Some(TorrentSearchResult {
                info_hash: magnet.info_hash,
                magnet_uri: magnet.uri,
                size_bytes: to_number(&row["bytes"]).max(0.0) as u64,
                seeders: to_int(&row["seeders"]),
                leechers: to_int(&row["peers"]),
                published_at: parse_date(as_trimmed_str(&row["date"])),
                details_url: details.starts_with("https://").then(|| details.to_owned()),
                ..TorrentSearchResult::new(title, NAME)
            })
        })
        .collect())
}

/// `2012-06-12T22:00:00+00:00`, or without the offset (`2015-11-08T00:00:00`), which is UTC.
pub fn parse_date(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .map(|date| date.with_timezone(&Utc))
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").map(|date| date.and_utc()))
        .ok()
}
