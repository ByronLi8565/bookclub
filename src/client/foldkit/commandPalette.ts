import { Effect, Option, Schema } from "effect";
import { Command, Mount, Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { modalView } from "./modal.ts";
import {
  CommandHistory,
  InvokedUserCommand,
  readCommandHistory,
  shortcutLabel,
  writeCommandHistory,
  type UserCommand,
} from "./userCommands.ts";

export const PaletteModel = Schema.Struct({
  query: Schema.String,
  selected: Schema.Number,
  history: CommandHistory,
});
export type PaletteModel = typeof PaletteModel.Type;
export const initialPaletteModel = (): PaletteModel => ({
  query: "",
  selected: 0,
  history: readCommandHistory(),
});

export const ToggledCommandPalette = m("ToggledCommandPalette");
export const ChangedCommandQuery = m("ChangedCommandQuery", { query: Schema.String });
export const MovedCommandSelection = m("MovedCommandSelection", { delta: Schema.Number });
export const SelectedPaletteCommand = m("SelectedPaletteCommand");
export const CompletedPaletteAction = m("CompletedPaletteAction");
export type PaletteMessage =
  | typeof ToggledCommandPalette.Type
  | typeof ChangedCommandQuery.Type
  | typeof MovedCommandSelection.Type
  | typeof SelectedPaletteCommand.Type
  | typeof CompletedPaletteAction.Type
  | typeof InvokedUserCommand.Type;

export const PersistCommandHistory = Command.define("PersistCommandHistory", {
  args: { history: CommandHistory },
  messages: [CompletedPaletteAction],
  execute: ({ history }) =>
    Effect.sync(() => writeCommandHistory(history)).pipe(Effect.as(CompletedPaletteAction())),
});

export const ScrollCommandSelection = Command.define("ScrollCommandSelection", {
  messages: [CompletedPaletteAction],
  execute: Effect.sync(() => {
    requestAnimationFrame(() => {
      document
        .querySelector('.command-palette [aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
  }).pipe(Effect.as(CompletedPaletteAction())),
});

const FocusCommandPalette = Mount.define(
  "FocusCommandPalette",
  CompletedPaletteAction,
)((element) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = document.activeElement;
      if (element instanceof HTMLInputElement) element.focus();
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        requestAnimationFrame(() => {
          if (document.activeElement !== document.body) return;
          const dialog = document.querySelector(".modal");
          if (dialog !== null) {
            const control =
              dialog.querySelector<HTMLElement>("input:not([disabled]), textarea") ??
              dialog.querySelector<HTMLElement>("button:not([disabled])");
            control?.focus();
          } else if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        });
      }),
  ).pipe(Effect.andThen(Effect.never)),
);

export const makePaletteSubscriptions = <Model>(isOpen: (model: Model) => boolean) =>
  Subscription.make<Model, PaletteMessage>()((entry) => ({
    commandPaletteKeyboard: entry(
      { open: Schema.Boolean },
      {
        modelToDependencies: (model) => ({ open: isOpen(model) }),
        keepAliveEquivalence: () => true,
        dependenciesToStream: (_, readDependencies) =>
          Subscription.fromEventFilterMap<KeyboardEvent, PaletteMessage>({
            target: globalThis.document,
            type: "keydown",
            options: { capture: true },
            toMessage: (event) => {
              if (event.isComposing || event.defaultPrevented) return Option.none();
              if (
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                event.key.toLowerCase() === "k"
              ) {
                event.preventDefault();
                return event.repeat ? Option.none() : Option.some(ToggledCommandPalette());
              }
              if (!readDependencies().open) return Option.none();
              if (event.key === "Tab") {
                const controls = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    '.command-palette button:not([tabindex="-1"]), .command-palette input',
                  ),
                );
                const current = controls.findIndex((control) => control === document.activeElement);
                controls[
                  (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
                ]?.focus();
                event.preventDefault();
                return Option.none();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                return Option.some(
                  MovedCommandSelection({ delta: event.key === "ArrowDown" ? 1 : -1 }),
                );
              }
              if (
                event.key === "Enter" &&
                document.activeElement?.matches(".command-palette input")
              ) {
                event.preventDefault();
                return Option.some(SelectedPaletteCommand());
              }
              return Option.none();
            },
          }),
      },
    ),
  }));

export const paletteView = <Message>(
  model: PaletteModel,
  commands: readonly UserCommand<Message>[],
  onClose: Message,
  libraryNotice: string | null,
  h: HtmlBuilder<Message | PaletteMessage>,
): Html => {
  const selected = Math.min(model.selected, Math.max(0, commands.length - 1));
  return modalView(
    {
      title: "Commands",
      ariaLabel: "Command palette",
      ariaModal: true,
      className: "command-palette",
      onClose,
    },
    h,
    [
      h.input([
        h.Class("command-palette-input"),
        h.Type("text"),
        h.Role("combobox"),
        h.AriaLabel("Search commands"),
        h.AriaExpanded(true),
        h.AriaAutocomplete("list"),
        h.AriaControls("command-palette-results"),
        ...(commands.length === 0 ? [] : [h.AriaActiveDescendant(`command-option-${selected}`)]),
        h.Autocomplete("off"),
        h.Spellcheck(false),
        h.Placeholder("Search commands, clubs, books…"),
        h.Value(model.query),
        h.OnInput((query) => ChangedCommandQuery({ query })),
        h.OnMount(FocusCommandPalette()),
      ]),
      h.div(
        [
          h.Id("command-palette-results"),
          h.Class("command-palette-results"),
          h.Role("listbox"),
          h.AriaLabel("Commands"),
        ],
        commands.map((command, index) =>
          h.button(
            [
              h.Key(command.id),
              h.Id(`command-option-${index}`),
              h.Type("button"),
              h.Class("command-palette-option"),
              h.Role("option"),
              h.Tabindex(-1),
              h.AriaSelected(index === selected),
              h.AriaLabel(command.title),
              h.AriaDescription(command.category),
              h.OnClick(InvokedUserCommand({ id: command.id })),
            ],
            [
              h.span([h.Class("command-palette-title")], [command.title]),
              h.span([h.Class("command-palette-category")], [command.category]),
              ...(command.binding === undefined
                ? []
                : [h.kbd([], [shortcutLabel(command.binding)])]),
            ],
          ),
        ),
      ),
      ...(commands.length === 0 || libraryNotice !== null
        ? [
            h.p(
              [h.Class("command-palette-empty"), h.Role("status")],
              [libraryNotice ?? "No matching commands"],
            ),
          ]
        : []),
      h.div([h.Class("command-palette-hint")], ["↑ ↓ navigate · Enter run · Esc close"]),
    ],
  );
};
