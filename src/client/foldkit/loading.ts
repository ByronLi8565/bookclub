import type { Html, HtmlBuilder } from "foldkit/html";

/** React's `Loading`: the same `<output>`, so every `loading--*` modifier the
 *  stylesheets carry lands on the same element. */
export const loadingView = <Message>(
  h: HtmlBuilder<Message>,
  className?: string,
  progress?: number,
): Html =>
  h.output(
    [
      h.Class(className === undefined ? "loading" : `loading ${className}`),
      h.AriaLive("polite"),
      h.AriaLabel("Loading"),
    ],
    [
      h.span(
        [h.Class("loading-text")],
        [
          "LOADING",
          h.span(
            [h.Class("loading-dots"), h.AriaHidden(true)],
            [h.span([], ["."]), h.span([], ["."]), h.span([], ["."])],
          ),
        ],
      ),
      ...(progress === undefined
        ? []
        : [
            h.span(
              [h.Class("loading-progress"), h.AriaHidden(true)],
              [
                h.span([
                  h.Class("loading-progress-fill"),
                  h.Style({ width: `${Math.max(0, Math.min(100, progress))}%` }),
                ]),
              ],
            ),
          ]),
    ],
  );
