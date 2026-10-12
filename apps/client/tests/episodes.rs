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

    async fn search(State(tvmaze): State<Self>) -> (StatusCode, String) {
        let mut state = tvmaze.0.lock().unwrap();
        state.2 += 1;
        (state.0, state.1.clone())
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
    assert_eq!(&app.actions.series_episodes(task.id, 0, None).unwrap(), episodes);
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
    let page = app.actions.series_episodes(task.id, 0, Some(200)).unwrap();
    assert_eq!((page.episodes.len(), page.episodes[0].number, page.episodes[199].number), (200, 1, 200));
    assert_eq!(app.actions.series_episodes(task.id, 590, Some(50)).unwrap().episodes.len(), 10);
    assert!(app.actions.series_episodes(task.id, 650, Some(50)).unwrap().episodes.is_empty());
    for limit in [0, 201] {
        assert!(app.actions.series_episodes(task.id, 0, Some(limit)).is_err(), "{limit}");
    }
    assert!(app.actions.series_episodes(task.id + 1, 0, None).is_err(), "no such rule");
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
