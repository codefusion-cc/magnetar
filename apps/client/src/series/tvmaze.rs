//! Show details from TVmaze (free, no key): the poster, whether the show is still running, and every
//! episode with its air time. Looked up by the task's name when it is created or renamed, then
//! refreshed twice a day. Only the device talks to TVmaze; browsers get the poster from the device.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

use crate::config::read_body;
use crate::protocol::encoding::{encode_uri_component, iso, parse_iso};
use crate::protocol::{AiringDto, ShowInfoDto};

pub const API: &str = "https://api.tvmaze.com";
/// A show's whole episode list comes in one answer; a long-running one is a few megabytes.
const TIMEOUT: Duration = Duration::from_secs(30);
/// Ten times the longest show TVmaze has; an answer larger than this is not a show.
const MAX_SHOW_BYTES: u64 = 32 * 1024 * 1024;
/// A medium poster is ~30–60 KB; anything much bigger isn't one.
const MAX_POSTER_BYTES: u64 = 1024 * 1024;
/// Episode titles are a few words; a longer one is cut here.
pub const MAX_NAME_CHARS: usize = 120;

#[derive(Deserialize)]
struct Show {
    id: i64,
    name: String,
    url: Option<String>,
    status: Option<String>,
    premiered: Option<String>,
    network: Option<Named>,
    #[serde(rename = "webChannel")]
    web_channel: Option<Named>,
    image: Option<Image>,
    #[serde(rename = "_embedded")]
    embedded: Option<Embedded>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Image {
    medium: Option<String>,
}

#[derive(Deserialize, Default)]
struct Embedded {
    nextepisode: Option<Episode>,
    previousepisode: Option<Episode>,
    /// Always there when asked for; `[]` for a show with none yet.
    episodes: Option<Vec<Lenient<ListedEpisode>>>,
}

/// One entry of a list that may hold entries of another shape; those are skipped, not fatal.
#[derive(Deserialize)]
#[serde(untagged)]
enum Lenient<T> {
    Read(T),
    Unreadable(IgnoredAny),
}

#[derive(Deserialize)]
struct ListedEpisode {
    season: Option<i64>,
    number: Option<i64>,
    name: Option<String>,
    airstamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

/// A numbered episode of the show, kept with the task (`series_tasks.show_episodes`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ShowEpisode {
    pub season: i64,
    pub number: i64,
    pub name: Option<String>,
    /// UTC, as `encoding::iso` writes it.
    pub airstamp: Option<String>,
}

impl ListedEpisode {
    /// None for a special (TVmaze gives it no number) and for an entry without a place in the show.
    fn numbered(self) -> Option<ShowEpisode> {
        if self.kind.as_deref().is_some_and(|kind| kind.contains("special")) {
            return None;
        }
        let (season, number) = (self.season.filter(|s| *s >= 0)?, self.number.filter(|n| *n >= 1)?);
        // Control characters say nothing a name needs, and cost six bytes each in JSON.
        let name = self
            .name
            .map(|n| {
                n.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(MAX_NAME_CHARS).collect::<String>()
            })
            .filter(|n| !n.is_empty());
        // Any offset TVmaze gives is applied, so every air time compares as UTC.
        let airstamp = self.airstamp.as_deref().and_then(parse_iso).map(iso);
        Some(ShowEpisode { season, number, name, airstamp })
    }
}

/// What TVmaze knows of a show.
pub struct Found {
    pub info: ShowInfoDto,
    pub poster: Option<String>,
    /// Numbered episodes in order, specials left out.
    pub episodes: Vec<ShowEpisode>,
}

#[derive(Deserialize)]
struct Episode {
    season: Option<i64>,
    number: Option<i64>,
    name: Option<String>,
    airstamp: Option<String>,
}

impl From<Episode> for AiringDto {
    fn from(e: Episode) -> Self {
        AiringDto { season: e.season, number: e.number, name: e.name, airstamp: e.airstamp }
    }
}

/// The show TVmaze thinks `name` is, with its latest and next episode, every episode, and its
/// poster's URL. `api` is TVmaze's address (`API`, or a test's). None when TVmaze knows no such show;
/// an error when it can't be asked or answers with something that isn't a show.
pub async fn lookup(http: &reqwest::Client, api: &str, name: &str) -> anyhow::Result<Option<Found>> {
    let url = format!(
        "{api}/singlesearch/shows?q={}&embed[]=nextepisode&embed[]=previousepisode&embed[]=episodes",
        encode_uri_component(name.trim())
    );
    let response = http.get(url).timeout(TIMEOUT).send().await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    anyhow::ensure!(response.status().is_success(), "TVmaze answered HTTP {}", response.status().as_u16());
    let body = read_body(response, MAX_SHOW_BYTES).await?;
    parse(serde_json::from_slice(&body)?).map(Some)
}

/// What TVmaze said, or an error when it isn't a show with its episode list: an answer without the list,
/// or with entries none of which can be read, would otherwise stand for a show without episodes.
fn parse(show: Show) -> anyhow::Result<Found> {
    let embedded = show.embedded.unwrap_or_default();
    let poster = show.image.and_then(|i| i.medium).filter(|u| u.starts_with("https://"));
    let listed = embedded.episodes.ok_or_else(|| anyhow::anyhow!("TVmaze sent the show without its episodes"))?;
    let total = listed.len();
    let read: Vec<ListedEpisode> = listed
        .into_iter()
        .filter_map(|e| match e {
            Lenient::Read(e) => Some(e),
            Lenient::Unreadable(_) => None,
        })
        .collect();
    anyhow::ensure!(total == 0 || !read.is_empty(), "TVmaze sent episodes of a shape it never used");
    let mut episodes: Vec<ShowEpisode> = read.into_iter().filter_map(ListedEpisode::numbered).collect();
    episodes.sort_by_key(|e| (e.season, e.number));
    // One place listed twice keeps its first entry.
    episodes.dedup_by_key(|e| (e.season, e.number));
    let info = ShowInfoDto {
        tvmaze_id: show.id,
        name: show.name,
        url: show.url,
        status: show.status,
        premiered: show.premiered,
        network: show.network.or(show.web_channel).map(|n| n.name),
        has_poster: false,
        next_episode: embedded.nextepisode.map(Into::into),
        previous_episode: embedded.previousepisode.map(Into::into),
    };
    Ok(Found { info, poster, episodes })
}

pub fn poster_path(posters: &Path, tvmaze_id: i64) -> PathBuf {
    posters.join(format!("{tvmaze_id}.jpg"))
}

/// Saves the poster once; later refreshes keep the file.
pub async fn save_poster(http: &reqwest::Client, url: &str, target: &Path) -> anyhow::Result<()> {
    if target.exists() {
        return Ok(());
    }
    let parsed = url::Url::parse(url)?;
    anyhow::ensure!(
        parsed.host_str().is_some_and(|h| h == "static.tvmaze.com" || h.ends_with(".tvmaze.com")),
        "not a TVmaze image"
    );
    let bytes = read_body(http.get(url).timeout(TIMEOUT).send().await?.error_for_status()?, MAX_POSTER_BYTES).await?;
    anyhow::ensure!(bytes.starts_with(&[0xFF, 0xD8]), "not a JPEG poster");
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target, &bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_show_with_its_episodes_and_poster() {
        let json = r#"{"id":44778,"name":"Mushoku Tensei: Jobless Reincarnation","url":"https://www.tvmaze.com/shows/44778/x",
            "status":"Running","premiered":"2021-01-11","network":null,"webChannel":{"name":"Crunchyroll"},
            "image":{"medium":"https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg","original":"x"},
            "_embedded":{"nextepisode":{"season":3,"number":15,"name":"N","airstamp":"2026-10-02T15:00:00+00:00"},
                         "previousepisode":{"season":3,"number":14,"name":"P","airstamp":"2026-09-25T15:00:00+00:00"},
                         "episodes":[]}}"#;
        let Found { info, poster, .. } = parse(serde_json::from_str(json).unwrap()).unwrap();
        assert_eq!(
            (info.tvmaze_id, info.network.as_deref(), info.status.as_deref()),
            (44778, Some("Crunchyroll"), Some("Running"))
        );
        assert_eq!(info.next_episode.as_ref().map(|e| (e.season, e.number)), Some((Some(3), Some(15))));
        assert_eq!(info.previous_episode.as_ref().and_then(|e| e.airstamp.as_deref()), Some("2026-09-25T15:00:00+00:00"));
        assert_eq!(poster.as_deref(), Some("https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg"));
    }

