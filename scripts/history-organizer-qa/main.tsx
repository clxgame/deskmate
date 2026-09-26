import "../../src/theme.css";
import "../../src/chat/chat.css";
import { createRoot } from "react-dom/client";
import { HistoryOrganizer } from "../../src/chat/HistoryOrganizer";

const params = new URLSearchParams(location.search);
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
root.className = "chat-root";
root.dataset.theme = params.get("theme") ?? "peach";
createRoot(root).render(<HistoryOrganizer language={params.get("lang") ?? "zh-CN"} onOpen={() => {}} onClose={() => {}} onNewChat={() => {}} />);
