# bookclub task runner
#
# Primary entrypoint:
#   just publish ["your commit message"]
# Runs: describe -> push to github -> deploy (bun) -> sync remote dev box.
#
# The individual steps are also runnable on their own (see below).

# --- config -----------------------------------------------------------------

# ssh alias / host of the remote dev box
remote := "exe"
# path to the repo checkout on the remote box
remote_dir := "~/dev/bookclub"
# hostname of the remote box (used to skip self-sync when running there)
remote_host := "byronland"

# default recipe: show the list
_default:
    @just --list

# --- the one command --------------------------------------------------------

# Describe latest work, push to GitHub, deploy with bun, and sync the remote box.
publish message="": (describe message) push deploy sync-remote
    @echo "Published, deployed, and synced the remote box"

# --- decomposed steps -------------------------------------------------------

# Set the description on the latest work (the working copy, or its parent if @ is empty).
describe message:
    #!/usr/bin/env bash
    set -euo pipefail
    rev=$(jj log --no-graph -r @ -T 'if(empty, "@-", "@")')
    message={{quote(message)}}
    if [ -z "$message" ]; then
        message=$(jj log --no-graph -r "$rev" -T 'description')
    fi
    if [ -z "$message" ]; then
        echo "error: no description provided and $rev has no description" >&2
        exit 1
    fi
    echo "Describing $rev"
    jj describe -r "$rev" -m "$message"

# Point the `main` bookmark at the latest work and push it to GitHub.
push:
    #!/usr/bin/env bash
    set -euo pipefail
    rev=$(jj log --no-graph -r @ -T 'if(empty, "@-", "@")')
    echo "Pushing $rev to main"
    jj bookmark set main -r "$rev"
    jj git push --bookmark main

# Build and deploy to Cloudflare (predeploy backup + vite build + wrangler deploy).
deploy:
    @echo "Deploying with bun"
    WRANGLER_LOG=error bun run deploy

# Sync the remote dev box: fetch + rebase onto latest main (skipped if run on the box).
sync-remote:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "$(hostname -s 2>/dev/null || hostname)" = "{{remote_host}}" ]; then
        echo "Already on the remote box; skipping self-sync"
        exit 0
    fi
    echo "Syncing remote box ({{remote}})"
    ssh {{remote}} 'fish -l -c "cd {{remote_dir}}; and jj git fetch; and jj rebase -d main@origin"'

# --- convenience -------------------------------------------------------------

# Pull latest into THIS checkout (handy on the remote box).
sync:
    jj git fetch
    jj rebase -d main@origin

# Show local vs origin bookmark state.
status:
    @jj log -r '@ | main | main@origin' --no-graph \
        -T 'change_id.shortest(8) ++ " " ++ commit_id.shortest(8) ++ if(empty, " (empty)", "") ++ " " ++ bookmarks ++ " | " ++ description.first_line() ++ "\n"'
