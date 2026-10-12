use std::sync::LazyLock;

use regex::Regex;

static SXXEYY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[Ss]([0-9]{1,2})[\s._-]*[Ee]([0-9]{1,4})").unwrap());
static NXNN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b)([0-9]{1,2})x([0-9]{2,4})(?-u:\b)").unwrap());
static EPISODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(?:[Ee]p(?:isode)?|[Ee])[\s._]?([0-9]{1,4})(?-u:\b)").unwrap());
static DASH_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[-–]\s*([0-9]+)").unwrap());
/// The second number of a double episode right after "S01E01": "E02", "-E02" or "-02".
static AND_EPISODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:-?[Ee]|-)([0-9]{1,4})").unwrap());
/// The most episodes one release is taken to hold: a whole season, not a numbering slip.
const MAX_SPAN: i64 = 200;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Episode {
    pub season: Option<i64>,
    pub episode: i64,
    /// The last episode the release holds: `episode` itself, or more for "S01E01E02" or "S01E01-E12".
    pub through: i64,
}

/// Extracts (season, episode) from a torrent title. Understands "S01E05", "1x05", "Episode 5",
/// "Ep05", "E05" and anime-style "Show - 05".
pub fn parse_episode(title: &str) -> Option<Episode> {
    if title.trim().is_empty() {
        return None;
    }
    let number = |text: &str| text.parse::<i64>().ok();
    if let Some(m) = SXXEYY.captures(title) {
        let episode = number(&m[2])?;
        let through = through(&title[m.get(0)?.end()..], episode);
        return Some(Episode { season: number(&m[1]), episode, through });
    }
    if let Some(m) = NXNN.captures(title) {
        let episode = number(&m[2])?;
        return Some(Episode { season: number(&m[1]), episode, through: episode });
    }
    if let Some(m) = EPISODE.captures(title) {
        let episode = number(&m[1])?;
        return Some(Episode { season: None, episode, through: episode });
    }
    // "Show Name - 05 [1080p]", without mistaking years or resolutions for episodes: the number
    // must be 1–4 digits not followed by another digit, "p" or "x".
    let found = DASH_NUMBER.captures_iter(title).find_map(|m| {
        let digits = m.get(1)?;
        let next = title[digits.end()..].chars().next();
        (digits.len() <= 4 && !next.is_some_and(|c| matches!(c, 'p' | 'P' | 'x' | 'X'))).then(|| digits.as_str())
    })?;
    let value = number(found)?;
    (value > 0 && value < 1900).then_some(Episode { season: None, episode: value, through: value })
}

/// The last episode of a release whose first is `episode`, from what follows it in the title. A number
/// running into more digits, a resolution ("-1080p") or a size ("-2x") is not an episode.
fn through(rest: &str, episode: i64) -> i64 {
    let Some(m) = AND_EPISODE.captures(rest) else { return episode };
    let digits = &m[1];
    let next = rest[m.get(0).map_or(0, |m| m.end())..].chars().next();
    if next.is_some_and(|c| c.is_ascii_digit() || matches!(c, 'p' | 'P' | 'x' | 'X')) {
        return episode;
    }
    digits.parse::<i64>().ok().filter(|&last| last > episode && last - episode <= MAX_SPAN).unwrap_or(episode)
}

#[derive(Clone, Copy)]
pub struct EpisodeRule<'a> {
    pub query: &'a str,
    pub title_filter: Option<&'a str>,
    pub season: Option<i64>,
}

/// Whether a result title is the wanted episode of this rule.
pub fn matches_episode(title: &str, rule: &EpisodeRule<'_>, wanted_episode: i64) -> bool {
    let lower = title.to_lowercase();
    let required = rule.query.split(' ').chain(rule.title_filter.unwrap_or_default().split(' ')).filter(|t| !t.is_empty());
    if !required.into_iter().all(|token| lower.contains(&token.to_lowercase())) {
        return false;
    }
    let Some(parsed) = parse_episode(title) else { return false };
    if parsed.episode != wanted_episode {
        return false;
    }
    // A season is required, so a title without one can't be trusted to be the right season.
    rule.season.is_none_or(|season| parsed.season == Some(season))
}

