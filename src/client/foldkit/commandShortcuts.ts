import { Option, Schema } from "effect";
import { Subscription } from "foldkit";
import {
  CommandBinding,
  InvokedUserCommand,
  matchesCommandBinding,
  type CommandProvider,
} from "./userCommands.ts";

/** The registry owns shortcuts too, so adding an action never needs a second key table. */
export const makeCommandShortcutSubscriptions = <Model, Message>(
  discover: CommandProvider<Model, Message>,
  isActive: (model: Model) => boolean,
) =>
  Subscription.make<Model, typeof InvokedUserCommand.Type>()((entry) => ({
    userCommandShortcuts: entry(
      {
        active: Schema.Boolean,
        bindings: Schema.Array(Schema.Struct({ id: Schema.String, binding: CommandBinding })),
      },
      {
        modelToDependencies: (model) => ({
          active: isActive(model),
          bindings: discover(model).flatMap(({ id, binding }) =>
            binding === undefined ? [] : [{ id, binding }],
          ),
        }),
        // Keep the listener while reading current availability; async reader updates
        // must not create gaps during which a shortcut leaks to the browser.
        keepAliveEquivalence: () => true,
        dependenciesToStream: (_, readDependencies) =>
          Subscription.fromEventFilterMap<KeyboardEvent, typeof InvokedUserCommand.Type>({
            target: globalThis.document,
            type: "keydown",
            options: { capture: true },
            toMessage: (event) => {
              const { active, bindings } = readDependencies();
              if (!active) return Option.none();
              const command = bindings.find(({ binding }) => matchesCommandBinding(event, binding));
              if (command === undefined) return Option.none();
              event.preventDefault();
              return Option.some(InvokedUserCommand({ id: command.id }));
            },
          }),
      },
    ),
  }));
