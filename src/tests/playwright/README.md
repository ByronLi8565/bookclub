# Playwright Visual Snapshots

Visual snapshots live next to the Playwright specs under `src/tests/playwright/*-snapshots`.

Run comparisons with:

```sh
npm run test:visual
```

When a human has approved an intentional UI change, regenerate the checked-in baselines with:

```sh
npm run test:visual:update
```

The visual test uses the existing reader harness and bundled fixture assets, so it does not depend on auth, the worker, or external network state.
