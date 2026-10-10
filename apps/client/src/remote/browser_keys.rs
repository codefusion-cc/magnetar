use std::sync::Arc;

use rusqlite::{OptionalExtension, params};

use crate::db::{Db, SecretBox};
use crate::protocol::LinkedBrowserDto;
use crate::protocol::e2e::KEY_BYTES;
use crate::protocol::encoding::{from_base64url, now_iso, random_bytes, random_id, to_base64url};
use crate::protocol::link_code;

/// The condition on a key's expiry, `now` (ISO) being the statement's last parameter.
const UNEXPIRED: &str = "(expires_at IS NULL OR expires_at > ?)";

/// Deletes the other key of the link that key `?1` belongs to, if nobody has used it.
const DELETE_UNUSED_SIBLING: &str = "DELETE FROM browser_keys WHERE last_seen_at IS NULL AND key_id <> ?1 AND (pair_of = ?1 OR key_id = (SELECT pair_of FROM browser_keys WHERE key_id = ?1))";

/// The keys of browsers allowed to reach this device through the relay, sealed at rest. A key is
/// minted here and leaves only inside a link fragment, so the relay never holds one.
pub struct BrowserKeyStore {
    db: Db,
    sealer: Arc<SecretBox>,
}

impl BrowserKeyStore {
    pub fn new(db: Db, sealer: Arc<SecretBox>) -> Self {
        Self { db, sealer }
    }

    pub fn db(&self) -> Db {
        self.db.clone()
    }

    /// Mints a key; `active` false keeps it unusable until pairing completes. A key with `expires_at` (ISO, a
    /// link nobody has opened yet) stops working then, unless a browser has connected with it first.
    pub fn mint(&self, label: &str, active: bool, expires_at: Option<&str>) -> anyhow::Result<(String, Vec<u8>)> {
        let key_id = random_id(9);
        let key = random_bytes(KEY_BYTES);
        self.insert(&key_id, &key, label, active, expires_at, None)?;
        Ok((key_id, key))
    }

    fn insert(
        &self,
        key_id: &str,
        key: &[u8],
        label: &str,
        active: bool,
        expires_at: Option<&str>,
        pair_of: Option<&str>,
    ) -> anyhow::Result<()> {
        self.db.lock().execute(
            "INSERT INTO browser_keys (key_id, key, label, created_at, active, expires_at, pair_of) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![key_id, self.sealer.seal(&to_base64url(key)), label, now_iso(), active, expires_at, pair_of],
        )?;
        Ok(())
    }

    /// Mints the two keys of one link, both expiring at `expires_at`: a random one for the QR code and the one a typed
    /// code stands for. Whichever a browser connects with first stays, the other is deleted. The code's key is not in
    /// `list` until it is used. Returns the QR key (id, key), the code and the id of the code's key.
    pub fn mint_link(&self, label: &str, expires_at: &str) -> anyhow::Result<((String, Vec<u8>), String, String)> {
        let qr = self.mint(label, true, Some(expires_at))?;
        let code = link_code::generate();
        let (code_key_id, code_key) =
            link_code::derive(&code).ok_or_else(|| anyhow::anyhow!("a generated code is always valid"))?;
        if let Err(error) = self.insert(&code_key_id, &code_key, label, true, Some(expires_at), Some(&qr.0)) {
            // Half a link is not handed out, so it must not stay behind either.
            self.revoke(&qr.0);
            return Err(error);
        }
        Ok((qr, code, code_key_id))
    }

    pub fn activate(&self, key_id: &str) {
        let _ = self.db.lock().execute("UPDATE browser_keys SET active = 1 WHERE key_id = ?", [key_id]);
    }

    /// The key for a handshake, or None when unknown, inactive, expired or revoked.
    pub fn lookup(&self, key_id: &str) -> Option<Vec<u8>> {
        let sealed: String = self
            .db
            .lock()
            .query_row(
                &format!("SELECT key FROM browser_keys WHERE key_id = ? AND active = 1 AND {UNEXPIRED}"),
                params![key_id, now_iso()],
                |r| r.get(0),
            )
            .optional()
            .ok()??;
        let key = from_base64url(&self.sealer.open_sealed(&sealed).ok()?).ok()?;
        (key.len() == KEY_BYTES).then_some(key)
    }

