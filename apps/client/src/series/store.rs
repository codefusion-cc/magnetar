use std::sync::{Arc, Mutex};

use rusqlite::{OptionalExtension, Row, params};
use tokio::sync::broadcast::error::{RecvError, TryRecvError};
use tokio_util::sync::CancellationToken;

use super::episode::EpisodeRule;
use super::episodes::{self, EpisodeDownload, EpisodeList, LIST_BYTES, PAGE_MAX, WINDOW};
use super::quality::QualityRule;
use super::tvmaze::ShowEpisode;
use crate::db::Db;
use crate::downloads::DownloadManager;
use crate::error::{ApiError, ApiResult};
use crate::events::EventBus;
use crate::protocol::encoding::now_iso;
use crate::protocol::{
    MAX_CHECK_INTERVAL_MINUTES, SeriesEpisodeDto, SeriesEpisodesDto, SeriesTaskDto, SeriesTaskInput, ShowInfoDto, StartFrom,
};

#[derive(Clone, Debug)]
pub struct SeriesTask {
    pub id: i64,
    pub name: String,
    pub query: String,
    pub provider: Option<String>,
    pub title_filter: Option<String>,
    pub season: Option<i64>,
    pub start_episode: i64,
    pub end_episode: Option<i64>,
    pub download_folder: Option<String>,
    pub last_downloaded_episode: i64,
    pub check_interval_minutes: i64,
    pub enabled: bool,
    pub last_checked_at: Option<String>,
    pub resolution: Option<String>,
    pub min_seeders: i64,
    pub max_size_mb: Option<i64>,
    pub prefer_words: Option<String>,
    pub exclude_words: Option<String>,
    pub show: Option<ShowInfoDto>,
    /// When TVmaze last answered for the show (or said it knows none).
    pub show_checked_at: Option<String>,
    /// The show's numbered episodes as TVmaze last listed them, in order.
    pub show_episodes: Vec<ShowEpisode>,
}

impl SeriesTask {
    pub(crate) fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            query: row.get("query")?,
            provider: row.get("provider")?,
            title_filter: row.get("title_filter")?,
            season: row.get("season")?,
            start_episode: row.get("start_episode")?,
            end_episode: row.get("end_episode")?,
            download_folder: row.get("download_folder")?,
            last_downloaded_episode: row.get("last_downloaded_episode")?,
            // One stored before there was a limit is read within it.
            check_interval_minutes: row.get::<_, i64>("check_interval_minutes")?.clamp(1, MAX_CHECK_INTERVAL_MINUTES),
            enabled: row.get("enabled")?,
            last_checked_at: row.get("last_checked_at")?,
            resolution: row.get("resolution")?,
            min_seeders: row.get("min_seeders")?,
            max_size_mb: row.get("max_size_mb")?,
            prefer_words: row.get("prefer_words")?,
            exclude_words: row.get("exclude_words")?,
            show: row.get::<_, Option<String>>("show_info")?.and_then(|json| serde_json::from_str(&json).ok()),
            show_checked_at: row.get("show_checked_at")?,
            show_episodes: row
                .get::<_, Option<String>>("show_episodes")?
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default(),
        })
    }

    pub fn next_episode(&self) -> i64 {
        self.start_episode.max(self.last_downloaded_episode + 1)
    }

    pub fn is_finished(&self) -> bool {
        self.end_episode.is_some_and(|end| self.last_downloaded_episode >= end)
    }

    pub fn quality(&self) -> QualityRule {
        QualityRule::new(
            self.resolution.as_deref(),
            self.min_seeders,
            self.max_size_mb,
            self.prefer_words.as_deref(),
            self.exclude_words.as_deref(),
        )
    }

    pub fn rule(&self) -> EpisodeRule<'_> {
        EpisodeRule { query: &self.query, title_filter: self.title_filter.as_deref(), season: self.season }
    }

    /// The rule's editable fields, as a create would take them.
    pub fn as_input(&self) -> SeriesTaskInput {
        SeriesTaskInput {
            name: self.name.clone(),
            query: self.query.clone(),
            provider: self.provider.clone(),
            title_filter: self.title_filter.clone(),
            season: self.season,
            start_episode: self.start_episode,
            end_episode: self.end_episode,
            check_interval_minutes: self.check_interval_minutes,
            enabled: self.enabled,
            download_folder: self.download_folder.clone(),
            resolution: self.resolution.clone(),
            min_seeders: self.min_seeders,
            max_size_mb: self.max_size_mb,
            prefer_words: self.prefer_words.clone(),
            exclude_words: self.exclude_words.clone(),
            start_from: StartFrom::Episode,
        }
    }

    pub fn apply(&mut self, input: SeriesTaskInput) {
        self.name = input.name;
        self.query = input.query;
        self.provider = input.provider;
        self.title_filter = input.title_filter;
        self.season = input.season;
        self.start_episode = input.start_episode;
        self.end_episode = input.end_episode;
        self.check_interval_minutes = input.check_interval_minutes;
        self.enabled = input.enabled;
        self.download_folder = input.download_folder;
        self.resolution = input.resolution;
        self.min_seeders = input.min_seeders;
        self.max_size_mb = input.max_size_mb;
        self.prefer_words = input.prefer_words;
        self.exclude_words = input.exclude_words;
    }

    /// Every episode of the rule, given the downloads it made.
    pub fn episodes(&self, downloads: &[EpisodeDownload]) -> Vec<SeriesEpisodeDto> {
        episodes::episodes(self, &self.show_episodes, downloads)
    }

    fn episode_list(&self, downloads: &[EpisodeDownload]) -> EpisodeList {
        EpisodeList::new(self.episodes(downloads), self.show_checked_at.clone())
    }

    fn to_dto(&self, episodes: SeriesEpisodesDto) -> SeriesTaskDto {
        SeriesTaskDto {
            id: self.id,
            name: self.name.clone(),
            query: self.query.clone(),
            provider: self.provider.clone(),
            title_filter: self.title_filter.clone(),
            season: self.season,
            start_episode: self.start_episode,
            end_episode: self.end_episode,
            last_downloaded_episode: self.last_downloaded_episode,
            next_episode: self.next_episode(),
            check_interval_minutes: self.check_interval_minutes,
            enabled: self.enabled,
            download_folder: self.download_folder.clone(),
            last_checked_at: self.last_checked_at.clone(),
            finished: self.is_finished(),
            resolution: self.resolution.clone(),
            min_seeders: self.min_seeders,
            max_size_mb: self.max_size_mb,
            prefer_words: self.prefer_words.clone(),
            exclude_words: self.exclude_words.clone(),
            show: self.show.clone(),
            episodes,
        }
    }
}

