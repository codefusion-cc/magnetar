//! A series rule's episodes on a real app, with a scripted TVmaze and torrent source: air dates and
//! where each episode stands, TVmaze failing in each way it can, long shows, and when the dashboard
//! is told.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use magnetar::app::{App, AppOptions};
use magnetar::downloads::manager::EngineSource;
use magnetar::paths::Paths;
use magnetar::protocol::{EpisodeState, SeriesEpisodesDto, SeriesTaskDto, SeriesTaskInput, SeriesTaskPatch};
use magnetar::search::types::{Provider, TorrentSearchResult};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

/// TVmaze on a free port: answers every show search with `answer`, and counts the searches.
#[derive(Clone, Default)]
struct Tvmaze(Arc<Mutex<(StatusCode, String, usize)>>);

impl Tvmaze {
    async fn start() -> (Self, String) {
        let tvmaze = Self(Arc::new(Mutex::new((StatusCode::NOT_FOUND, String::new(), 0))));
        let router = Router::new().route("/singlesearch/shows", get(Self::search)).with_state(tvmaze.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        (tvmaze, address)
    }

    async fn search(State(tvmaze): State<Self>) -> (StatusCode, [(&'static str, &'static str); 1], String) {
        let mut state = tvmaze.0.lock().unwrap();
        state.2 += 1;
        // Too many calls: TVmaze says when to come back (here, at once).
        (state.0, [("retry-after", "0")], state.1.clone())
    }

    fn answer(&self, status: StatusCode, body: impl Into<String>) {
        let mut state = self.0.lock().unwrap();
        (state.0, state.1) = (status, body.into());
    }

    fn asked(&self) -> usize {
        self.0.lock().unwrap().2
    }

    /// Waits for the look-up a new or renamed rule starts by itself.
    async fn asked_at_least(&self, times: usize) {
        for _ in 0..500 {
            if self.asked() >= times {
                // Its answer is saved right after.
                tokio::time::sleep(Duration::from_millis(50)).await;
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("TVmaze was asked {} times, not {times}", self.asked());
    }
}

/// A show with `episodes` (season, number or null, airstamp or null), as TVmaze sends it.
fn show(episodes: &[(i64, Option<i64>, Option<&str>)]) -> String {
    let episodes: Vec<Value> = episodes
        .iter()
        .map(|(season, number, airstamp)| {
            let kind = if number.is_some() { "regular" } else { "significant_special" };
            let name = number.map_or("Special".to_owned(), |n| format!("Episode {n}"));
            json!({ "season": season, "number": number, "name": name, "airstamp": airstamp, "type": kind, "summary": "<p>…</p>" })
        })
        .collect();
    json!({ "id": 7, "name": "Show", "status": "Running", "_embedded": { "episodes": episodes } }).to_string()
}

/// Releases with these titles.
struct Releases(Mutex<Vec<String>>);

#[async_trait]
impl Provider for Releases {
    fn name(&self) -> &'static str {
        "Scripted"
    }

    fn id(&self) -> &'static str {
        "scripted"
    }

    async fn search(&self, _: &reqwest::Client, _: &str, _: &CancellationToken) -> anyhow::Result<Vec<TorrentSearchResult>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|title| {
                let hash = format!("{:040x}", title.bytes().fold(7u128, |h, b| h.wrapping_mul(131).wrapping_add(b as u128)));
                TorrentSearchResult {
                    info_hash: hash[..40].to_owned(),
                    magnet_uri: format!("magnet:?xt=urn:btih:{}", &hash[..40]),
                    seeders: 10,
                    ..TorrentSearchResult::new(title.clone(), "Scripted")
                }
            })
            .collect())
    }
}

fn app_in(dir: &std::path::Path, releases: &[&str], tvmaze: &str) -> Arc<App> {
    let app = App::new(AppOptions {
        paths: Paths::new(dir.join("data")).unwrap(),
        engine: EngineSource::Off,
        providers: vec![Arc::new(Releases(Mutex::new(releases.iter().map(|r| r.to_string()).collect())))],
        legacy_database: None,
        show_lookups: true,
    })
    .unwrap();
    app.monitor.tvmaze_api.set(tvmaze.to_owned()).unwrap();
    app.settings.update(|s| s.download_folder = dir.join("dl").display().to_string()).unwrap();
    app
}

