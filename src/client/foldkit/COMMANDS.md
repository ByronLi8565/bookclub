# User commands

`foldkit/userCommands.ts` describes a user intention with a stable ID, a title,
search keywords, an optional keyboard binding, and the message it dispatches.
This is separate from a Foldkit `Command`, which runs an effect after `update`.

Providers own discovery for their domain. `applicationUserCommands` supplies
navigation, clubs, overlays, and workspace layout. `bookUserCommands` discovers
books across the user's club catalog. The reader, settings,
and notes modules supply their own actions. `discoverUserCommands` combines the
providers. The palette and keyboard shortcuts discover from that same registry;
there is no separately maintained palette list or shortcut table.

To add an action, return a `UserCommand` from its domain provider. Return it only
when the current model allows the action, including permissions and loading
state. Existing controls should dispatch `InvokedUserCommand({ id })`, or use the
host's `onCommand` callback. Invocation resolves the ID against the current
registry again, so stale controls cannot execute an unavailable action. Inputs
and form drafts continue to use their domain messages to collect parameters.

Keep IDs independent of displayed names. Club and book IDs include their stable
identities, so renaming a resource preserves its usage history. Usage is bounded
to 200 entries in browser local storage. Malformed or unavailable storage falls
back to an empty history. An empty query sorts by frequency and then recency;
typed queries prioritize relevance, with history breaking ties. Search ignores
case and accents and matches every typed word across titles and keywords.

The existing `/groups` response includes every accessible club's book metadata.
Sign-in loads it asynchronously and restores the per-user cache immediately;
opening the palette refreshes it without discarding the current results. Changes
to a loaded club also update that catalog and its cache. Each book displays and
matches its club name. Cross-club commands use the existing club URL with a `book`
query, so normal route loading establishes membership and opens the requested
book. Book contents are downloaded only when the reader opens them.

The shell renders overlays once, regardless of route. Command+K (also Ctrl+K)
opens the palette, arrows wrap through results, Enter invokes the selection,
and Escape or another Command+K returns to the previous overlay. Tab stays
inside the palette. Closing returns focus to the previous control when it is
still present and another dialog has not opened.

Browser journeys cover discovery, execution, focus, ranking after reload,
theming, permissions, and the existing reader shortcuts. Safari blocks
parent-installed keyboard handlers in script-disabled EPUB frames
([WebKit issue 218086](https://bugs.webkit.org/show_bug.cgi?id=218086)). Keep book
scripts disabled: Safari readers can use the shortcut with focus outside the
EPUB frame. The focused-frame shortcut is covered in Chromium.