pub struct SeriesStore {
    db: Db,
    events: EventBus,
    downloads: Arc<DownloadManager>,
    /// What `series.changed` last said; held while the next is worked out, so two changes at once
    /// are sent in the order they were seen and an unchanged list isn't sent again.
    sent: Mutex<Option<serde_json::Value>>,
}

impl SeriesStore {
    pub fn new(db: Db, events: EventBus, downloads: Arc<DownloadManager>) -> Self {
        Self { db, events, downloads, sent: Mutex::default() }
    }

    pub fn all(&self) -> Vec<SeriesTask> {
        let db = self.db.lock();
        let mut statement = db.prepare("SELECT * FROM series_tasks ORDER BY id").expect("series_tasks table");
        statement.query_map([], SeriesTask::from_row).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn get(&self, id: i64) -> ApiResult<SeriesTask> {
        self.db
            .lock()
            .query_row("SELECT * FROM series_tasks WHERE id = ?", [id], SeriesTask::from_row)
            .optional()?
            .ok_or_else(|| ApiError::not_found(format!("No series task with id {id}.")))
    }

    pub fn create(&self, input: &SeriesTaskInput) -> ApiResult<SeriesTask> {
        let task = self.db.lock().query_row(
            "INSERT INTO series_tasks (name, query, provider, title_filter, season, start_episode, end_episode, download_folder,
               check_interval_minutes, enabled, created_at, resolution, min_seeders, max_size_mb, prefer_words, exclude_words)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
            params![
                input.name,
                input.query,
                input.provider,
                input.title_filter,
                input.season,
                input.start_episode,
                input.end_episode,
                input.download_folder,
                input.check_interval_minutes,
                input.enabled,
                now_iso(),
                input.resolution,
                input.min_seeders,
                input.max_size_mb,
                input.prefer_words,
                input.exclude_words
            ],
            SeriesTask::from_row,
        )?;
        self.changed();
        Ok(task)
    }

    /// Saves the rule and where it stands; what TVmaze said of the show is `save_show`'s.
    pub fn save(&self, task: &SeriesTask) -> ApiResult<()> {
        self.db.lock().execute(
            "UPDATE series_tasks SET name = ?, query = ?, provider = ?, title_filter = ?, season = ?, start_episode = ?,
               end_episode = ?, download_folder = ?, last_downloaded_episode = ?, check_interval_minutes = ?, enabled = ?,
               last_checked_at = ?, resolution = ?, min_seeders = ?, max_size_mb = ?, prefer_words = ?, exclude_words = ?
             WHERE id = ?",
            params![
                task.name,
                task.query,
                task.provider,
                task.title_filter,
                task.season,
                task.start_episode,
                task.end_episode,
                task.download_folder,
                task.last_downloaded_episode,
                task.check_interval_minutes,
                task.enabled,
                task.last_checked_at,
                task.resolution,
                task.min_seeders,
                task.max_size_mb,
                task.prefer_words,
                task.exclude_words,
                task.id
            ],
        )?;
        self.changed();
        Ok(())
    }