fn rule(season: Option<i64>) -> SeriesTaskInput {
    serde_json::from_value(json!({ "name": "Show", "query": "Show", "season": season })).unwrap()
}

fn states(episodes: &SeriesEpisodesDto) -> Vec<(i64, EpisodeState)> {
    episodes.episodes.iter().map(|e| (e.number, e.state)).collect()
}

fn names(episodes: &SeriesEpisodesDto) -> Vec<Option<&str>> {
    episodes.episodes.iter().map(|e| e.name.as_deref()).collect()
}

fn listed(app: &App) -> SeriesTaskDto {
    app.actions.list_series().remove(0)
}

#[tokio::test]
async fn the_season_comes_with_its_air_dates_and_where_each_episode_stands() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(
        StatusCode::OK,
        show(&[
            (1, Some(2), Some("2026-10-09T20:00:00+05:00")),
            (1, Some(1), Some("2026-10-02T15:00:00+00:00")),
            (1, None, Some("2026-10-05T15:00:00+00:00")),
            (1, Some(3), None),
            (2, Some(1), None),
        ]),
    );
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &["Show.S01E01E02.1080p.WEB"], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let checked = app.actions.check_series_now(task.id).await.unwrap();

    let download = app.downloads.list()[0].id;
    assert_eq!(checked.next_episode, 3, "the double episode is both episodes");
    let episodes = &checked.episodes;
    assert_eq!(
        states(episodes),
        [
            (1, EpisodeState::Downloading { download_id: download }),
            (2, EpisodeState::Downloading { download_id: download }),
            (3, EpisodeState::Expected)
        ]
    );
    assert_eq!(names(episodes), [Some("Episode 1"), Some("Episode 2"), Some("Episode 3")], "no special, no other season");
    let airstamps: Vec<Option<&str>> = episodes.episodes.iter().map(|e| e.airstamp.as_deref()).collect();
    assert_eq!(airstamps, [Some("2026-10-02T15:00:00.000Z"), Some("2026-10-09T15:00:00.000Z"), None], "UTC, offset applied");
    assert_eq!((episodes.total, episodes.offset), (3, 0));
    assert!(episodes.air_dates_checked_at.is_some());
    // The same from the page, and the same through REST and MCP's action.
    assert_eq!(&app.actions.series_episodes(task.id, None, None).unwrap(), episodes);
}

#[tokio::test]
async fn when_tvmaze_fails_what_it_said_before_stays_and_it_is_asked_again_later() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), Some("2026-10-02T15:00:00Z")), (1, Some(2), None)]));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let before = listed(&app);
    assert_eq!(names(&before.episodes), [Some("Episode 1"), Some("Episode 2")]);

    for (status, body) in [
        (StatusCode::INTERNAL_SERVER_ERROR, "down".to_owned()),
        (StatusCode::OK, r#"{"id":7,"name":"Show","_embedded":{"episodes":[{"season":1"#.to_owned()),
        (StatusCode::OK, "<html>maintenance</html>".to_owned()),
        (StatusCode::OK, r#"{"name":"Show"}"#.to_owned()),
        // A show, but without the episodes asked for, or with none of them readable.
        (StatusCode::OK, r#"{"id":7,"name":"Show"}"#.to_owned()),
        (StatusCode::OK, r#"{"id":7,"name":"Show","_embedded":{"nextepisode":null}}"#.to_owned()),
        (StatusCode::OK, r#"{"id":7,"name":"Show","_embedded":{"episodes":["one",2,{"season":"x"}]}}"#.to_owned()),
        // A show, but larger than any: refused before it is read.
        (StatusCode::OK, format!(r#"{{"id":7,"name":"Show","padding":"{}"}}"#, "x".repeat(32 * 1024 * 1024))),
    ] {
        tvmaze.answer(status, body);
        assert!(app.monitor.refresh_show(task.id).await.is_err(), "{status}");
        let after = listed(&app);
        assert_eq!(after.episodes, before.episodes, "dates and their age stay ({status})");
        assert_eq!(after.show, before.show);
    }

    // Due again (the twelve hours passed), but TVmaze failed just now: it rests.
    app.db.lock().execute("UPDATE series_tasks SET show_checked_at = NULL", []).unwrap();
    let asked = tvmaze.asked();
    app.monitor.check_all().await;
    assert_eq!(tvmaze.asked(), asked, "not asked again straight after failing");
    // Once it answers, a look-up takes the new list.
    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), Some("2026-10-02T15:00:00Z"))]));
    app.monitor.refresh_show(task.id).await.unwrap();
    assert_eq!(names(&listed(&app).episodes), [Some("Episode 1")], "episode 2 is no longer listed");

    // Thirteen hours on, the round asks again, and the next episode has its date.
    let asked = tvmaze.asked();
    let earlier = magnetar::protocol::encoding::iso(chrono::Utc::now() - chrono::Duration::hours(13));
    app.db.lock().execute("UPDATE series_tasks SET show_checked_at = ?", [&earlier]).unwrap();
    tvmaze
        .answer(StatusCode::OK, show(&[(1, Some(1), Some("2026-10-02T15:00:00Z")), (1, Some(2), Some("2026-10-09T15:00:00Z"))]));
    app.monitor.check_all().await;
    assert_eq!(tvmaze.asked(), asked + 1);
    let fresh = listed(&app).episodes;
    assert_eq!(names(&fresh), [Some("Episode 1"), Some("Episode 2")]);
    assert!(fresh.air_dates_checked_at.as_deref() > Some(earlier.as_str()), "says the dates are new");
}

#[tokio::test]
async fn a_rule_made_while_tvmaze_is_down_has_its_episodes_without_dates() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::SERVICE_UNAVAILABLE, "");
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(None)).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let task = app.actions.get_series(task.id).unwrap();
    assert_eq!(states(&task.episodes), [(1, EpisodeState::Expected)]);
    assert_eq!((task.show, task.episodes.air_dates_checked_at, task.episodes.episodes[0].airstamp.clone()), (None, None, None));
}

