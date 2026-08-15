# Parity tests

These compare the Foldkit client against the React client it replaces, by
rendering both into jsdom and diffing what they produce. A failure prints the
two trees side by side, so it names the element that drifted.

The claim each test makes is: _this surface is the same interface in both
clients_. `domSignature.ts` defines what "the same" means — tag, classes, and
the attributes that change what a control is or how it is announced. Ids, keys,
inline styles, data hooks and values are a renderer's own business and are left
out.

## Adding a surface

```tsx
const react = await renderReact(<Thing {...props} />);
const foldkit = await renderFoldkit({ Model, model, view });
expectParity(react, foldkit);
```

React reaches most of its states by interaction where Foldkit reaches them by
Model, so `renderReact` takes an optional callback that drives the component
first — click the tab, type in the field — and both sides are then compared in
the same state.

Where the host composes a module's view (the account page inside the settings
modal, the invite controls inside the presence modal), render the _host's_
composition rather than the module alone. That is what ships.

## Deviations

A difference that is deliberate is written down at the call site, as a
`rewrite` that normalises both sides, with a comment saying why. There is one
today: React navigates by URL and so uses `<a href>`, where Foldkit's route
still lives in the Model and so uses `<button>`. When URL routing lands at
cutover, those rewrites should be deleted and the tests should still pass.

Anything not written down that way is a bug in one of the two clients.
