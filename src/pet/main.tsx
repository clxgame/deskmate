import "../devtools";
import { createRoot } from "react-dom/client";
import PetApp from "./PetApp";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing pet root element");
createRoot(root).render(<PetApp />);
