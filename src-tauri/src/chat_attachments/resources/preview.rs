use super::*;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{Request, Response, StatusCode};

const CHUNK_BYTES: u64 = 2 * 1024 * 1024;

pub(crate) fn respond_preview(
    store: &ResourceStore,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let response = (|| {
        if request.method() != "GET" && request.method() != "HEAD" {
            return Err(StatusCode::METHOD_NOT_ALLOWED);
        }
        let id = request
            .uri()
            .path()
            .strip_prefix('/')
            .ok_or(StatusCode::NOT_FOUND)?;
        let record = store.get(id).map_err(|_| StatusCode::NOT_FOUND)?;
        if !matches!(record.kind, ResourceKind::Audio | ResourceKind::Video)
            && !record.mime.starts_with("image/")
        {
            return Err(StatusCode::FORBIDDEN);
        }
        let mut file =
            std::fs::File::open(record.checked_path().map_err(|_| StatusCode::NOT_FOUND)?)
                .map_err(|_| StatusCode::NOT_FOUND)?;
        let size = file.metadata().map_err(|_| StatusCode::NOT_FOUND)?.len();
        let range_header = request.headers().get("range").and_then(|h| h.to_str().ok());
        let mut builder = Response::builder()
            .header("Content-Type", &record.mime)
            .header("Accept-Ranges", "bytes")
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Access-Control-Allow-Origin", "*");
        if request.method() == "HEAD" {
            return builder
                .header("Content-Length", size)
                .body(Vec::new())
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
        // The protocol API buffers a response. Normal full responses are bounded; large
        // media must use byte ranges rather than silently receiving a truncated 200/206.
        let full_limit = if record.mime.starts_with("image/") {
            20 * 1024 * 1024
        } else {
            64 * 1024 * 1024
        };
        if range_header.is_none() && size > full_limit {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        if size == 0 && range_header.is_none() {
            return builder
                .header("Content-Length", 0)
                .body(Vec::new())
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
        let (start, end) = match byte_range(range_header, size) {
            Some(range) => range,
            None => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header("Content-Range", format!("bytes */{size}"))
                    .header("Accept-Ranges", "bytes")
                    .body(Vec::new())
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
            }
        };
        let length = end - start + 1;
        if range_header.is_some() || length < size {
            builder = builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header("Content-Range", format!("bytes {start}-{end}/{size}"));
        }
        file.seek(SeekFrom::Start(start))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut body = vec![0; length as usize];
        file.read_exact(&mut body)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        builder
            .header("Content-Length", length)
            .body(body)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    })();
    response.unwrap_or_else(|status| {
        Response::builder()
            .status(status)
            .header("Cache-Control", "no-store")
            .body(Vec::new())
            .expect("static response")
    })
}

fn byte_range(header: Option<&str>, size: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let Some(header) = header else {
        return Some((0, size - 1));
    };
    let range = header.strip_prefix("bytes=")?;
    if range.contains(',') {
        return None;
    }
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = size.saturating_sub(suffix);
        return Some((start, (size - 1).min(start.saturating_add(CHUNK_BYTES - 1))));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    if start >= size || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(CHUNK_BYTES - 1))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_are_bounded_and_reject_invalid_requests() {
        assert_eq!(byte_range(Some("bytes=2-5"), 10), Some((2, 5)));
        assert_eq!(byte_range(Some("bytes=-3"), 10), Some((7, 9)));
        assert_eq!(byte_range(Some("bytes=5-"), 10), Some((5, 9)));
        assert_eq!(byte_range(Some("bytes=10-"), 10), None);
        assert_eq!(byte_range(Some("bytes=3-2"), 10), None);
        assert_eq!(byte_range(Some("bytes=0-2,4-6"), 10), None);
        assert_eq!(byte_range(Some("bytes=-0"), 10), None);
        assert_eq!(
            byte_range(None, CHUNK_BYTES * 10),
            Some((0, CHUNK_BYTES * 10 - 1))
        );
    }
}
