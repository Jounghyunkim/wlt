/// Incremental UTF-8 decoder: keeps incomplete multi-byte sequences that were
/// split across two reads and prepends them to the next chunk.
#[derive(Default)]
pub struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    pub fn decode(&mut self, input: &[u8]) -> String {
        let mut buf = std::mem::take(&mut self.pending);
        buf.extend_from_slice(input);

        let mut out = String::with_capacity(buf.len());
        let mut rest = &buf[..];
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    out.push_str(s);
                    break;
                }
                Err(e) => {
                    let (valid, after) = rest.split_at(e.valid_up_to());
                    // SAFETY: `valid_up_to` guarantees this prefix is valid UTF-8.
                    out.push_str(unsafe { std::str::from_utf8_unchecked(valid) });
                    match e.error_len() {
                        Some(len) => {
                            out.push('\u{FFFD}');
                            rest = &after[len..];
                        }
                        None => {
                            // Incomplete sequence at the end: wait for more bytes.
                            self.pending = after.to_vec();
                            break;
                        }
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8Decoder;

    #[test]
    fn joins_split_multibyte_sequences() {
        let bytes = "안녕 hello".as_bytes();
        let mut d = Utf8Decoder::default();
        let mut s = d.decode(&bytes[..2]);
        s += &d.decode(&bytes[2..4]);
        s += &d.decode(&bytes[4..]);
        assert_eq!(s, "안녕 hello");
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut d = Utf8Decoder::default();
        assert_eq!(d.decode(&[b'a', 0xff, b'b']), "a\u{FFFD}b");
    }
}
