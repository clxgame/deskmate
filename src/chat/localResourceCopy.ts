import type { Lang } from "../lib/i18n";

const labels = {
  "zh-CN": {
    tray: "文件与文件夹", file: "文件", directory: "文件夹", audio: "音频", video: "视频", image: "图片",
    remove: "移除", expand: "查看内容", collapse: "收起内容", loading: "正在读取文件夹…",
    empty: "此文件夹为空", directoryError: "暂时无法读取此文件夹，请重试。", retry: "重试",
    truncated: "仅显示部分内容", preview: "预览", unavailable: "此文件暂无预览",
    mediaError: "无法播放预览：原文件可能已移动或无法读取，或当前系统不支持此编码。",
    imageError: "暂时无法显示图片预览。文件仍可使用。",
    missing: "原文件已移动、删除或无法读取，请重新拖入。",
    wrongSession: "此附件属于另一个会话，请在当前会话重新拖入。",
    tooMany: "一次最多添加 32 个文件或文件夹，请分批发送。",
    tooLarge: "此文件超过附件大小限制。音视频请直接从文件管理器拖入，避免复制整个文件。",
    uploadSize: "粘贴的音视频必须非空且不超过 64 MB。较大文件请直接从文件管理器拖入。",
    invalidResource: "无法添加此文件，请检查文件格式并重新拖入。",
    sessionError: "暂时无法连接当前会话，附件已保留，请重试发送。",
    resourceError: "暂时无法读取附件，请重试或重新拖入。",
  },
  "en-US": {
    tray: "Files and folders", file: "File", directory: "Folder", audio: "Audio", video: "Video", image: "Image",
    remove: "Remove", expand: "Show contents", collapse: "Hide contents", loading: "Reading folder…",
    empty: "This folder is empty", directoryError: "This folder cannot be read right now. Try again.", retry: "Retry",
    truncated: "Showing some items", preview: "Preview", unavailable: "No preview available",
    mediaError: "The preview could not play. The original may have moved or cannot be read, or your system may not support this encoding.",
    imageError: "The image preview is unavailable. The file is still available.",
    missing: "The original file was moved, deleted, or cannot be read. Add it again.",
    wrongSession: "This attachment belongs to another conversation. Add it again here.",
    tooMany: "Add up to 32 files or folders at a time. Send them in batches.",
    tooLarge: "This file exceeds the attachment size limit. Drag audio or video directly from your file manager.",
    uploadSize: "Pasted media must be nonempty and no larger than 64 MB. Drag larger files directly from your file manager.",
    invalidResource: "This file could not be added. Check its format and add it again.",
    sessionError: "The conversation is temporarily unavailable. Your attachments are retained; try sending again.",
    resourceError: "The attachment cannot be read right now. Try again or add it again.",
  },
  "ja-JP": {
    tray: "ファイルとフォルダー", file: "ファイル", directory: "フォルダー", audio: "音声", video: "動画", image: "画像",
    remove: "削除", expand: "内容を表示", collapse: "内容を閉じる", loading: "フォルダーを読み込み中…",
    empty: "このフォルダーは空です", directoryError: "フォルダーを読み込めません。再試行してください。", retry: "再試行",
    truncated: "一部の項目を表示しています", preview: "プレビュー", unavailable: "プレビューはありません",
    mediaError: "プレビューを再生できません。元のファイルが移動・読み込み不可になったか、システムが形式に対応していない可能性があります。",
    imageError: "画像のプレビューを表示できません。ファイルは引き続き使用できます。",
    missing: "元のファイルが移動・削除されたか、読み込めません。追加し直してください。",
    wrongSession: "この添付は別の会話に属しています。現在の会話に追加し直してください。",
    tooMany: "一度に追加できるファイルとフォルダーは 32 個までです。分けて送信してください。",
    tooLarge: "添付サイズの上限を超えています。音声・動画はファイル管理アプリから直接ドラッグしてください。",
    uploadSize: "貼り付ける音声・動画は空でなく、64 MB 以下である必要があります。大きいファイルは直接ドラッグしてください。",
    invalidResource: "追加できません。ファイル形式を確認して追加し直してください。",
    sessionError: "会話に接続できません。添付は保持されています。再送信してください。",
    resourceError: "添付を読み込めません。再試行するか追加し直してください。",
  },
  "ko-KR": {
    tray: "파일 및 폴더", file: "파일", directory: "폴더", audio: "오디오", video: "동영상", image: "이미지",
    remove: "제거", expand: "내용 보기", collapse: "내용 접기", loading: "폴더 읽는 중…",
    empty: "이 폴더는 비어 있습니다", directoryError: "폴더를 읽을 수 없습니다. 다시 시도하세요.", retry: "다시 시도",
    truncated: "일부 항목만 표시합니다", preview: "미리 보기", unavailable: "미리 보기를 사용할 수 없습니다",
    mediaError: "미리 보기를 재생할 수 없습니다. 원본이 이동되었거나 읽을 수 없거나 시스템에서 이 코덱을 지원하지 않을 수 있습니다.",
    imageError: "이미지 미리 보기를 표시할 수 없습니다. 파일은 계속 사용할 수 있습니다.",
    missing: "원본 파일이 이동 또는 삭제되었거나 읽을 수 없습니다. 다시 추가하세요.",
    wrongSession: "다른 대화의 첨부 파일입니다. 현재 대화에 다시 추가하세요.",
    tooMany: "파일과 폴더는 한 번에 최대 32개까지 추가할 수 있습니다. 나누어 보내세요.",
    tooLarge: "첨부 크기 제한을 초과했습니다. 오디오와 동영상은 파일 관리자에서 직접 드래그하세요.",
    uploadSize: "붙여넣는 미디어는 비어 있지 않아야 하며 64 MB 이하여야 합니다. 더 큰 파일은 직접 드래그하세요.",
    invalidResource: "파일을 추가할 수 없습니다. 형식을 확인하고 다시 추가하세요.",
    sessionError: "대화에 연결할 수 없습니다. 첨부 파일은 유지되므로 다시 보내세요.",
    resourceError: "첨부 파일을 읽을 수 없습니다. 다시 시도하거나 다시 추가하세요.",
  },
} as const;

export function localResourceCopy(lang: Lang) {
  return labels[lang];
}

export function localResourceError(lang: Lang, cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause);
  const copy = labels[lang];
  if (["resource_missing", "resource_path_changed"].includes(code)) return copy.missing;
  if (code === "resource_wrong_session") return copy.wrongSession;
  if (code === "resource_selection_too_many") return copy.tooMany;
  if (code === "resource_attachment_too_large") return copy.tooLarge;
  if (code === "resource_upload_size_limit") return copy.uploadSize;
  if (["resource_session_unavailable", "resource_permission_failed"].includes(code)) return copy.sessionError;
  if (["resource_upload_unsupported", "resource_invalid_name", "resource_not_file_or_directory"].includes(code)) return copy.invalidResource;
  return copy.resourceError;
}
