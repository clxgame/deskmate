use super::*;
use crate::chat_attachments::ncm::BinaryNcmRunner;
use crate::chat_attachments::types::ExportChatArtifactRequest;
use std::path::PathBuf;

#[test]
fn manual_qa_prints_native_codec_artifact_state() {
    let root_path;
    {
        let root = TempAttachmentRoot::new("ncm-manual-qa");
        root_path = root.path().to_path_buf();
        let store = AttachmentStore::default();
        let mp3 = stage_ncm(&store, root.path());
        let mp3_artifact = store
            .convert_staged_ncm(
                root.path(),
                convert_request("xiaozhu", &mp3.id),
                &FakeRunner {
                    run: FakeRun::OneMp3,
                },
            )
            .expect("manual QA MP3 conversion");
        let flac = stage_ncm(&store, root.path());
        let flac_artifact = store
            .convert_staged_ncm(
                root.path(),
                convert_request("xiaozhu", &flac.id),
                &FakeRunner {
                    run: FakeRun::OneFlac,
                },
            )
            .expect("manual QA FLAC conversion");
        let retry = stage_ncm(&store, root.path());
        store
            .convert_staged_ncm(
                root.path(),
                convert_request("xiaozhu", &retry.id),
                &FakeRunner {
                    run: FakeRun::Failure,
                },
            )
            .expect_err("manual QA failure before retry");
        let retry_state = store.read(read_request("session-a", &retry.id)).is_ok();
        let work_dir_cleaned = !root.path().join(&retry.id).join("work").exists();
        let retry_artifact = store
            .convert_staged_ncm(
                root.path(),
                convert_request("xiaozhu", &retry.id),
                &FakeRunner {
                    run: FakeRun::OneMp3,
                },
            )
            .expect("manual QA retry conversion");

        println!(
            "manual_ncm codec=mp3 mime={} extension=mp3 decoded_sha256={} size={}",
            mp3_artifact.mime,
            decoded_sha256(&mp3_artifact.data_url),
            mp3_artifact.size
        );
        println!(
            "manual_ncm codec=flac mime={} extension=flac decoded_sha256={} size={}",
            flac_artifact.mime,
            decoded_sha256(&flac_artifact.data_url),
            flac_artifact.size
        );
        println!(
            "manual_ncm retry_after_failure_source_readable={} work_dir_cleaned={} retry_mime={} retry_extension=mp3",
            retry_state, work_dir_cleaned, retry_artifact.mime
        );
    }
    println!("manual_ncm cleanup root_exists={}", root_path.exists());
    assert!(!root_path.exists());
}

#[test]
#[ignore = "requires YUME_REAL_NCM_QA_PATH and YUME_REAL_NCM_QA_DOWNLOAD_DIR"]
fn manual_qa_converts_real_ncm_with_bundled_runner_and_exports_downloads() {
    let source_path =
        PathBuf::from(std::env::var_os("YUME_REAL_NCM_QA_PATH").expect("YUME_REAL_NCM_QA_PATH"));
    let download_dir = PathBuf::from(
        std::env::var_os("YUME_REAL_NCM_QA_DOWNLOAD_DIR").expect("YUME_REAL_NCM_QA_DOWNLOAD_DIR"),
    );
    let evidence_dir = std::env::var_os("YUME_REAL_NCM_QA_EVIDENCE_DIR").map(PathBuf::from);
    let source_bytes = std::fs::read(&source_path).expect("read real NCM");
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .expect("real NCM filename");
    let binary = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ncmdump")
        .join(if cfg!(windows) {
            "ncmdump.exe"
        } else {
            "ncmdump"
        });
    assert!(binary.is_file(), "bundled ncmdump should exist");

    let root = TempAttachmentRoot::new("real-ncm-manual-qa");
    let store = AttachmentStore::default();
    let staged = store
        .stage(
            root.path(),
            stage_request(
                "session-real-ncm",
                source_name,
                "application/x-ncm",
                source_bytes,
            ),
        )
        .expect("stage real NCM by bytes");
    let artifact = store
        .convert_staged_ncm(
            root.path(),
            ConvertStagedNcmRequest {
                session_id: "session-real-ncm".to_string(),
                attachment_id: staged.id.clone(),
                persona_id: "xiaozhu".to_string(),
            },
            &BinaryNcmRunner { binary },
        )
        .expect("convert real NCM with bundled runner");
    let extension = artifact
        .file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .expect("artifact extension");
    assert!(matches!(extension, "mp3" | "flac"));
    assert!(matches!(
        artifact.mime.as_str(),
        "audio/mpeg" | "audio/flac"
    ));
    let decoded = decoded_bytes(&artifact.data_url);
    assert_eq!(decoded.len(), artifact.size);
    if extension == "flac" {
        assert!(decoded.starts_with(b"fLaC"), "FLAC artifact magic");
    } else {
        assert!(
            decoded.starts_with(b"ID3") || decoded.first() == Some(&0xff),
            "MP3 artifact magic"
        );
    }
    assert!(!root.path().join(&staged.id).join("source").exists());
    assert!(root
        .path()
        .join(&staged.id)
        .join(format!("artifact.{extension}"))
        .is_file());

    let receipt = store
        .export_artifact(
            &download_dir,
            ExportChatArtifactRequest {
                session_id: "session-real-ncm".to_string(),
                artifact_id: artifact.id.clone(),
            },
        )
        .expect("export converted artifact to Downloads");
    let exported_path = download_dir.join(&receipt.file_name);
    let exported_bytes = std::fs::read(&exported_path).expect("read exported artifact");
    assert_eq!(exported_bytes, decoded);

    let decoded_sha = format!("{:x}", Sha256::digest(&decoded));
    println!(
        "real_ncm source={} staged_id={} artifact={} mime={} size={} sha256={} exported={}",
        source_path.display(),
        staged.id,
        artifact.file_name,
        artifact.mime,
        artifact.size,
        decoded_sha,
        exported_path.display()
    );
    if let Some(evidence_dir) = evidence_dir {
        std::fs::create_dir_all(&evidence_dir).expect("create evidence dir");
        let evidence_path = evidence_dir.join("real-ncm-manual-qa.txt");
        std::fs::write(
            evidence_path,
            format!(
                "source={}\nstaged_id={}\nartifact_name={}\nmime={}\nsize={}\nsha256={}\nexported={}\nsource_removed_after_conversion=true\nexported_bytes_match_data_url=true\n",
                source_path.display(),
                staged.id,
                artifact.file_name,
                artifact.mime,
                artifact.size,
                decoded_sha,
                exported_path.display()
            ),
        )
        .expect("write real NCM evidence");
    }
}

fn decoded_bytes(data_url: &str) -> Vec<u8> {
    let (_, encoded) = data_url
        .split_once(',')
        .expect("data URL should contain base64 delimiter");
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("decode data URL payload")
}
