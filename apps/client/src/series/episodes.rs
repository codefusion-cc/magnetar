//! A rule's episodes and where each stands, from three things the device knows: the show's episodes
//! as TVmaze lists them, the rule (where it starts, ends and has got to), and the rule's downloads.
//! Nothing here depends on the clock: whether an expected episode has aired yet is its air time's to say.

use std::collections::BTreeMap;
use std::ops::Range;

use sha2::{Digest, Sha256};

use super::store::SeriesTask;
use super::tvmaze::ShowEpisode;
use crate::protocol::{DownloadStatus, EpisodeState, SeriesEpisodeDto, SeriesEpisodesDto};

/// Episodes one `series.episodes` page holds at most (`EPISODES_PAGE_MAX` in limits.ts).
pub const PAGE_MAX: usize = 200;
/// Episodes a rule carries in `series.list` and `series.changed`: a season, even a long one.
pub const WINDOW: usize = 100;
/// The most bytes `series.list` and `series.changed` take, rules and episodes together: what the relay
/// forwards in one message (`MAX_RELAY_FRAME`), less room for the message around the list. The rules'
/// windows shrink until it fits; what they leave out is paged.
pub const LIST_BYTES: usize = crate::protocol::relay::MAX_RELAY_FRAME - 4 * 1024;
/// The most episode numbers a rule's own range adds: a rule that has counted far past what TVmaze
/// lists still yields a list of bounded length.
const MAX_RANGE: i64 = 20_000;

/// A download made for the rule, and what it holds.
#[derive(Clone, Debug)]
pub struct EpisodeDownload {
    pub id: i64,
    /// The season its title names, if any.
    pub season: Option<i64>,
    pub first: i64,
    /// The last episode it holds; `first` unless it is a double episode or a pack.
    pub last: i64,
    pub status: DownloadStatus,
    /// For a finished download, the episodes whose own file is no longer whole on disk.
    pub gone: Vec<i64>,
}

/// Every episode of the rule, by number: what TVmaze lists for its season (or the whole show,
/// counted through, when it has no season), every number its downloads of that season hold, and every
/// number the rule has covered up to the episode it waits for. An episode is its season and number: a
/// download of another season is not one of the rule's, and without a season, an episode had or under
/// way through a download that names its season is described as that season's episode.
pub fn episodes(task: &SeriesTask, show: &[ShowEpisode], downloads: &[EpisodeDownload]) -> Vec<SeriesEpisodeDto> {
    let downloads: Vec<&EpisodeDownload> =
        downloads.iter().filter(|d| task.season.is_none() || d.season.is_none_or(|s| Some(s) == task.season)).collect();
    let mut listed: BTreeMap<i64, (Option<String>, Option<String>)> = BTreeMap::new();
    let mut place = |number: i64, episode: &ShowEpisode| {
        listed.entry(number).or_insert_with(|| (episode.name.clone(), episode.airstamp.clone()));
    };
    match task.season {
        Some(season) => show.iter().filter(|e| e.season == season).for_each(|e| place(e.number, e)),
        // `show` is in order; a rule without a season matches any season's number, so counts through.
        None => show.iter().zip(1..).for_each(|(e, number)| place(number, e)),
    }
    let frontier =
        if task.is_finished() { task.end_episode.unwrap_or(task.last_downloaded_episode) } else { task.next_episode() };
    for number in task.start_episode.max(frontier.saturating_sub(MAX_RANGE - 1))..=frontier {
        listed.entry(number).or_default();
    }
    // Of several downloads holding an episode (one replaced a dead release, or brought better
    // quality), the newest of its kind: (finished and on disk, under way).
    let mut held: BTreeMap<i64, (Option<i64>, Option<i64>)> = BTreeMap::new();
    for download in &downloads {
        for number in download.first..=download.last {
            listed.entry(number).or_default();
            let (have, under_way) = held.entry(number).or_default();
            if !download.status.is_finished() {
                *under_way = (*under_way).max(Some(download.id));
            } else if !download.gone.contains(&number) {
                *have = (*have).max(Some(download.id));
            }
        }
    }
    let seasons: std::collections::HashMap<i64, Option<i64>> = downloads.iter().map(|d| (d.id, d.season)).collect();
    listed
        .into_iter()
        .filter(|(number, _)| *number >= 1)
        .map(|(number, (mut name, mut airstamp))| {
            let state = state(task, number, held.get(&number).copied().unwrap_or_default());
            let through = match state {
                EpisodeState::Have { download_id } | EpisodeState::Downloading { download_id } => Some(download_id),
                _ => None,
            };
            if task.season.is_none()
                && let Some(season) = through.and_then(|id| seasons.get(&id).copied().flatten())
            {
                let own = show.iter().find(|e| (e.season, e.number) == (season, number));
                (name, airstamp) = own.map(|e| (e.name.clone(), e.airstamp.clone())).unwrap_or_default();
            }
            SeriesEpisodeDto { number, name, airstamp, state }
        })
        .collect()
}