#[tokio::test]
async fn a_show_tvmaze_does_not_know_is_checked_and_has_no_dates() {
    let (tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let task = app.actions.get_series(task.id).unwrap();
    assert!(task.show.is_none());
    assert!(task.episodes.air_dates_checked_at.is_some(), "TVmaze answered: it knows no such show");
    assert_eq!(names(&task.episodes), [None]);
}

#[tokio::test]
async fn a_renamed_rule_forgets_the_old_shows_dates() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), Some("2026-10-02T15:00:00Z"))]));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    tvmaze.answer(StatusCode::INTERNAL_SERVER_ERROR, "");
    let patch: SeriesTaskPatch = serde_json::from_value(json!({ "name": "Another show" })).unwrap();
    let renamed = app.actions.update_series(task.id, patch).unwrap();
    assert_eq!((renamed.show.is_none(), names(&renamed.episodes)), (true, vec![None]));
    tvmaze.asked_at_least(2).await;
    assert_eq!(names(&listed(&app).episodes), [None], "the failed look-up of the new name brings nothing back");
}

#[tokio::test]
async fn a_long_show_is_sent_in_part_and_the_rest_is_paged() {
    let (tvmaze, api) = Tvmaze::start().await;
    let long: Vec<(i64, Option<i64>, Option<&str>)> = (1..=600).map(|n| (n / 100 + 1, Some(n % 100 + 1), None)).collect();
    tvmaze.answer(StatusCode::OK, show(&long));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(None)).await.unwrap();
    tvmaze.asked_at_least(1).await;
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = 550", []).unwrap();
    app.series.changed();

    let window = listed(&app).episodes;
    assert_eq!((window.total, window.offset, window.episodes.len()), (600, 500, 100));
    assert_eq!((window.episodes[0].number, window.episodes[99].number), (501, 600));
    assert_eq!(window.episodes[50].state, EpisodeState::Expected, "551, the next one");
    let page = app.actions.series_episodes(task.id, None, Some(200)).unwrap();
    assert_eq!((page.episodes.len(), page.episodes[0].number, page.episodes[199].number), (200, 1, 200));
    assert_eq!(app.actions.series_episodes(task.id, Some(590), Some(50)).unwrap().episodes.len(), 10);
    assert!(app.actions.series_episodes(task.id, Some(650), Some(50)).unwrap().episodes.is_empty());
    for limit in [0, 201] {
        assert!(app.actions.series_episodes(task.id, None, Some(limit)).is_err(), "{limit}");
    }
    assert!(app.actions.series_episodes(task.id + 1, None, None).is_err(), "no such rule");
}

