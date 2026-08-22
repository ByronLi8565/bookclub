# Parity tests

These hold the Foldkit client to the interface the React client rendered, by
rendering it into jsdom and diffing against a signature recorded from React on
the day it was deleted. A failure prints the two trees side by side, so it names
the element that drifted.

The claim each test makes is: _this surface still is the interface React
shipped_ — or, once a signature has been deliberately re-recorded, the interface
we chose instead. `domSignature.ts` defines what "the same" means — tag, classes, and
the attributes that change what a control is or how it is announced. Ids, keys,
inline styles, data hooks and values are a renderer's own business and are left
out.

## Adding a surface

```ts
const foldkit = await renderFoldkit({ Model, model, view });
expectRecordedParity("thing-in-some-state", foldkit);
```

Foldkit reaches a state by Model rather than by interaction, so a surface is
named for the state it is in — `notes-composing`, `login-code-step` — and each
name owns one file under `signatures/`.

Where the host composes a module's view (the account page inside the settings
modal, the invite controls inside the presence modal), render the _host's_
composition rather than the module alone. That is what ships.

## Changing a surface on purpose

React is gone, so a signature can only be moved deliberately:

```sh
RECORD_PARITY=1 bun run test src/tests/parity
```

That rewrites every signature from what Foldkit renders now. It blesses whatever
is on screen, so the review is the diff of `signatures/` — read it before
committing, and never reach for it to turn a red test green. A signature file
changing is the interface changing.

The general and PDF settings pages have no recorded surface yet; a change to one
of those is not covered here.