    /// Records a connection with the key; a link that is used no longer expires. None, recording nothing, when the
    /// key is gone, inactive or expired by now (revoked or swept since its lookup); otherwise whether this was the
    /// key's first use.
    pub fn touch(&self, key_id: &str) -> Option<bool> {
        let now = now_iso();
        let db = self.db.lock();
        // One transaction: a first use that cannot delete the link's other key is no use at all, or both would link.
        let tx = db.unchecked_transaction().ok()?;
        let first_use: bool = tx
            .query_row(
                &format!("SELECT last_seen_at IS NULL FROM browser_keys WHERE key_id = ? AND active = 1 AND {UNEXPIRED}"),
                params![key_id, now],
                |r| r.get(0),
            )
            .optional()
            .ok()??;
        tx.execute("UPDATE browser_keys SET last_seen_at = ?, expires_at = NULL WHERE key_id = ?", params![now, key_id]).ok()?;
        if first_use {
            // The link is spent.
            tx.execute(DELETE_UNUSED_SIBLING, [key_id]).ok()?;
        }
        tx.commit().ok()?;
        Some(first_use)
    }

    /// Deletes a key. For a link nobody has used yet that is both of its keys, whichever one is named: a revoked
    /// link's typed code must not go on working until it expires.
    pub fn revoke(&self, key_id: &str) {
        let db = self.db.lock();
        let _ = db.execute(DELETE_UNUSED_SIBLING, [key_id]);
        let _ = db.execute("DELETE FROM browser_keys WHERE key_id = ?", [key_id]);
    }

    pub fn revoke_inactive(&self) {
        let _ = self.db.lock().execute("DELETE FROM browser_keys WHERE active = 0", []);
    }

    /// Deletes every link that expired unused; returns how many.
    pub fn revoke_expired(&self) -> usize {
        self.db.lock().execute("DELETE FROM browser_keys WHERE expires_at <= ?", [now_iso()]).unwrap_or(0)
    }

    /// When the next link nobody has used yet expires (ISO), if there is one.
    pub fn next_expiry(&self) -> Option<String> {
        self.db.lock().query_row("SELECT MIN(expires_at) FROM browser_keys", [], |r| r.get(0)).ok()?
    }

    pub fn revoke_all(&self) {
        let _ = self.db.lock().execute("DELETE FROM browser_keys", []);
    }

    pub fn list(&self) -> Vec<LinkedBrowserDto> {
        let db = self.db.lock();
        let Ok(mut statement) =
            db.prepare(&format!(
                "SELECT key_id, label, created_at, last_seen_at FROM browser_keys WHERE active = 1 AND {UNEXPIRED} AND (pair_of IS NULL OR last_seen_at IS NOT NULL) ORDER BY created_at"
            ))
        else {
            return Vec::new();
        };
        statement
            .query_map([now_iso()], |r| {
                Ok(LinkedBrowserDto { key_id: r.get(0)?, label: r.get(1)?, created_at: r.get(2)?, last_seen_at: r.get(3)? })
            })
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SecretBox;
    use crate::protocol::encoding::iso;

    fn store() -> (BrowserKeyStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("magnetar.db")).unwrap();
        let sealer = Arc::new(SecretBox::open(&dir.path().join("secret.key")).unwrap());
        (BrowserKeyStore::new(db, sealer), dir)
    }

    fn at(minutes: i64) -> String {
        iso(chrono::Utc::now() + chrono::Duration::minutes(minutes))
    }

    fn listed(store: &BrowserKeyStore) -> Vec<String> {
        store.list().into_iter().map(|b| b.key_id).collect()
    }

