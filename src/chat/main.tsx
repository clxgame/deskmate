import "../devtools";
import "../theme.css";
import { createRoot } from "react-dom/client";
import ChatApp from "./ChatApp";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing chat root element");
createRoot(root).render(<ChatApp />);
