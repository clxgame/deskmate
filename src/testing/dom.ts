import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Component tests need a DOM before React renders. Bun runs this file once per
// test process via `bunfig.toml` [test].preload.
GlobalRegistrator.register();
