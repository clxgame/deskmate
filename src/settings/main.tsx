import "../devtools";
import { createRoot } from "react-dom/client";
import SettingsApp from "./SettingsApp";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing settings root element");
createRoot(root).render(<SettingsApp />);
