import { Runtime } from "foldkit";
import {
  NotesModel,
  initialNotesModel,
  notesView,
  updateNotes,
  type NotesMessage,
} from "../../client/foldkit/notes.ts";
import "../../client/index.css";

// The Foldkit note composer against a real Lexical editor, so the image
// widget's chrome — a pointer drag on the resize handle, the remove button —
// can be driven in a real engine. Commands are dropped: the harness has no
// worker to upload to, and everything under test is editor-side.
const params = new URLSearchParams(window.location.search);
const imageId = params.get("image") ?? "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const groupRef = "harness";

const initial: NotesModel = {
  ...initialNotesModel(),
  ready: true,
  status: "online",
  draft: `a note\n\n[[image:${imageId}]]`,
  groupRef,
};

const container = document.getElementById("foldkit-composer-harness")!;

Runtime.embed(
  Runtime.makeElement<NotesModel, NotesMessage>({
    Model: NotesModel,
    container,
    init: () => [initial, []],
    update: (model, message) => [updateNotes(model, message)[0], []],
    view: (model, h) =>
      h.div(
        [h.Class("app")],
        [
          notesView(model, { sourceId: "source-1", groupRef }, h),
          // The draft as the Model holds it, so a test can see what an edit in
          // the editor actually wrote.
          h.pre([h.DataAttribute("draft", "true")], [model.draft]),
        ],
      ),
    devTools: false,
    slow: false,
  }),
);
