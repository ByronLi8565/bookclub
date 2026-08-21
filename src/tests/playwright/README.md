# Browser suites

| Suite                                                | Runs on                 | Covers                                                                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `foldkitApp.pw.ts`                                   | Desktop Chrome          | The whole journey against a live worker: sign in by code and by password, sign out, the club list, a club opening onto its book, deep links and the back button, the split divider, and each header overlay. |
| `foldkitReader.pw.ts`, `foldkitReaderGestures.pw.ts` | Desktop / Mobile Safari | The reader slice alone, through its own harness — no account, no worker.                                                                                                                                     |
| `foldkitComposer.pw.ts`                              | Desktop Safari          | The Lexical composer Mount, including image paste.                                                                                                                                                           |
| `e2e/browser/*.pw.ts`                                | Desktop Safari          | Two readers in two browsers against a live worker: collaboration, invites, group management, reading position.                                                                                               |

```sh
bun run test:e2e                              # everything
PW_DETACHED_SESSION=1 bunx playwright test --project="Desktop Chrome"
```

The WebKit projects need a terminal attached to the GUI session; see "Running the browser suite" in
`docs/plans/effect-httpapi-foldkit-next-agent.md` for why, and for the Chromium flag that makes the
detached case work at all.

Visual snapshots were taken against the React reader and were deleted with it. The markup contract
now lives in `src/tests/parity/signatures/`, which pins the rendered tree rather than its pixels.
