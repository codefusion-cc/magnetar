//! Helpers shared by the integration tests.

/// A valid single-file .torrent of exactly `size` bytes, named `name`, padded with a comment
/// (outside the info dictionary, so the name alone sets the info hash).
pub fn torrent_of_size(size: usize, name: &str) -> Vec<u8> {
    const PIECE: usize = 16 * 1024;
    let info = |pieces: usize| {
        let mut info =
            format!("d6:lengthi{}e4:name{}:{name}12:piece lengthi{PIECE}e6:pieces{}:", pieces * PIECE, name.len(), pieces * 20)
                .into_bytes();
        info.extend((0..pieces * 20).map(|i| (i * 7 + name.len()) as u8));
        info.push(b'e');
        info
    };
    let wrap = |info: &[u8], comment: usize| {
        let mut torrent = format!("d7:comment{comment}:{}4:info", "x".repeat(comment)).into_bytes();
        torrent.extend_from_slice(info);
        torrent.push(b'e');
        torrent
    };
    let pieces = (size.saturating_sub(200) / 20).max(1);
    let info = info(pieces);
    let mut comment = size.saturating_sub(wrap(&info, 0).len());
    // The comment's length prefix grows with it: settle on the length that lands exactly.
    while wrap(&info, comment).len() > size {
        comment -= 1;
    }
    let torrent = wrap(&info, comment);
    assert_eq!(torrent.len(), size, "no comment length gives exactly {size} bytes");
    torrent
}

/// A valid .torrent of a folder `name` holding `files` (name, length).
#[allow(dead_code, reason = "not every test binary uses it")]
pub fn torrent_of_files(name: &str, files: &[(&str, usize)]) -> Vec<u8> {
    const PIECE: usize = 16 * 1024;
    let text = |s: &str| format!("{}:{s}", s.len());
    let total: usize = files.iter().map(|(_, length)| length).sum();
    let pieces = total.div_ceil(PIECE).max(1);
    let mut info = String::from("d5:filesl");
    for (file, length) in files {
        info += &format!("d6:lengthi{length}e4:pathl{}ee", text(file));
    }
    info += &format!("e4:name{}12:piece lengthi{PIECE}e6:pieces{}:", text(name), pieces * 20);
    let mut torrent = b"d4:info".to_vec();
    torrent.extend(info.into_bytes());
    torrent.extend((0..pieces * 20).map(|i| (i * 13 + name.len()) as u8));
    torrent.extend(b"ee");
    torrent
}