fn state(task: &SeriesTask, number: i64, (have, under_way): (Option<i64>, Option<i64>)) -> EpisodeState {
    if let Some(download_id) = have {
        return EpisodeState::Have { download_id };
    }
    if let Some(download_id) = under_way {
        return EpisodeState::Downloading { download_id };
    }
    let ahead = number >= task.next_episode() && task.end_episode.is_none_or(|end| number <= end);
    if ahead { EpisodeState::Expected } else { EpisodeState::Missed }
}

/// A rule's every episode, and the version that tells one list of them from another.
pub struct EpisodeList {
    all: Vec<SeriesEpisodeDto>,
    version: String,
    checked_at: Option<String>,
}

impl EpisodeList {
    /// `all` in order of number; `checked_at` is when TVmaze last answered for the show.
    pub fn new(all: Vec<SeriesEpisodeDto>, checked_at: Option<String>) -> Self {
        let mut hash = Sha256::new();
        // Writing JSON into a hash fails only if serializing does, which a list of these never does.
        let _ = serde_json::to_writer(&mut hash, &all);
        let version = hash.finalize()[..8].iter().map(|b| format!("{b:02x}")).collect();
        Self { all, version, checked_at }
    }

    fn slice(&self, range: Range<usize>) -> SeriesEpisodesDto {
        SeriesEpisodesDto {
            total: self.all.len(),
            offset: range.start,
            episodes: self.all[range].to_vec(),
            version: self.version.clone(),
            air_dates_checked_at: self.checked_at.clone(),
        }
    }

    /// Up to `limit` (at most `PAGE_MAX`) episodes numbered after `after`, from the first when None. By
    /// number, not position: episodes listed or dropped meanwhile shift nothing, so paging on from a
    /// page's last number neither skips nor repeats one; `version` says when what came before changed.
    pub fn page(&self, after: Option<i64>, limit: usize) -> SeriesEpisodesDto {
        let start = after.map_or(0, |after| self.all.partition_point(|e| e.number <= after));
        self.slice(start..(start + limit.min(PAGE_MAX)).min(self.all.len()))
    }

    /// Which of the episodes a window of `size` holds: from a few before the first one still to come (or
    /// under way), so the season so far and what comes next are both in it; the last ones when nothing is
    /// to come. A larger window holds every episode a smaller one does.
    fn window_range(&self, size: usize) -> Range<usize> {
        let to_come = self.all.iter().position(|e| matches!(e.state, EpisodeState::Expected | EpisodeState::Downloading { .. }));
        let anchor = to_come.unwrap_or(self.all.len());
        let start = anchor.saturating_sub(size / 4).min(self.all.len().saturating_sub(size));
        start..(start + size).min(self.all.len())
    }

    /// At most `size` episodes around where the rule stands.
    pub fn window(&self, size: usize) -> SeriesEpisodesDto {
        self.slice(self.window_range(size))
    }
}