    #[test]
    fn an_ended_show_without_extras_still_reads() {
        let Found { info, poster, episodes } = parse(
            serde_json::from_str(
                r#"{"id":1,"name":"Old","status":"Ended","image":{"medium":"http://insecure/x.jpg"},"_embedded":{"episodes":[]}}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert!(info.next_episode.is_none() && info.network.is_none() && episodes.is_empty());
        assert_eq!(poster, None, "only https posters");
    }

    #[test]
    fn a_show_without_its_episode_list_is_no_answer() {
        for json in [
            r#"{"id":1,"name":"S"}"#,
            r#"{"id":1,"name":"S","_embedded":{"nextepisode":null}}"#,
            r#"{"id":1,"name":"S","_embedded":{"episodes":null}}"#,
            r#"{"id":1,"name":"S","_embedded":{"episodes":["x",{"season":"one"}]}}"#,
        ] {
            assert!(parse(serde_json::from_str(json).unwrap()).is_err(), "{json}");
        }
        // Specials only: read, and none of them numbered.
        let specials =
            r#"{"id":1,"name":"S","_embedded":{"episodes":[{"season":1,"number":null,"type":"significant_special"}]}}"#;
        assert!(parse(serde_json::from_str(specials).unwrap()).unwrap().episodes.is_empty());
    }

    fn episodes(list: &str) -> Vec<ShowEpisode> {
        parse(serde_json::from_str(&format!(r#"{{"id":1,"name":"S","_embedded":{{"episodes":{list}}}}}"#)).unwrap())
            .unwrap()
            .episodes
    }

    fn place(e: &ShowEpisode) -> (i64, i64) {
        (e.season, e.number)
    }

    #[test]
    fn episodes_are_numbered_ones_in_order_with_their_air_time_in_utc() {
        let list = episodes(
            r#"[
            {"season":1,"number":2,"name":" Two ","airstamp":"2026-10-09T20:00:00+05:00","type":"regular"},
            {"season":1,"number":1,"name":"One","airstamp":"2026-10-02T15:00:00+00:00","type":"regular"},
            {"season":1,"number":null,"name":"Behind the scenes","airstamp":"2026-10-05T15:00:00+00:00","type":"significant_special"},
            {"season":1,"number":3,"name":"Three","type":"insignificant_special"},
            {"season":1,"number":3,"name":"","airstamp":null},
            {"season":1,"number":4,"name":"Four","airstamp":"next Friday"},
            {"season":1,"number":0,"name":"Zero"}
        ]"#,
        );
        assert_eq!(list.iter().map(place).collect::<Vec<_>>(), [(1, 1), (1, 2), (1, 3), (1, 4)]);
        assert_eq!(list[0].airstamp.as_deref(), Some("2026-10-02T15:00:00.000Z"));
        assert_eq!(list[1].airstamp.as_deref(), Some("2026-10-09T15:00:00.000Z"), "the provider's offset is applied");
        assert_eq!(list[1].name.as_deref(), Some("Two"));
        assert_eq!((list[2].name.as_deref(), list[2].airstamp.as_deref()), (None, None), "no name, no date yet");
        assert_eq!(list[3].airstamp, None, "a date that isn't one is no date");
    }

    #[test]
    fn an_entry_of_another_shape_is_skipped_and_the_rest_still_read() {
        let list = episodes(
            r#"[
            "not an episode", 7, null,
            {"season":"one","number":1},
            {"season":1,"number":2.5},
            {"season":1,"number":1,"name":{"en":"x"}},
            {"season":1,"number":1,"name":"First"},
            {"season":1,"number":1,"name":"Again"},
            {"season":-1,"number":5}
        ]"#,
        );
        assert_eq!(list.iter().map(|e| (place(e), e.name.as_deref())).collect::<Vec<_>>(), [((1, 1), Some("First"))]);
    }

    #[test]
    fn a_very_long_name_is_cut() {
        let list = episodes(&format!(r#"[{{"season":1,"number":1,"name":"{}"}}]"#, "é".repeat(5000)));
        assert_eq!(list[0].name.as_ref().map(|n| n.chars().count()), Some(MAX_NAME_CHARS));
        let list =
            episodes(r#"[{"season":1,"number":1,"name":"\u0000\u0007 Pilot\u001b\n"},{"season":1,"number":2,"name":"\u0001"}]"#);
        assert_eq!((list[0].name.as_deref(), list[1].name.as_deref()), (Some("Pilot"), None), "control characters dropped");
    }
}
