pub mod cache;
pub mod http;
pub mod magnet;
pub mod mirrors;
pub mod providers;
pub mod relevance;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use futures::future::join_all;
use tokio_util::sync::CancellationToken;

use crate::protocol::SourceOutcomeDto;
use crate::settings::SettingsService;
use http::{FetchError, describe_failure};
use relevance::matches_query;
use types::{Provider, SharedResult, TorrentSearchResult};

/// One row per info hash, keeping the best-seeded, sorted by seeders. Its date is the earliest any source gave: the
/// upload, where an index such as Torrents-CSV dates a torrent by when it took it in. Rows without a hash (lazy
/// sources not resolved yet) pass through: grouping blanks would merge unrelated torrents.
pub fn merge_results(rows: Vec<TorrentSearchResult>) -> Vec<TorrentSearchResult> {
    let mut hashless = Vec::new();
    let mut by_hash: Vec<TorrentSearchResult> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for row in rows {
        if row.info_hash.is_empty() {
            hashless.push(row);
            continue;
        }
        match index.get(&row.info_hash.to_lowercase()) {
            Some(&i) => {
                let earliest = [by_hash[i].published_at, row.published_at].into_iter().flatten().min();
                if row.seeders > by_hash[i].seeders {
                    by_hash[i] = row;
                }
                by_hash[i].published_at = earliest;
            }
            None => {
                index.insert(row.info_hash.to_lowercase(), by_hash.len());
                by_hash.push(row);
            }
        }
    }
    hashless.extend(by_hash);
    hashless.sort_by_key(|r| std::cmp::Reverse(r.seeders));
    hashless
}

/// Aggregates every provider: parallel fan-out, per-source outcomes, lazy detail resolution.
pub struct SearchService {
    pub providers: Vec<Arc<dyn Provider>>,
    settings: Arc<SettingsService>,
    http: reqwest::Client,
}

pub struct Collected {
    pub results: Vec<TorrentSearchResult>,
    pub outcomes: Vec<SourceOutcomeDto>,
}

impl SearchService {
    pub fn new(providers: Vec<Arc<dyn Provider>>, settings: Arc<SettingsService>, http: reqwest::Client) -> Self {
        Self { providers, settings, http }
    }

    pub fn find_provider(&self, name: &str) -> Option<&Arc<dyn Provider>> {
        self.providers.iter().find(|p| p.is_called(name))
    }

    /// A whole search, merged, with every source's outcome.
    pub async fn collect(
        &self,
        query: &str,
        provider: Option<&str>,
        cancel: &CancellationToken,
        filter_relevance: bool,
    ) -> anyhow::Result<Collected> {
        let all = std::sync::Mutex::new(Vec::new());
        let outcomes = self
            .search_stream(query, provider, &|batch| all.lock().unwrap().extend(batch), &|_| {}, cancel, filter_relevance)
            .await?;
        Ok(Collected { results: merge_results(all.into_inner().unwrap()), outcomes })
    }

    /// Searches enabled providers in parallel, handing each provider's rows to `on_results` as soon
    /// as it answers. Every provider reports an outcome, so "this site failed" and "everything was
    /// filtered out" stay distinguishable from "there is nothing to find". Fails only when cancelled.
    pub async fn search_stream(
        &self,
        query: &str,
        provider: Option<&str>,
        on_results: &(dyn Fn(Vec<TorrentSearchResult>) + Sync),
        on_outcome: &(dyn Fn(&SourceOutcomeDto) + Sync),
        cancel: &CancellationToken,
        filter_relevance: bool,
    ) -> anyhow::Result<Vec<SourceOutcomeDto>> {
        let targets = self
            .providers
            .iter()
            .filter(|p| provider.is_none_or(|wanted| p.is_called(wanted)) && self.settings.is_provider_enabled(p.name()));
        let outcomes = join_all(targets.map(|p| async move {
            let outcome = match p.search(&self.http, query, cancel).await {
                Ok(results) => {
                    let returned = results.len();
                    let kept: Vec<_> =
                        results.into_iter().filter(|r| !filter_relevance || matches_query(query, &r.title)).collect();
                    let filtered = returned - kept.len();
                    if !kept.is_empty() {
                        on_results(kept);
                    }
                    SourceOutcomeDto { source: p.name().into(), status: "ok", returned, filtered, error: None }
                }
                // The caller moving on is not a provider fault.
                Err(_) if cancel.is_cancelled() => return None,
                Err(error) => {
                    tracing::warn!("Search on {} failed: {}", p.name(), describe_failure(&error));
                    SourceOutcomeDto {
                        source: p.name().into(),
                        status: "failed",
                        returned: 0,
                        filtered: 0,
                        error: Some(describe_failure(&error)),
                    }
                }
            };
            on_outcome(&outcome);
            Some(outcome)
        }))
        .await;
        if cancel.is_cancelled() {
            return Err(FetchError::Cancelled.into());
        }
        Ok(outcomes.into_iter().flatten().collect())
    }