/// The `series.changed` messages sent so far.
fn sent(events: &mut tokio::sync::broadcast::Receiver<Arc<magnetar::events::Event>>) -> Vec<Value> {
    std::iter::from_fn(|| events.try_recv().ok()).filter(|e| e.name == "series.changed").map(|e| e.data.clone()).collect()
}

#[tokio::test]
async fn series_changed_is_sent_when_something_changed_and_only_then() {
    let (tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &["Show S01E01 1080p"], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    app.actions.check_series_now(task.id).await.unwrap();
    let mut events = app.events.subscribe();
    app.series.changed();
    app.series.changed();
    assert!(sent(&mut events).is_empty(), "nothing changed");

    // A download deleted from the Downloads page: the episode is now missed, and the page is told.
    app.start();
    let download = app.downloads.list()[0].id;
    app.downloads.delete(download, false).await.unwrap();
    let mut told = Vec::new();
    for _ in 0..200 {
        told.extend(sent(&mut events));
        if !told.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let told = told.pop().expect("series.changed after the delete");
    assert_eq!(
        told[0]["episodes"]["episodes"],
        json!([
            { "number": 1, "name": null, "airstamp": null, "state": "missed" },
            { "number": 2, "name": null, "airstamp": null, "state": "expected" }
        ])
    );
    // A dashboard that connects now asks for the list, and gets the same.
    assert_eq!(serde_json::to_value(app.actions.list_series()).unwrap(), told);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn of_two_changes_at_once_the_last_message_is_the_latest_state() {
    let (tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let mut ids = Vec::new();
    for n in 0..4 {
        ids.push(app.actions.create_series(SeriesTaskInput { name: format!("Show {n}"), ..rule(Some(1)) }).await.unwrap().id);
    }
    tvmaze.asked_at_least(ids.len()).await;
    for round in 0..25 {
        let mut events = app.events.subscribe();
        let writers: Vec<_> = ids
            .iter()
            .map(|&id| {
                let app = app.clone();
                std::thread::spawn(move || {
                    let mut task = app.series.get(id).unwrap();
                    task.last_downloaded_episode = round * 10 + id;
                    app.series.save(&task).unwrap();
                })
            })
            .collect();
        writers.into_iter().for_each(|w| w.join().unwrap());
        let last = sent(&mut events).pop().expect("told");
        assert!(last == serde_json::to_value(app.actions.list_series()).unwrap(), "round {round}: an older list was sent last");
    }
}

#[tokio::test]
async fn an_episode_whose_file_is_removed_from_disk_is_missed() {
    let (tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let added = app.downloads.add_torrent_file(common::torrent_of_size(2_000, "Show.S01E01.mkv"), "File", None).unwrap();
    let size = app.downloads.files(added.id).unwrap()[0].size;
    app.db
        .lock()
        .execute(
            "UPDATE downloads SET series_task_id = ?, episode = 1, status = 'Completed', progress = 100, total_bytes = ?",
            rusqlite::params![task.id, size as i64],
        )
        .unwrap();
    // Paused, so no check of the rule says anything: only the round's look at the disk can.
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = 1, enabled = 0", []).unwrap();
    let file = dir.path().join("dl").join("Show.S01E01.mkv");
    std::fs::write(&file, vec![0u8; size as usize]).unwrap();
    drop(app);
    let app = app_in(dir.path(), &[], &api);
    app.start();
    assert_eq!(listed(&app).episodes.episodes[0].state, EpisodeState::Have { download_id: added.id });

    let mut events = app.events.subscribe();
    std::fs::remove_file(&file).unwrap();
    app.monitor.check_all().await;
    assert_eq!(listed(&app).episodes.episodes[0].state, EpisodeState::Missed);
    assert_eq!(sent(&mut events).pop().expect("told")[0]["episodes"]["episodes"][0]["state"], "missed");

    // A file of the wrong length (cut short, or another file by that name) is not the episode either.
    std::fs::write(&file, vec![0u8; size as usize - 1]).unwrap();
    app.series.changed();
    assert_eq!(listed(&app).episodes.episodes[0].state, EpisodeState::Missed);
}

fn airstamps(episodes: &SeriesEpisodesDto) -> Vec<Option<&str>> {
    episodes.episodes.iter().map(|e| e.airstamp.as_deref()).collect()
}

#[tokio::test]
async fn a_download_of_one_season_is_not_an_episode_of_another() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), None), (2, Some(1), None)]));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &["Show.S01E01.1080p.WEB"], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let checked = app.actions.check_series_now(task.id).await.unwrap();
    let download = app.downloads.list()[0].id;
    assert_eq!(states(&checked.episodes)[0], (1, EpisodeState::Downloading { download_id: download }));

    // The rule moves on to season 2, from its first episode: season 1's download is not season 2's.
    let patch: SeriesTaskPatch = serde_json::from_value(json!({ "season": 2 })).unwrap();
    app.actions.update_series(task.id, patch).unwrap();
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = 0", []).unwrap();
    assert_eq!(states(&app.actions.get_series(task.id).unwrap().episodes), [(1, EpisodeState::Expected)]);
}

