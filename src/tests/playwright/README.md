# Browser suites

| Suite                                                | Runs on                 | Covers                                                                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `foldkitApp.pw.ts`                                   | Desktop Chrome          | The whole journey against a live worker: sign in by code and by password, sign out, the club list, a club opening onto its book, deep links and the back button, the split divider, and each header overlay. |
| `foldkitReader.pw.ts`, `foldkitReaderGestures.pw.ts` | Desktop / Mobile Safari | The reader slice alone, through its own harness — no account, no worker.                                                                                                                                     |
| `foldkitComposer.pw.ts`                              | Desktop Safari          | The Lexical composer Mount, including image paste.                                                                                                                                                           |
| `e2e/browser/*.pw.ts`                                | Desktop Safari          | Two readers in two browsers against a live worker: collaboration, invites, group management, reading position.                                                                                               |

```sh
bun run test:e2e:smoke # common signed-in PDF, EPUB, notes, highlights, settings, and upload paths
bun run test:e2e       # everything
```

Both commands boot the Vite/Cloudflare dev worker themselves. The WebKit projects need a terminal
attached to the GUI session; detached automation can still select the Desktop Chrome project and
set `PW_DETACHED_SESSION=1` as described in `docs/plans/effect-httpapi-foldkit-next-agent.md`.

Visual snapshots were taken against the React reader and were deleted with it. The markup contract
now lives in `src/tests/parity/signatures/`, which pins the rendered tree rather than its pixels.
