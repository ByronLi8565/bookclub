import type { Html, HtmlBuilder } from "foldkit/html";

/**
 * These feather icons used to be `<img src="...svg">`, but an `<img>` loads an
 * SVG as its own isolated document — `stroke="currentColor"` inside it
 * resolves against that document's own default color, never the host page's
 * `--color-text`, so the icon stayed black under every theme. Inlining the
 * markup (as `upload.ts`'s icon already did) lets it inherit like any other
 * element.
 */
const strokeIcon = <Message>(
  h: HtmlBuilder<Message>,
  strokeWidth: string,
  children: readonly Html[],
): Html =>
  h.svg(
    [
      h.Width("24"),
      h.Height("24"),
      h.ViewBox("0 0 24 24"),
      h.Fill("none"),
      h.Stroke("currentColor"),
      h.StrokeWidth(strokeWidth),
      h.StrokeLinecap("round"),
      h.StrokeLinejoin("round"),
      h.AriaHidden(true),
    ],
    children,
  );

export const settingsIconView = <Message>(h: HtmlBuilder<Message>): Html =>
  strokeIcon(h, "3", [
    h.circle([h.Cx("12"), h.Cy("12"), h.R("3")], []),
    h.path(
      [
        h.D(
          "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
        ),
      ],
      [],
    ),
  ]);

export const editIconView = <Message>(h: HtmlBuilder<Message>): Html =>
  strokeIcon(h, "3", [
    h.path([h.D("M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z")], []),
  ]);

export const toolIconView = <Message>(h: HtmlBuilder<Message>): Html =>
  strokeIcon(h, "2.3", [
    h.path(
      [
        h.D(
          "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
        ),
      ],
      [],
    ),
  ]);

export const trashIconView = <Message>(h: HtmlBuilder<Message>): Html =>
  strokeIcon(h, "2.3", [
    h.polyline([h.Points("3 6 5 6 21 6")], []),
    h.path(
      [h.D("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")],
      [],
    ),
    h.line([h.X1("10"), h.Y1("11"), h.X2("10"), h.Y2("17")], []),
    h.line([h.X1("14"), h.Y1("11"), h.X2("14"), h.Y2("17")], []),
  ]);