#[tokio::test]
async fn without_a_season_a_download_that_names_its_season_has_that_episodes_air_time() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(
        StatusCode::OK,
        show(&[(1, Some(1), Some("2026-01-01T15:00:00Z")), (1, Some(2), None), (2, Some(1), Some("2026-06-01T15:00:00Z"))]),
    );
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &["Show.S02E01.1080p.WEB"], &api);
    let task = app.actions.create_series(rule(None)).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let checked = app.actions.check_series_now(task.id).await.unwrap();
    let download = app.downloads.list()[0].id;
    assert_eq!(states(&checked.episodes)[0], (1, EpisodeState::Downloading { download_id: download }));
    assert_eq!(airstamps(&checked.episodes)[0], Some("2026-06-01T15:00:00.000Z"), "season 2's first, not season 1's");
}

#[tokio::test]
async fn a_double_episode_downloaded_before_episodes_were_counted_holds_both() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), None), (1, Some(2), None), (1, Some(3), None)]));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    // As a library from before stored it: the first episode only, no span, no season.
    app.db
        .lock()
        .execute(
            "INSERT INTO downloads (name, magnet_uri, info_hash, save_path, source, status, added_at, series_task_id, episode)
             VALUES ('Show.S01E01E02.1080p.WEB', 'magnet:?xt=urn:btih:aa', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '/nowhere',
               'Nyaa', 'Paused', '2026-10-02T16:00:00.000Z', ?, 1)",
            [task.id],
        )
        .unwrap();
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = 2, enabled = 0", []).unwrap();
    drop(app);
    let app = app_in(dir.path(), &[], &api);
    app.start();
    let id = app.downloads.list()[0].id;
    assert_eq!(
        states(&listed(&app).episodes),
        [
            (1, EpisodeState::Downloading { download_id: id }),
            (2, EpisodeState::Downloading { download_id: id }),
            (3, EpisodeState::Expected)
        ]
    );
}

