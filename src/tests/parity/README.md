# View signatures

These pin the client's rendered markup. Each test renders a view into jsdom and
diffs it against a signature under `signatures/`. A failure prints the two trees
side by side, so it names the element that drifted. `styles/` applies through
these class names and nothing else, so a tree that renders the right elements
with the wrong classes is bare markup to the user.

`domSignature.ts` defines what "the same" means: tag, classes, and the
attributes that change what a control is or how it is announced. Ids, keys,
inline styles, data hooks and values are a renderer's own business and are left
out.

## Adding a surface

```ts
const foldkit = await renderFoldkit({ Model, model, view });
expectRecordedParity("thing-in-some-state", foldkit);
```

A surface is reached by Model rather than by interaction, so it is named for the
state it is in (`notes-composing`, `login-code-step`) and each name owns one
file under `signatures/`.

Where the host composes a module's view (the account page inside the settings
modal, the invite controls inside the presence modal), render the _host's_
composition rather than the module alone. That is what ships.

## Changing a surface on purpose

```sh
RECORD_PARITY=1 bunx vitest run src/tests/parity
```

That rewrites every signature from what renders now. It blesses whatever is on
screen, so the review is the diff of `signatures/`. Read it before committing,
and never reach for it to turn a red test green. A signature file changing is
the interface changing.

The general and PDF settings pages have no recorded surface yet; a change to one
of those is not covered here.