/// The largest window, up to `WINDOW`, that every rule can carry with all of them in at most `budget`
/// bytes of JSON: `lists` are each rule's episodes with the bytes the rule takes without them. 0 when
/// even the rules alone take more.
pub fn fit(lists: &[(usize, &EpisodeList)], budget: usize) -> usize {
    // What each rule's widest window costs, episode by episode (each with a comma), added up: every
    // narrower window lies inside it, so its cost is a difference of two of these sums.
    let costs: Vec<(Range<usize>, Vec<usize>)> = lists
        .iter()
        .map(|(_, list)| {
            let widest = list.window_range(WINDOW);
            let mut sums = vec![0];
            for episode in &list.all[widest.clone()] {
                sums.push(sums.last().unwrap() + serde_json::to_vec(episode).map_or(usize::MAX / 2, |json| json.len() + 1));
            }
            (widest, sums)
        })
        .collect();
    let rules: usize = lists.iter().map(|(bytes, _)| bytes + 1).sum::<usize>() + 2;
    let bytes = |size: usize| -> usize {
        let episodes = lists.iter().zip(&costs).map(|((_, list), (widest, sums))| {
            let range = list.window_range(size);
            sums[range.end - widest.start] - sums[range.start - widest.start]
        });
        rules.saturating_add(episodes.sum())
    };
    let (mut fits, mut too_large) = (0, WINDOW + 1);
    if bytes(WINDOW) <= budget {
        return WINDOW;
    }
    while too_large - fits > 1 {
        let middle = (fits + too_large) / 2;
        if bytes(middle) <= budget { fits = middle } else { too_large = middle }
    }
    fits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::EpisodeState::{Downloading, Expected, Have, Missed};

    fn task(season: Option<i64>, start: i64, end: Option<i64>, last: i64) -> SeriesTask {
        SeriesTask {
            id: 1,
            name: "Show".into(),
            query: "Show".into(),
            provider: None,
            title_filter: None,
            season,
            start_episode: start,
            end_episode: end,
            download_folder: None,
            last_downloaded_episode: last,
            check_interval_minutes: 60,
            enabled: true,
            last_checked_at: None,
            resolution: None,
            min_seeders: 1,
            max_size_mb: None,
            prefer_words: None,
            exclude_words: None,
            show: None,
            show_checked_at: None,
            show_episodes: Vec::new(),
        }
    }

    fn aired(season: i64, number: i64, airstamp: Option<&str>) -> ShowEpisode {
        ShowEpisode { season, number, name: Some(format!("S{season}E{number}")), airstamp: airstamp.map(Into::into) }
    }

    fn season(season: i64, count: i64) -> Vec<ShowEpisode> {
        (1..=count).map(|n| aired(season, n, Some("2026-10-02T15:00:00.000Z"))).collect()
    }

    fn download(id: i64, first: i64, last: i64, status: DownloadStatus, on_disk: bool) -> EpisodeDownload {
        EpisodeDownload {
            id,
            season: Some(1),
            first,
            last,
            status,
            gone: if on_disk { Vec::new() } else { (first..=last).collect() },
        }
    }

    fn states(list: &[SeriesEpisodeDto]) -> Vec<(i64, EpisodeState)> {
        list.iter().map(|e| (e.number, e.state)).collect()
    }

    #[test]
    fn each_episode_is_had_under_way_expected_or_missed() {
        // Started at 2, has got to 4 of a season of 6; 2 is here, 3 downloads, 4's download was deleted.
        let downloads = [download(10, 2, 2, DownloadStatus::Seeding, true), download(11, 3, 3, DownloadStatus::Paused, false)];
        let list = episodes(&task(Some(1), 2, None, 4), &season(1, 6), &downloads);
        assert_eq!(
            states(&list),
            [
                (1, Missed),
                (2, Have { download_id: 10 }),
                (3, Downloading { download_id: 11 }),
                (4, Missed),
                (5, Expected),
                (6, Expected)
            ]
        );
        assert_eq!(list[4].name.as_deref(), Some("S1E5"));
    }

    #[test]
    fn a_rule_follows_its_own_season_only() {
        let mut show = season(1, 3);
        show.extend(season(2, 2));
        let list = episodes(&task(Some(2), 1, None, 0), &show, &[]);
        assert_eq!(list.iter().map(|e| e.name.as_deref().unwrap()).collect::<Vec<_>>(), ["S2E1", "S2E2"]);
    }

    #[test]
    fn without_a_season_the_show_is_counted_through() {
        let mut show = season(1, 3);
        show.extend(season(2, 2));
        let list = episodes(&task(None, 1, None, 3), &show, &[]);
        assert_eq!(
            list.iter().map(|e| (e.number, e.name.as_deref().unwrap())).collect::<Vec<_>>()[3..],
            [(4, "S2E1"), (5, "S2E2")]
        );
    }

    #[test]
    fn a_season_with_no_dates_yet_still_has_the_episode_the_rule_waits_for() {
        let list = episodes(&task(Some(3), 1, None, 0), &[], &[]);
        assert_eq!(list, [SeriesEpisodeDto { number: 1, name: None, airstamp: None, state: Expected }]);
        // Listed, but with no air time yet.
        let list = episodes(&task(Some(3), 1, None, 0), &[aired(3, 1, None), aired(3, 2, None)], &[]);
        assert_eq!((list.len(), list[1].airstamp.as_ref()), (2, None));
    }

    #[test]
    fn numbers_beyond_what_tvmaze_lists_are_still_the_rules() {
        // TVmaze lists 2 episodes; the rule has 3 and waits for the 4th.
        let downloads = [download(5, 3, 3, DownloadStatus::Completed, true)];
        let list = episodes(&task(Some(1), 1, None, 3), &season(1, 2), &downloads);
        assert_eq!(states(&list)[2..], [(3, Have { download_id: 5 }), (4, Expected)]);
        assert_eq!(list[3].name, None);
    }

    #[test]
    fn a_double_episode_is_both_episodes() {
        let downloads = [download(7, 1, 2, DownloadStatus::Downloading, false)];
        let list = episodes(&task(Some(1), 1, None, 2), &season(1, 3), &downloads);
        assert_eq!(states(&list), [(1, Downloading { download_id: 7 }), (2, Downloading { download_id: 7 }), (3, Expected)]);
    }

    #[test]
    fn a_failed_download_is_still_under_way_until_replaced() {
        let failed = download(3, 1, 1, DownloadStatus::Error, false);
        let list = episodes(&task(Some(1), 1, Some(1), 1), &season(1, 1), std::slice::from_ref(&failed));
        assert_eq!(states(&list), [(1, Downloading { download_id: 3 })]);
        // Its replacement is the newer download; the failed one is deleted when it is queued.
        let list =
            episodes(&task(Some(1), 1, Some(1), 1), &season(1, 1), &[failed, download(4, 1, 1, DownloadStatus::Queued, false)]);
        assert_eq!(states(&list), [(1, Downloading { download_id: 4 })]);
    }

    #[test]
    fn a_file_removed_after_download_is_missed() {
        let downloads = [download(3, 1, 1, DownloadStatus::Completed, false)];
        let list = episodes(&task(Some(1), 1, None, 1), &season(1, 2), &downloads);
        assert_eq!(states(&list), [(1, Missed), (2, Expected)]);
    }

    #[test]
    fn an_episode_downloaded_again_is_had_through_the_newest_copy_on_disk() {
        let first = download(3, 1, 1, DownloadStatus::Completed, true);
        let better = download(9, 1, 1, DownloadStatus::Downloading, false);
        let list = episodes(&task(Some(1), 1, Some(1), 1), &season(1, 1), &[first.clone(), better.clone()]);
        assert_eq!(states(&list), [(1, Have { download_id: 3 })], "watchable while the better one comes");
        let done = download(9, 1, 1, DownloadStatus::Seeding, true);
        assert_eq!(
            states(&episodes(&task(Some(1), 1, Some(1), 1), &season(1, 1), &[first.clone(), done])),
            [(1, Have { download_id: 9 })]
        );
        let first_gone = download(3, 1, 1, DownloadStatus::Completed, false);
        assert_eq!(
            states(&episodes(&task(Some(1), 1, Some(1), 1), &season(1, 1), &[first_gone, better])),
            [(1, Downloading { download_id: 9 })]
        );
    }

    #[test]
    fn after_the_rules_end_nothing_is_expected() {
        let list = episodes(&task(Some(1), 1, Some(2), 2), &season(1, 4), &[]);
        assert_eq!(states(&list), [(1, Missed), (2, Missed), (3, Missed), (4, Missed)]);
        let list = episodes(&task(Some(1), 1, Some(3), 1), &season(1, 4), &[]);
        assert_eq!(states(&list)[1..], [(2, Expected), (3, Expected), (4, Missed)]);
    }

    #[test]
    fn a_rule_far_along_has_a_bounded_list() {
        let list = episodes(&task(None, 1, None, 1_000_000), &[], &[]);
        assert_eq!(list.len(), MAX_RANGE as usize);
        assert_eq!((list[0].number, list.last().unwrap().number), (1_000_001 - MAX_RANGE + 1, 1_000_001));
        assert!(episodes(&task(None, i64::MAX, None, i64::MAX - 1), &[], &[]).len() == 1);
    }

    fn list(all: Vec<SeriesEpisodeDto>) -> EpisodeList {
        EpisodeList::new(all, None)
    }

    #[test]
    fn pages_and_windows_hold_what_they_say() {
        let all = list(episodes(&task(None, 1, None, 600), &[], &[]));
        assert_eq!(all.all.len(), 601);
        let p = all.page(Some(590), 50);
        assert_eq!((p.total, p.offset, p.episodes.len(), p.episodes[0].number), (601, 590, 11, 591));
        assert!(all.page(Some(601), 50).episodes.is_empty());
        assert_eq!(all.page(None, 10_000).episodes.len(), PAGE_MAX);
        assert_eq!(all.page(Some(i64::MIN), 1).episodes[0].number, 1);
        assert!(all.page(Some(i64::MAX), 1).episodes.is_empty());
        assert!(all.page(None, 0).episodes.is_empty());
        // The window reaches the episode the rule waits for, with the ones before it.
        let w = EpisodeList::new(all.all.clone(), Some("2026-10-12T00:00:00.000Z".into())).window(WINDOW);
        assert_eq!((w.offset, w.episodes.len(), w.episodes.last().unwrap().number), (501, WINDOW, 601));
        assert_eq!(w.air_dates_checked_at.as_deref(), Some("2026-10-12T00:00:00.000Z"));
        assert!(all.window(0).episodes.is_empty());
        // A short season is sent whole.
        let short = list(episodes(&task(Some(1), 1, None, 0), &season(1, 12), &[]));
        assert_eq!((short.window(WINDOW).offset, short.window(WINDOW).episodes.len()), (0, 12));
        // With much still to come, the window starts a quarter before it.
        let mut long = episodes(&task(None, 1, None, 299), &[], &[]);
        long.extend((301..=700).map(|number| SeriesEpisodeDto { number, name: None, airstamp: None, state: Expected }));
        assert_eq!(list(long).window(WINDOW).offset, 299 - WINDOW / 4);
    }

    #[test]
    fn a_page_numbered_on_from_the_last_neither_skips_nor_repeats_one() {
        let numbered = |numbers: &[i64]| {
            list(numbers.iter().map(|&number| SeriesEpisodeDto { number, name: None, airstamp: None, state: Expected }).collect())
        };
        let before = numbered(&(1..=400).collect::<Vec<_>>());
        let first = before.page(None, 200);
        // Episode 50 dropped and 401 listed before the next page.
        let after = numbered(&(1..=401).filter(|n| *n != 50).collect::<Vec<_>>());
        let next = after.page(first.episodes.last().map(|e| e.number), 200);
        assert_eq!((next.episodes[0].number, next.episodes[199].number), (201, 400));
        assert_ne!(first.version, next.version);
        assert_eq!(numbered(&[1, 2]).version, numbered(&[1, 2]).version, "the same list, the same version");
    }

    #[test]
    fn a_window_holds_every_episode_a_smaller_one_does() {
        for (last, count) in [(0, 0), (0, 1), (3, 12), (299, 700), (650, 601), (10, 40)] {
            let all = list(episodes(&task(None, 1, None, last), &[], &[]).into_iter().take(count).collect());
            for size in 0..WINDOW {
                let (small, large) = (all.window_range(size), all.window_range(size + 1));
                assert!(large.start <= small.start && small.end <= large.end, "{last} {count} {size}");
                assert_eq!(small.len(), size.min(all.all.len()));
            }
        }
    }

    #[test]
    fn many_rules_share_what_one_message_holds() {
        let longest = |number| SeriesEpisodeDto {
            number,
            // Each 4 bytes in JSON, the most any character takes once control characters are gone.
            name: Some("\u{1F3AC}".repeat(crate::series::tvmaze::MAX_NAME_CHARS)),
            airstamp: Some("2026-10-02T15:00:00.000Z".into()),
            state: Downloading { download_id: i64::MAX },
        };
        let show = list((1..=300).map(longest).collect());
        let per_episode = serde_json::to_vec(&show.all[0]).unwrap().len() + 1;
        // Few rules: each its whole window.
        assert_eq!(fit(&[(500, &show); 5], LIST_BYTES), WINDOW);
        // Many: as many as fit, and the list within the budget.
        let rules = vec![(700, &show); 1_000];
        let size = fit(&rules, LIST_BYTES);
        let total = |size: usize| 1_000 * (700 + 1 + size * per_episode) + 2;
        assert!(total(size) <= LIST_BYTES && total(size + 1) > LIST_BYTES, "{size}");
        // Rules that alone take more than a message carry none.
        assert_eq!(fit(&[(LIST_BYTES, &show)], LIST_BYTES), 0);
        assert_eq!(fit(&[], LIST_BYTES), WINDOW);
    }
}