#[tokio::test]
async fn a_dead_download_of_a_season_the_rule_left_is_not_replaced_by_the_new_seasons_episode() {
    let (_tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &["Show.S01E01.1080p.WEB", "Show.S02E01.1080p.WEB"], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    app.actions.check_series_now(task.id).await.unwrap();
    let old = app.downloads.list()[0].id;
    app.db.lock().execute("UPDATE downloads SET status = 'Error', error = 'No peers found — dead'", []).unwrap();
    drop(app);
    let app = app_in(dir.path(), &["Show.S01E01.1080p.WEB", "Show.S02E01.1080p.WEB"], &api);
    app.start();
    let patch: SeriesTaskPatch = serde_json::from_value(json!({ "season": 2 })).unwrap();
    app.actions.update_series(task.id, patch).unwrap();
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = 0", []).unwrap();
    app.actions.check_series_now(task.id).await.unwrap();
    let mut names: Vec<(i64, String)> = app.downloads.list().into_iter().map(|d| (d.id, d.name)).collect();
    names.sort();
    assert_eq!(names[0], (old, "Show.S01E01.1080p.WEB".to_owned()), "season 1's failed download stays for the user to see");
    assert_eq!(names[1].1, "Show.S02E01.1080p.WEB");
}

/// A finished download the rule made of `torrent`, its episodes `first` to `last` of season 1, and the
/// app opened again with the rule at `last` and paused, so only the disk says what is there.
async fn finished_download(dir: &std::path::Path, api: &str, torrent: Vec<u8>, first: i64, last: i64) -> (Arc<App>, i64) {
    let app = app_in(dir, &[], api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    let added = app.downloads.add_torrent_file(torrent, "File", None).unwrap();
    app.db
        .lock()
        .execute(
            "UPDATE downloads SET series_task_id = ?, episode = ?, last_episode = ?, season = 1, status = 'Completed', progress = 100",
            rusqlite::params![task.id, first, (last > first).then_some(last)],
        )
        .unwrap();
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = ?, enabled = 0", [last]).unwrap();
    drop(app);
    let app = app_in(dir, &[], api);
    app.start();
    (app, added.id)
}

#[tokio::test]
async fn each_episode_of_a_pack_is_had_only_while_its_own_file_is_there() {
    let (_tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let files = [("Show.S01E01.mkv", 1_000), ("Show.S01E02.mkv", 3_000), ("Show.S01E03.mkv", 2_000), ("Show.S01.nfo", 10)];
    let torrent = common::torrent_of_files("Show.S01E01-E03.1080p", &files);
    let folder = dir.path().join("dl").join("Show.S01E01-E03.1080p");
    std::fs::create_dir_all(&folder).unwrap();
    for (name, length) in files {
        std::fs::write(folder.join(name), vec![0u8; length]).unwrap();
    }
    let (app, id) = finished_download(dir.path(), &api, torrent, 1, 3).await;
    let have = EpisodeState::Have { download_id: id };
    assert_eq!(states(&listed(&app).episodes), [(1, have), (2, have), (3, have), (4, EpisodeState::Expected)]);

    // The smaller episode's file deleted, another cut short: only the largest is still had.
    std::fs::remove_file(folder.join("Show.S01E01.mkv")).unwrap();
    std::fs::write(folder.join("Show.S01E03.mkv"), vec![0u8; 1_999]).unwrap();
    app.series.changed();
    assert_eq!(states(&listed(&app).episodes)[..3], [(1, EpisodeState::Missed), (2, have), (3, EpisodeState::Missed)]);

    // Episode 1 back, but episode 2 no longer chosen: it is not kept, so not had.
    std::fs::write(folder.join("Show.S01E01.mkv"), vec![0u8; 1_000]).unwrap();
    std::fs::write(folder.join("Show.S01E03.mkv"), vec![0u8; 2_000]).unwrap();
    app.downloads.select_files(id, vec![0, 2, 3]).await.unwrap();
    assert_eq!(states(&listed(&app).episodes)[..3], [(1, have), (2, EpisodeState::Missed), (3, have)]);
}

#[tokio::test]
async fn an_episode_whose_torrent_details_are_gone_is_had_only_while_its_file_is_there() {
    let (_tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let torrent = common::torrent_of_size(2_000, "Show.S01E01.mkv");
    let (app, id) = finished_download(dir.path(), &api, torrent, 1, 1).await;
    let size = app.downloads.files(id).unwrap()[0].size;
    let file = dir.path().join("dl").join("Show.S01E01.mkv");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, vec![0u8; size as usize]).unwrap();
    // The cached .torrent is lost; the download's name and length still say which file it is.
    let cached = std::fs::read_dir(dir.path().join("data").join("torrents")).unwrap().next().unwrap().unwrap().path();
    std::fs::remove_file(&cached).unwrap();
    app.db.lock().execute("UPDATE downloads SET total_bytes = ?", [size as i64]).unwrap();
    drop(app);
    let app = app_in(dir.path(), &[], &api);
    app.start();
    assert_eq!(states(&listed(&app).episodes)[0], (1, EpisodeState::Have { download_id: id }));
    std::fs::remove_file(&file).unwrap();
    app.series.changed();
    assert_eq!(states(&listed(&app).episodes)[0], (1, EpisodeState::Missed));

    // A corrupt .torrent proves nothing either, and the name still decides.
    std::fs::write(&cached, b"d4:info").unwrap();
    std::fs::write(&file, vec![0u8; size as usize]).unwrap();
    assert_eq!(states(&listed(&app).episodes)[0], (1, EpisodeState::Have { download_id: id }));
    std::fs::write(&file, vec![0u8; size as usize + 1]).unwrap();
    assert_eq!(states(&listed(&app).episodes)[0], (1, EpisodeState::Missed));
}

#[tokio::test]
async fn an_answer_about_a_name_the_rule_no_longer_has_is_never_kept() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::INTERNAL_SERVER_ERROR, "");
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let patch: SeriesTaskPatch = serde_json::from_value(json!({ "name": "Another show" })).unwrap();
    app.actions.update_series(task.id, patch).unwrap();
    tvmaze.asked_at_least(2).await;
    // A look-up of the old name ends now, after its poster came, and writes what it found.
    let old = magnetar::protocol::ShowInfoDto {
        tvmaze_id: 7,
        name: "Show".into(),
        url: None,
        status: None,
        premiered: None,
        network: None,
        has_poster: false,
        next_episode: None,
        previous_episode: None,
    };
    let episodes = [magnetar::series::tvmaze::ShowEpisode { season: 1, number: 1, name: Some("Old".into()), airstamp: None }];
    assert!(!app.series.save_show(task.id, Some("Show"), Some(&old), &episodes, Some("2026-10-12T00:00:00.000Z")).unwrap());
    let now = app.actions.get_series(task.id).unwrap();
    assert_eq!((now.show, names(&now.episodes)), (None, vec![None]));
    // The rule's own name is kept.
    assert!(app.series.save_show(task.id, Some("Another show"), Some(&old), &episodes, None).unwrap());
    assert_eq!(names(&app.actions.get_series(task.id).unwrap().episodes), [Some("Old")]);
}

/// `rules` rules straight into the library, each with a long name, query and folder and a show of
/// `episodes` episodes whose names are as long as TVmaze's may be, in the widest characters JSON has.
fn many_rules(app: &App, rules: usize, episodes: i64) {
    let name: String = "\u{1F3AC}".repeat(magnetar::series::tvmaze::MAX_NAME_CHARS);
    let show: Vec<Value> = (1..=episodes)
        .map(|n| json!({ "season": 1, "number": n, "name": name, "airstamp": "2026-10-02T15:00:00.000Z" }))
        .collect();
    let show = Value::Array(show).to_string();
    let mut db = app.db.lock();
    let tx = db.transaction().unwrap();
    for n in 0..rules {
        tx.execute(
            "INSERT INTO series_tasks (name, query, title_filter, season, download_folder, last_downloaded_episode, created_at,
               prefer_words, exclude_words, show_episodes, show_checked_at)
             VALUES (?1, ?2, 'SubsPlease 1080p', 1, ?3, 50, '2026-10-01T00:00:00.000Z', 'SubsPlease', 'HEVC x265', ?4,
               '2026-10-12T00:00:00.000Z')",
            rusqlite::params![
                format!("A show with a long name {n:04} {}", "ż".repeat(60)),
                format!("A show {n:04}"),
                format!("/Volumes/Media/Shows/{}", "x".repeat(150)),
                show
            ],
        )
        .unwrap();
    }
    tx.commit().unwrap();
}