/// Queries to try for one episode: targeted first, then broader.
pub fn episode_queries(rule: &EpisodeRule<'_>, episode: i64) -> Vec<String> {
    let mut queries = Vec::new();
    if let Some(season) = rule.season {
        queries.push(format!("{} S{season:02}E{episode:02}", rule.query));
    }
    for query in [format!("{} {episode:02}", rule.query), rule.query.to_owned()] {
        if !queries.contains(&query) {
            queries.push(query);
        }
    }
    queries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(season: Option<i64>, episode: i64) -> Option<Episode> {
        Some(Episode { season, episode, through: episode })
    }

    #[test]
    fn titles_with_a_season() {
        for (title, season, episode) in [
            ("Show.Name.S01E05.1080p.WEB-DL", 1, 5),
            ("Show Name S02E12", 2, 12),
            ("show.name.s1e5.720p", 1, 5),
            ("Show Name 1x05", 1, 5),
            ("Show.Name.2x12.HDTV", 2, 12),
        ] {
            assert_eq!(parse_episode(title), ep(Some(season), episode), "{title}");
        }
    }

    #[test]
    fn titles_without_a_season() {
        for (title, episode) in [
            ("Show Name Episode 5", 5),
            ("Show Name Ep05", 5),
            ("Show Name E05", 5),
            ("Some Anime Show - 05 [1080p]", 5),
            ("Some Anime Show - 123 [720p]", 123),
        ] {
            assert_eq!(parse_episode(title), ep(None, episode), "{title}");
        }
    }

    #[test]
    fn nothing_to_parse() {
        assert_eq!(parse_episode(""), None);
        assert_eq!(parse_episode("   "), None);
        assert_eq!(parse_episode("Documentary 2024 1080p"), None);
        assert_eq!(parse_episode("Show - 1080p"), None);
        assert_eq!(parse_episode("Show Movie - 2024"), None);
    }

    #[test]
    fn a_double_episode_or_a_pack_holds_every_episode_it_names() {
        for (title, episode, through) in [
            ("Show.S01E01E02.1080p.WEB", 1, 2),
            ("Show S01E01-E02 720p", 1, 2),
            ("Show.S02E03-04.HDTV", 3, 4),
            ("Show S01E01-E12 Complete", 1, 12),
            ("Show S01E01-1080p", 1, 1),
            ("Show S01E01-2x", 1, 1),
            ("Show S01E05-E03", 5, 5),
            ("Show S01E01-E900", 1, 1),
            ("Show S01E01-12345", 1, 1),
            ("Show S01E07 - 08 [1080p]", 7, 7),
            ("Show S01E01", 1, 1),
        ] {
            let parsed = parse_episode(title).unwrap();
            assert_eq!((parsed.episode, parsed.through), (episode, through), "{title}");
        }
    }

    #[test]
    fn prefers_sxxeyy_over_an_anime_dash() {
        assert_eq!(parse_episode("Show - 07 S02E03"), ep(Some(2), 3));
    }

    #[test]
    fn query_episode_and_season_must_all_agree() {
        let rule = EpisodeRule { query: "Mushoku Tensei", title_filter: None, season: None };
        let season3 = EpisodeRule { season: Some(3), ..rule };
        let filtered = EpisodeRule { title_filter: Some("1080p"), ..rule };
        assert!(matches_episode("[Sub] Mushoku Tensei - 06 (1080p)", &rule, 6));
        assert!(!matches_episode("[Sub] Mushoku Tensei - 07 (1080p)", &rule, 6));
        assert!(!matches_episode("[Sub] Mushoku Tensei S02E06", &season3, 6));
        assert!(!matches_episode("[Sub] Mushoku Tensei - 06", &season3, 6));
        assert!(!matches_episode("[Sub] Mushoku - 06", &rule, 6));
        assert!(!matches_episode("[Sub] Mushoku Tensei - 06 (720p)", &filtered, 6));
        assert!(matches_episode("[SUB] MUSHOKU TENSEI - 06 (1080P)", &filtered, 6));
        assert!(!matches_episode("Mushoku Tensei Movie", &rule, 6));
    }

    #[test]
    fn targeted_queries_come_first() {
        let with_season = EpisodeRule { query: "Show", title_filter: None, season: Some(2) };
        assert_eq!(episode_queries(&with_season, 5), ["Show S02E05", "Show 05", "Show"]);
        let without = EpisodeRule { season: None, ..with_season };
        assert_eq!(episode_queries(&without, 12), ["Show 12", "Show"]);
    }
}
