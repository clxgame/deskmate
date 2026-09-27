export function composerCopy(language: string) {
  switch (language) {
    case "en-US": return {
      folder: "Folder", otherFolder: "Choose another folder…", leaveFolder: "Leave folder work",
      recentFolders: "Recent folders", model: "Choose model", inherit: "Follow default",
      manageModels: "Manage models…", search: "Search models", retry: "Retry",
      unavailable: "Unavailable", noModels: "No verified models", modelInvalid: "Reselect model",
      folderLocked: "Finish the current task before changing folders",
      modelLocked: "Finish the current reply before changing models",
      keepAttachments: "Keep attachments and chat", removeAttachments: "Remove attachments and enter folder work",
      attachmentConflict: "Folder tasks do not support attachments yet.",
      returnTask: "Return to task",
    };
    case "ja-JP": return {
      folder: "フォルダー", otherFolder: "別のフォルダーを選択…", leaveFolder: "フォルダー作業を終了",
      recentFolders: "最近のフォルダー", model: "モデルを選択", inherit: "既定に従う",
      manageModels: "モデルを管理…", search: "モデルを検索", retry: "再試行",
      unavailable: "利用できません", noModels: "検証済みモデルがありません", modelInvalid: "モデルを再選択",
      folderLocked: "現在のタスクが終了してからフォルダーを変更してください",
      modelLocked: "現在の応答が終了してからモデルを変更してください",
      keepAttachments: "添付ファイルを保持してチャット", removeAttachments: "添付ファイルを削除してフォルダー作業へ",
      attachmentConflict: "フォルダー作業では添付ファイルを使用できません。",
      returnTask: "タスクに戻る",
    };
    case "ko-KR": return {
      folder: "폴더", otherFolder: "다른 폴더 선택…", leaveFolder: "폴더 작업 종료",
      recentFolders: "최근 폴더", model: "모델 선택", inherit: "기본값 사용",
      manageModels: "모델 관리…", search: "모델 검색", retry: "다시 시도",
      unavailable: "사용할 수 없음", noModels: "검증된 모델 없음", modelInvalid: "모델 다시 선택",
      folderLocked: "현재 작업이 끝난 뒤 폴더를 변경하세요",
      modelLocked: "현재 응답이 끝난 뒤 모델을 변경하세요",
      keepAttachments: "첨부 파일 유지하고 채팅", removeAttachments: "첨부 파일 제거 후 폴더 작업",
      attachmentConflict: "폴더 작업에서는 첨부 파일을 사용할 수 없습니다.",
      returnTask: "작업으로 돌아가기",
    };
    default: return {
      folder: "文件夹", otherFolder: "选择其他文件夹…", leaveFolder: "退出文件夹工作",
      recentFolders: "最近文件夹", model: "选择模型", inherit: "跟随默认",
      manageModels: "管理模型…", search: "搜索模型", retry: "重试",
      unavailable: "不可用", noModels: "没有已验证模型", modelInvalid: "重新选择模型",
      folderLocked: "请先完成当前任务再切换文件夹",
      modelLocked: "请先完成当前回复再切换模型",
      keepAttachments: "保留附件继续聊天", removeAttachments: "移除附件并进入文件夹工作",
      attachmentConflict: "文件夹任务暂不支持附件。",
      returnTask: "返回任务",
    };
  }
}

export function modelErrorCopy(language: string, cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause);
  const messages: Record<string, Record<string, string>> = {
    "zh-CN": {
      chat_model_provider_missing: "请先在 AI 设置中配置服务商。",
      chat_model_catalog_unverified: "模型列表尚未验证或已过期，请在 AI 设置中重新验证。",
      chat_model_default_missing: "默认模型不可用，请选择模型或在 AI 设置中设置默认模型。",
      chat_model_selection_invalid: "当前模型已失效，请重新选择。",
      chat_model_changed_before_send: "发送前模型设置发生变化，请重试。",
      fallback: "模型暂不可用，请重试或检查 AI 设置。",
    },
    "en-US": {
      chat_model_provider_missing: "Configure a provider in AI settings first.",
      chat_model_catalog_unverified: "The model list is unverified or expired. Verify it in AI settings.",
      chat_model_default_missing: "The default model is unavailable. Choose a model or set a default in AI settings.",
      chat_model_selection_invalid: "This model is no longer available. Choose another model.",
      chat_model_changed_before_send: "Model settings changed before sending. Try again.",
      fallback: "Models are unavailable. Retry or check AI settings.",
    },
    "ja-JP": {
      chat_model_provider_missing: "先に AI 設定でプロバイダーを設定してください。",
      chat_model_catalog_unverified: "モデル一覧が未検証または期限切れです。AI 設定で再検証してください。",
      chat_model_default_missing: "既定のモデルを使用できません。モデルを選択するか AI 設定で既定値を設定してください。",
      chat_model_selection_invalid: "このモデルは使用できません。選び直してください。",
      chat_model_changed_before_send: "送信前にモデル設定が変わりました。再試行してください。",
      fallback: "モデルを使用できません。再試行するか AI 設定を確認してください。",
    },
    "ko-KR": {
      chat_model_provider_missing: "먼저 AI 설정에서 제공업체를 구성하세요.",
      chat_model_catalog_unverified: "모델 목록이 검증되지 않았거나 만료되었습니다. AI 설정에서 다시 검증하세요.",
      chat_model_default_missing: "기본 모델을 사용할 수 없습니다. 모델을 선택하거나 AI 설정에서 기본값을 지정하세요.",
      chat_model_selection_invalid: "현재 모델을 사용할 수 없습니다. 다시 선택하세요.",
      chat_model_changed_before_send: "전송 전에 모델 설정이 변경되었습니다. 다시 시도하세요.",
      fallback: "모델을 사용할 수 없습니다. 다시 시도하거나 AI 설정을 확인하세요.",
    },
  };
  const localized = messages[language] ?? messages["zh-CN"];
  return localized[code] ?? localized.fallback;
}

export function folderErrorCopy(language: string, cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause);
  if (code !== "history_directory_unavailable" && code !== "history_directory_unknown") return code;
  switch (language) {
    case "en-US": return "This folder is unavailable. Choose another folder.";
    case "ja-JP": return "このフォルダーは利用できません。別のフォルダーを選択してください。";
    case "ko-KR": return "이 폴더를 사용할 수 없습니다. 다른 폴더를 선택하세요.";
    default: return "此文件夹不可用，请重新选择。";
  }
}

export function taskStatusCopy(language: string, status: string): string {
  const labels: Record<string, Record<string, string>> = {
    "zh-CN": { active: "任务进行中", completed: "任务已完成", failed: "任务失败", cancelled: "任务已取消", interrupted: "任务已中断" },
    "en-US": { active: "Task in progress", completed: "Task completed", failed: "Task failed", cancelled: "Task cancelled", interrupted: "Task interrupted" },
    "ja-JP": { active: "タスク実行中", completed: "タスク完了", failed: "タスク失敗", cancelled: "タスクをキャンセルしました", interrupted: "タスクが中断されました" },
    "ko-KR": { active: "작업 진행 중", completed: "작업 완료", failed: "작업 실패", cancelled: "작업 취소됨", interrupted: "작업 중단됨" },
  };
  return (labels[language] ?? labels["zh-CN"])[status] ?? (labels[language] ?? labels["zh-CN"]).interrupted;
}