/// Bytes of `series.changed` as the dashboard is sent it.
fn message_bytes(list: &[SeriesTaskDto]) -> usize {
    serde_json::to_vec(&json!({ "event": "series.changed", "data": list })).unwrap().len()
}

#[tokio::test]
async fn the_list_of_every_rule_always_fits_one_relay_message() {
    let (_tvmaze, api) = Tvmaze::start().await;
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    many_rules(&app, 1_000, 100);
    let list = app.actions.list_series();
    assert_eq!(list.len(), 1_000);
    assert!(message_bytes(&list) <= magnetar::protocol::relay::MAX_RELAY_FRAME, "{} bytes", message_bytes(&list));
    assert!(list.iter().all(|t| t.episodes.total == 100), "each still says how many there are");

    // A few rules get their whole window.
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    many_rules(&app, 5, 300);
    let list = app.actions.list_series();
    assert!(list.iter().all(|t| t.episodes.episodes.len() == magnetar::series::episodes::WINDOW));
}

#[tokio::test]
async fn a_change_to_an_episode_outside_the_window_still_tells_the_dashboard() {
    let (tvmaze, api) = Tvmaze::start().await;
    let long: Vec<(i64, Option<i64>, Option<&str>)> = (1..=600).map(|n| (1, Some(n), None)).collect();
    tvmaze.answer(StatusCode::OK, show(&long));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    app.db.lock().execute("UPDATE series_tasks SET last_downloaded_episode = 550, enabled = 0", []).unwrap();
    app.series.changed();
    let before = listed(&app).episodes;
    assert_eq!(before.episodes[0].number, 501);

    // TVmaze renames episode 1, on a page fetched earlier: what that page says is out of date.
    let mut events = app.events.subscribe();
    let found = app.series.get(task.id).unwrap();
    let mut list = found.show_episodes.clone();
    list[0].name = Some("Pilot".into());
    app.series.save_show(task.id, None, found.show.as_ref(), &list, found.show_checked_at.as_deref()).unwrap();
    let mut told = sent(&mut events);
    assert_eq!(told.len(), 1, "series.changed for a change outside the window, once");
    let told = told.remove(0);
    let after = &listed(&app).episodes;
    assert_eq!(after.episodes, before.episodes, "the window itself is the same");
    assert_ne!(told[0]["episodes"]["version"], serde_json::to_value(&before).unwrap()["version"]);
    app.series.changed();
    assert!(sent(&mut events).is_empty(), "and only once");
}

