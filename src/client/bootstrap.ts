// This module is deliberately the browser entrypoint. Foldkit, Effect, and
// renderer dependencies must not evaluate until the compatibility layer has
// installed the standards APIs promised by the PWA's Safari support floor.
import "core-js/stable";
import "./browserCompatibility.ts";

void import("./foldkit/entry.ts");
