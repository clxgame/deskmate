import "../devtools";
import "../theme.css";
import { createRoot } from "react-dom/client";
import ChatApp from "./ChatApp";
import { ChatKeyboardNavigation } from "./ChatKeyboardNavigation";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing chat root element");
createRoot(root).render(
  <>
    <ChatApp />
    <ChatKeyboardNavigation />
  </>,
);
