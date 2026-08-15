// @vitest-environment jsdom

import { Schema } from "effect";
import { Story } from "foldkit";
import { describe, expect, it } from "vitest";
import {
  DismissedErrorToast,
  FailedSession,
  FOLDKIT_RUNTIME_ID,
  LoadedSession,
  Model,
  init,
  makeBookclubApplication,
  update,
} from "../../client/foldkit/application.ts";

describe("Foldkit Bookclub boundary", () => {
  it("keeps serializable session, account, and error-toast transitions", () => {
    const [initial] = init();
    const user = { id: "user-1", email: "reader@example.com", name: "Reader" };

    Story.story(
      update,
      Story.given(initial),
      Story.message(LoadedSession({ user })),
      Story.model((model) => {
        expect(model.session._tag).toBe("AuthenticatedSession");
        expect(model.account._tag).toBe("ReadyAccount");
        expect(Schema.decodeUnknownSync(Model)(JSON.parse(JSON.stringify(model)))).toEqual(model);
      }),
      Story.message(FailedSession({ message: "offline" })),
      Story.model((model) => expect(model.errorToast).toEqual({ message: "offline" })),
      Story.message(DismissedErrorToast()),
      Story.model((model) => expect(model.errorToast).toBeNull()),
    );

    const container = document.createElement("div");
    expect(makeBookclubApplication(container).runtimeId).toBe(FOLDKIT_RUNTIME_ID);
  });
});