    /// The result, with its magnet link fetched first for a lazy source (for up to 30 s). The link is
    /// empty when the source didn't give it.
    pub async fn with_magnet(&self, shared: &SharedResult, cancel: &CancellationToken) -> TorrentSearchResult {
        if shared.lock().unwrap().needs_resolution() {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(30), self.ensure_details(shared, cancel)).await;
        }
        shared.lock().unwrap().clone()
    }

    /// Fills in a lazy result's magnet and description; a no-op once there is nothing left to fetch.
    pub async fn ensure_details(&self, shared: &SharedResult, cancel: &CancellationToken) {
        let result = shared.lock().unwrap().clone();
        if !result.needs_resolution() && result.description.is_some() {
            return;
        }
        let Some(provider) = self.find_provider(&result.source) else { return };
        match provider.details(&self.http, &result, cancel).await {
            None => {}
            Some(Ok(details)) => {
                let mut result = shared.lock().unwrap();
                if let Some(hash) = details.info_hash {
                    result.info_hash = hash;
                }
                if let Some(magnet) = details.magnet_uri {
                    result.magnet_uri = magnet;
                }
                if details.description.is_some() {
                    result.description = details.description;
                }
            }
            Some(Err(error)) => {
                tracing::warn!("Could not fetch details from {}: {}", result.source, describe_failure(&error))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_one_row_per_hash_and_hashless_rows_sorted_by_seeders() {
        let row = |title: &str, hash: &str, seeders| TorrentSearchResult {
            info_hash: hash.into(),
            seeders,
            ..TorrentSearchResult::new(title, "X")
        };
        let merged = merge_results(vec![row("a", "AAAA", 5), row("a2", "aaaa", 9), row("lazy", "", 1), row("lazy2", "", 3)]);
        assert_eq!(merged.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["a2", "lazy2", "lazy"]);
    }

    #[test]
    fn a_torrent_found_by_several_sources_keeps_the_earliest_date_any_gave() {
        use chrono::TimeZone;
        let day = |d: u32| Some(chrono::Utc.with_ymd_and_hms(2026, 9, d, 12, 0, 0).unwrap());
        let row = |source: &str, seeders, published_at| TorrentSearchResult {
            info_hash: "EC778232".into(),
            seeders,
            published_at,
            ..TorrentSearchResult::new("Mushoku Tensei S3 - 13", source)
        };
        // Torrents-CSV dates a torrent by when its index took it in, weeks after the upload the others give.
        for rows in [
            vec![row("Nyaa", 1005, day(20)), row("Torrents-CSV", 1665, day(30)), row("Knaben", 1077, None)],
            vec![row("Torrents-CSV", 1665, day(30)), row("Knaben", 1077, None), row("Nyaa", 1005, day(20))],
            vec![row("Knaben", 1077, None), row("Nyaa", 1005, day(20)), row("Torrents-CSV", 1665, day(30))],
        ] {
            let merged = merge_results(rows);
            assert_eq!(merged.len(), 1);
            assert_eq!((merged[0].source.as_str(), merged[0].seeders, merged[0].published_at), ("Torrents-CSV", 1665, day(20)));
        }
        let merged = merge_results(vec![row("Knaben", 9, None), row("Torrents-CSV", 3, None)]);
        assert_eq!((merged[0].source.as_str(), merged[0].published_at), ("Knaben", None));
    }
}
