import type { Html, HtmlBuilder } from "foldkit/html";

export interface RadioMenuOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly title?: string;
}

export const radioMenuView = <Value extends string, Message>(
  h: HtmlBuilder<Message>,
  menu: {
    readonly value: Value;
    readonly options: readonly RadioMenuOption<Value>[];
    readonly open: boolean;
    readonly label: string;
    readonly onToggle: Message;
    readonly onSelect: (value: Value) => Message;
    readonly className?: string;
    readonly triggerClassName?: string;
    readonly disabled?: boolean;
  },
): Html =>
  h.div(
    [h.Class(`book-menu settings-dropdown${menu.className ? ` ${menu.className}` : ""}`)],
    [
      h.button(
        [
          h.Type("button"),
          h.Class(
            `settings-action settings-dropdown-trigger${menu.triggerClassName ? ` ${menu.triggerClassName}` : ""}`,
          ),
          h.AriaHasPopup("menu"),
          h.AriaExpanded(menu.open),
          h.AriaLabel(menu.label),
          h.Title(menu.label),
          ...(menu.disabled === undefined ? [] : [h.Disabled(menu.disabled)]),
          h.OnClick(menu.onToggle),
        ],
        [
          h.span(
            [],
            [menu.options.find((option) => option.value === menu.value)?.label ?? menu.value],
          ),
          h.span([h.Class("book-menu-arrow"), h.AriaHidden(true)], ["▾"]),
        ],
      ),
      ...(menu.open
        ? [
            h.ul(
              [h.Class("book-menu-list"), h.Role("menu")],
              menu.options.map((option) =>
                h.li(
                  [h.Key(option.value), h.Role("none")],
                  [
                    h.button(
                      [
                        h.Type("button"),
                        h.Role("menuitemradio"),
                        h.AriaChecked(option.value === menu.value),
                        h.Class(
                          option.value === menu.value
                            ? "book-menu-item is-active"
                            : "book-menu-item",
                        ),
                        h.Title(option.title ?? option.label),
                        h.OnClick(menu.onSelect(option.value)),
                      ],
                      [option.label],
                    ),
                  ],
                ),
              ),
            ),
          ]
        : []),
    ],
  );
