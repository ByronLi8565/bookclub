import { Runtime } from "foldkit";
import { makeBookclubApplication } from "./application.ts";
import { applyTheme } from "../logic/theme.ts";
import { registerNoteImageElement } from "../logic/notes/noteImageElement.ts";
import { cachedUserPrefs } from "./settings.ts";
import "../index.css";

applyTheme(cachedUserPrefs().appearance);
// Posted notes render <note-image> too, so it must be defined before the first
// view: a tag rendered undefined keeps the properties written onto it, which
// then shadow the element's own accessors once it is defined.
registerNoteImageElement();
Runtime.run(makeBookclubApplication(document.getElementById("root")!));