    #[test]
    fn a_link_nobody_used_in_time_is_refused_and_swept_even_after_a_restart() {
        let (store, _dir) = store();
        let (fresh, _) = store.mint("Phone", true, Some(&at(10))).unwrap();
        let (stale, _) = store.mint("Tablet", true, Some(&at(-1))).unwrap();
        let (paired, _) = store.mint("Browser used for pairing", true, None).unwrap();

        assert!(store.lookup(&fresh).is_some());
        assert!(store.lookup(&stale).is_none(), "an expired link must not open a connection");
        assert_eq!(listed(&store), [fresh.clone(), paired.clone()]);

        assert_eq!(store.revoke_expired(), 1);
        assert_eq!(store.revoke_expired(), 0);
        let rows: i64 = store.db.lock().query_row("SELECT COUNT(*) FROM browser_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2, "only the expired link is deleted");
    }

    #[test]
    fn a_used_link_no_longer_expires_but_an_expired_one_is_not_revived() {
        let (store, _dir) = store();
        let (used, _) = store.mint("Phone", true, Some(&at(10))).unwrap();
        let (late, _) = store.mint("Tablet", true, Some(&at(-1))).unwrap();
        let (pending, _) = store.mint("Browser used for pairing", false, None).unwrap();
        assert_eq!(store.touch(&used), Some(true), "the first connection");
        assert_eq!(store.touch(&used), Some(false));
        assert_eq!(store.touch(&late), None, "an expired link is not usable");
        assert_eq!(store.touch("unknown"), None);
        assert_eq!(store.touch(&pending), None, "a key pairing has not activated is not usable");
        assert!(store.list()[0].last_seen_at.is_some());

        // Time passes: whatever still has an expiry is past it now.
        store.db.lock().execute("UPDATE browser_keys SET expires_at = ? WHERE expires_at IS NOT NULL", [at(-60)]).unwrap();
        assert_eq!(store.revoke_expired(), 1);
        assert!(store.lookup(&used).is_some());
        assert!(store.lookup(&late).is_none());
        assert_eq!(store.touch(&late), None);
    }

    #[test]
    fn the_next_expiry_is_the_soonest_unused_link() {
        let (store, _dir) = store();
        assert_eq!(store.next_expiry(), None);
        store.mint("Browser used for pairing", true, None).unwrap();
        assert_eq!(store.next_expiry(), None, "a key without an expiry is not a pending link");
        let (later, soon) = (at(10), at(5));
        let (first, _) = store.mint("Phone", true, Some(&later)).unwrap();
        let (second, _) = store.mint("Tablet", true, Some(&soon)).unwrap();
        assert_eq!(store.next_expiry(), Some(soon));
        store.touch(&second);
        assert_eq!(store.next_expiry(), Some(later));
        store.revoke(&first);
        assert_eq!(store.next_expiry(), None);
    }

    #[test]
    fn a_link_has_a_qr_key_and_a_typed_code_and_the_first_used_wins() {
        let (store, _dir) = store();
        let ((qr, qr_key), code, _) = store.mint_link("Phone", &at(10)).unwrap();
        let (code_id, code_key) = link_code::derive(&code).unwrap();
        assert_eq!(store.lookup(&qr).unwrap(), qr_key);
        assert_eq!(store.lookup(&code_id).unwrap(), code_key, "the device finds the key the typed code stands for");
        assert_ne!(qr_key, code_key, "the QR code keeps a key of its own, all random");
        assert_eq!(listed(&store), vec![qr.clone()], "an unused code is not another pending browser");

        assert_eq!(store.touch(&code_id), Some(true));
        assert!(store.lookup(&qr).is_none(), "the QR key is spent once the code was used");
        assert_eq!(listed(&store), vec![code_id.clone()]);
        assert_eq!(store.touch(&code_id), Some(false));
        store.db.lock().execute("UPDATE browser_keys SET expires_at = ? WHERE expires_at IS NOT NULL", [at(-1)]).unwrap();
        assert!(store.lookup(&code_id).is_some(), "a used key does not expire");
    }

    #[test]
    fn using_the_qr_key_spends_the_typed_code() {
        let (store, _dir) = store();
        let ((qr, _), code, _) = store.mint_link("Phone", &at(10)).unwrap();
        let (code_id, _) = link_code::derive(&code).unwrap();
        assert_eq!(store.touch(&qr), Some(true));
        assert!(store.lookup(&code_id).is_none(), "a code cannot link a second browser after the QR code linked one");
        assert_eq!(listed(&store), vec![qr]);
    }

    #[test]
    fn a_link_nobody_used_leaves_neither_key_behind() {
        let (store, _dir) = store();
        let ((qr, _), code, _) = store.mint_link("Phone", &at(-1)).unwrap();
        let (code_id, _) = link_code::derive(&code).unwrap();
        assert!(store.lookup(&qr).is_none() && store.lookup(&code_id).is_none(), "expired keys open nothing");
        assert_eq!(store.revoke_expired(), 2);
        let rows: i64 = store.db.lock().query_row("SELECT COUNT(*) FROM browser_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn revoking_a_link_nobody_used_kills_its_qr_key_and_its_code() {
        let (store, _dir) = store();
        let ((qr, _), code, _) = store.mint_link("Phone", &at(10)).unwrap();
        let (code_id, _) = link_code::derive(&code).unwrap();
        let ((other, _), other_code, _) = store.mint_link("Tablet", &at(10)).unwrap();
        let (other_code_id, _) = link_code::derive(&other_code).unwrap();

        // The list shows only the QR key, so that is the id a dashboard revokes.
        store.revoke(&qr);
        assert!(store.lookup(&qr).is_none());
        assert!(store.lookup(&code_id).is_none(), "the code shown beside a revoked QR code opens nothing");
        assert_eq!(store.touch(&code_id), None);
        assert!(store.lookup(&other).is_some() && store.lookup(&other_code_id).is_some(), "another link is untouched");

        // By the code's id, as the dashboard that made the link could.
        store.revoke(&other_code_id);
        assert!(store.lookup(&other).is_none() && store.lookup(&other_code_id).is_none());
        let rows: i64 = store.db.lock().query_row("SELECT COUNT(*) FROM browser_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn revoking_a_linked_browser_leaves_other_browsers_linked() {
        let (store, _dir) = store();
        let ((_, _), code, _) = store.mint_link("Phone", &at(10)).unwrap();
        let (code_id, _) = link_code::derive(&code).unwrap();
        let ((tablet, _), _, _) = store.mint_link("Tablet", &at(10)).unwrap();
        store.touch(&code_id);
        store.touch(&tablet);
        store.revoke(&code_id);
        assert!(store.lookup(&code_id).is_none());
        assert_eq!(listed(&store), vec![tablet]);
    }

    /// Two browsers at once, one with the QR code and one with the typed code: handshakes reach the store one at a
    /// time, so the second finds its key gone, whichever it is.
    #[test]
    fn of_a_qr_code_and_a_typed_code_used_together_exactly_one_links() {
        for code_first in [true, false] {
            let (store, _dir) = store();
            let ((qr, _), code, _) = store.mint_link("Phone", &at(10)).unwrap();
            let (code_id, _) = link_code::derive(&code).unwrap();
            let (winner, loser) = if code_first { (code_id, qr) } else { (qr, code_id) };
            // Both looked their key up before either was counted as used.
            assert!(store.lookup(&winner).is_some() && store.lookup(&loser).is_some());
            assert_eq!(store.touch(&winner), Some(true));
            assert_eq!(store.touch(&loser), None, "the other key is refused, not counted as a second browser");
            assert!(store.lookup(&loser).is_none());
            assert_eq!(listed(&store), vec![winner.clone()]);
            assert_eq!(store.touch(&winner), Some(false), "the winner connects again");
        }
    }

    #[test]
    fn a_code_past_its_time_is_refused_before_the_sweep_runs_and_spends_nothing() {
        let (store, _dir) = store();
        let ((qr, _), code, _) = store.mint_link("Phone", &at(10)).unwrap();
        let (code_id, _) = link_code::derive(&code).unwrap();
        store.db.lock().execute("UPDATE browser_keys SET expires_at = ?", [at(-1)]).unwrap();
        assert!(store.lookup(&code_id).is_none());
        assert_eq!(store.touch(&code_id), None);
        let rows: i64 = store.db.lock().query_row("SELECT COUNT(*) FROM browser_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2, "a refused try deletes nothing: the sweep does");
        assert_eq!(store.touch(&qr), None);
    }

    #[test]
    fn a_first_use_that_cannot_delete_the_other_key_is_no_use() {
        let (store, _dir) = store();
        let ((qr, _), _, code_id) = store.mint_link("Phone", &at(10)).unwrap();
        store
            .db
            .lock()
            .execute_batch("CREATE TRIGGER no_delete BEFORE DELETE ON browser_keys BEGIN SELECT RAISE(ABORT, 'disk'); END")
            .unwrap();
        assert_eq!(store.touch(&code_id), None);
        let used: i64 = store
            .db
            .lock()
            .query_row("SELECT COUNT(*) FROM browser_keys WHERE last_seen_at IS NOT NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(used, 0, "the code is not marked used while the QR key still works");
        store.db.lock().execute_batch("DROP TRIGGER no_delete").unwrap();
        assert_eq!(store.touch(&qr), Some(true));
        assert_eq!(store.touch(&code_id), None);
    }

    #[test]
    fn using_one_link_leaves_the_keys_of_other_links_alone() {
        let (store, _dir) = store();
        let ((first, _), _, _) = store.mint_link("One", &at(10)).unwrap();
        let ((second, _), second_code, _) = store.mint_link("Two", &at(10)).unwrap();
        let (second_code_id, _) = link_code::derive(&second_code).unwrap();
        store.touch(&first);
        assert!(store.lookup(&second).is_some() && store.lookup(&second_code_id).is_some());
    }
}