    /// What TVmaze said of the rule's show, all at once: a failed look-up never leaves half of it. With
    /// `named`, only while the rule still has that name, in the same write: an answer about a name the
    /// rule no longer has is never kept. Whether it was saved.
    pub fn save_show(
        &self,
        id: i64,
        named: Option<&str>,
        show: Option<&ShowInfoDto>,
        episodes: &[ShowEpisode],
        checked_at: Option<&str>,
    ) -> ApiResult<bool> {
        let json = |value: serde_json::Result<String>| value.map_err(|e| ApiError::internal(e.to_string()));
        let show = show.map(|show| json(serde_json::to_string(show))).transpose()?;
        let episodes = if episodes.is_empty() { None } else { Some(json(serde_json::to_string(episodes))?) };
        let saved = self.db.lock().execute(
            "UPDATE series_tasks SET show_info = ?, show_episodes = ?, show_checked_at = ? WHERE id = ? AND (?5 IS NULL OR name = ?5)",
            params![show, episodes, checked_at, id, named],
        )? > 0;
        if saved {
            self.changed();
        }
        Ok(saved)
    }

    /// Its downloads are kept and become manual downloads (the foreign key sets them to null).
    pub fn delete(&self, id: i64) -> ApiResult<()> {
        self.get(id)?;
        self.db.lock().execute("DELETE FROM series_tasks WHERE id = ?", [id])?;
        self.changed();
        Ok(())
    }

    /// A release that failed for this task (nobody seeded it); it is never picked again.
    pub fn reject(&self, id: i64, info_hash: &str) {
        let _ = self
            .db
            .lock()
            .execute("INSERT OR IGNORE INTO series_rejects (task_id, info_hash) VALUES (?, ?)", params![id, info_hash]);
    }

    pub fn rejected(&self, id: i64) -> std::collections::HashSet<String> {
        let db = self.db.lock();
        let Ok(mut statement) = db.prepare("SELECT info_hash FROM series_rejects WHERE task_id = ?") else {
            return Default::default();
        };
        statement
            .query_map([id], |r| r.get::<_, String>(0))
            .map(|rows| rows.filter_map(Result::ok).map(|h| h.to_lowercase()).collect())
            .unwrap_or_default()
    }

    /// The rule with its episodes around where it stands.
    pub fn dto(&self, task: &SeriesTask) -> SeriesTaskDto {
        task.to_dto(task.episode_list(&self.made_by(task.id)).window(WINDOW))
    }

    /// Every rule, each with as many of its episodes as all of them together leave room for in one
    /// message (`LIST_BYTES`).
    pub fn dtos(&self) -> Vec<SeriesTaskDto> {
        let tasks = self.all();
        let mut downloads = self.downloads.series_downloads(None);
        let lists: Vec<EpisodeList> =
            tasks.iter().map(|task| task.episode_list(&downloads.remove(&task.id).unwrap_or_default())).collect();
        let bare =
            |task: &SeriesTask, list: &EpisodeList| serde_json::to_vec(&task.to_dto(list.window(0))).map_or(0, |json| json.len());
        let sized: Vec<(usize, &EpisodeList)> = tasks.iter().zip(&lists).map(|(task, list)| (bare(task, list), list)).collect();
        let size = episodes::fit(&sized, LIST_BYTES);
        if size == 0 && !tasks.is_empty() {
            tracing::warn!("The series rules alone are more than one message holds: they are sent without episodes");
        }
        tasks.iter().zip(&lists).map(|(task, list)| task.to_dto(list.window(size))).collect()
    }

    /// Up to `limit` (1 to `PAGE_MAX`) of the rule's episodes, numbered after `after` (from the first when None).
    pub fn episodes(&self, id: i64, after: Option<i64>, limit: usize) -> ApiResult<SeriesEpisodesDto> {
        if !(1..=PAGE_MAX).contains(&limit) {
            return Err(ApiError::bad(format!("limit must be 1 to {PAGE_MAX}.")));
        }
        let task = self.get(id)?;
        Ok(task.episode_list(&self.made_by(id)).page(after, limit))
    }

    /// The downloads the rule made.
    fn made_by(&self, id: i64) -> Vec<EpisodeDownload> {
        self.downloads.series_downloads(Some(id)).remove(&id).unwrap_or_default()
    }

    /// Until cancelled, tells the dashboard when a download changes what a rule's episodes are: one
    /// starting, finishing, failing or being deleted. A burst of changes is looked at once.
    pub async fn follow_downloads(self: Arc<Self>, cancel: CancellationToken) {
        let mut events = self.events.subscribe();
        loop {
            let event = tokio::select! {
                _ = cancel.cancelled() => return,
                event = events.recv() => event,
            };
            match event {
                Ok(event) if event.name != "downloads.changed" => continue,
                Err(RecvError::Closed) => return,
                // Missed some: one of them may have been a download change.
                Ok(_) | Err(RecvError::Lagged(_)) => {}
            }
            while !matches!(events.try_recv(), Err(TryRecvError::Empty | TryRecvError::Closed)) {}
            let store = self.clone();
            let _ = tokio::task::spawn_blocking(move || store.changed()).await;
        }
    }

    /// Sends `series.changed` if the rules or their episodes differ from what it last said.
    pub fn changed(&self) {
        let mut sent = self.sent.lock().unwrap_or_else(|e| e.into_inner());
        let now = match serde_json::to_value(self.dtos()) {
            Ok(now) => now,
            Err(error) => return tracing::error!("Could not write the series list: {error}"),
        };
        if sent.as_ref() != Some(&now) {
            self.events.emit("series.changed", &now);
            *sent = Some(now);
        }
    }
}