#[tokio::test]
async fn pages_follow_on_by_number_whatever_changed_between_them() {
    let (tvmaze, api) = Tvmaze::start().await;
    let first: Vec<(i64, Option<i64>, Option<&str>)> = (1..=400).map(|n| (1, Some(n), None)).collect();
    tvmaze.answer(StatusCode::OK, show(&first));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let task = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    let one = app.actions.series_episodes(task.id, None, Some(200)).unwrap();
    assert_eq!((one.episodes[0].number, one.episodes[199].number, one.offset, one.total), (1, 200, 0, 400));

    // TVmaze drops episode 50 and lists 401 before the next page is asked for.
    let second: Vec<_> = (1..=401).filter(|n| *n != 50).map(|n| (1, Some(n), None)).collect();
    tvmaze.answer(StatusCode::OK, show(&second));
    app.monitor.refresh_show(task.id).await.unwrap();
    let two = app.actions.series_episodes(task.id, Some(200), Some(200)).unwrap();
    assert_eq!((two.episodes[0].number, two.episodes.last().unwrap().number), (201, 400), "none skipped, none twice");
    assert_ne!(two.version, one.version, "the first page is out of date, and says so");
    let three = app.actions.series_episodes(task.id, Some(400), Some(200)).unwrap();
    assert_eq!(three.episodes.iter().map(|e| e.number).collect::<Vec<_>>(), [401]);
    assert!(app.actions.series_episodes(task.id, Some(401), Some(200)).unwrap().episodes.is_empty());
    assert_eq!(app.actions.series_episodes(task.id, Some(-5), Some(1)).unwrap().episodes[0].number, 1);
}

#[tokio::test]
async fn shows_due_all_at_once_are_looked_up_a_few_a_round_and_too_many_calls_stop_the_round() {
    let (tvmaze, api) = Tvmaze::start().await;
    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), None)]));
    let dir = tempfile::tempdir().unwrap();
    let app = app_in(dir.path(), &[], &api);
    let first = app.actions.create_series(rule(Some(1))).await.unwrap();
    tvmaze.asked_at_least(1).await;
    {
        let mut db = app.db.lock();
        let tx = db.transaction().unwrap();
        for n in 0..39 {
            tx.execute(
                "INSERT INTO series_tasks (name, query, season, created_at) VALUES (?1, ?1, 1, '2026-10-01T00:00:00.000Z')",
                [format!("Show {n}")],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    // As after migration 8: every show due, the one checked longest ago first.
    app.db.lock().execute("UPDATE series_tasks SET show_checked_at = NULL WHERE id <> ?", [first.id]).unwrap();
    app.db
        .lock()
        .execute("UPDATE series_tasks SET show_checked_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [first.id])
        .unwrap();

    // TVmaze has had enough: the round stops asking, and holds it against no show.
    tvmaze.answer(StatusCode::TOO_MANY_REQUESTS, "");
    let asked = tvmaze.asked();
    app.monitor.check_all().await;
    assert_eq!(tvmaze.asked(), asked + 1);

    tvmaze.answer(StatusCode::OK, show(&[(1, Some(1), None)]));
    let checked = |app: &App| app.series.all().iter().filter(|t| t.show_checked_at.is_some()).count();
    app.monitor.check_all().await;
    assert_eq!(tvmaze.asked(), asked + 1 + magnetar::series::monitor::SHOW_LOOKUPS_PER_ROUND, "a few a round");
    assert_eq!(checked(&app), 1 + magnetar::series::monitor::SHOW_LOOKUPS_PER_ROUND);
    for _ in 0..3 {
        app.monitor.check_all().await;
    }
    assert_eq!(checked(&app), 40, "every show in a few rounds");
}
