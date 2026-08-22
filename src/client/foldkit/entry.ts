import { Runtime } from "foldkit";
import { makeBookclubApplication } from "./application.ts";
import { applyTheme } from "../logic/theme.ts";
import { cachedUserPrefs } from "./settings.ts";
import "../index.css";

applyTheme(cachedUserPrefs().appearance);
Runtime.run(makeBookclubApplication(document.getElementById("root")!));
