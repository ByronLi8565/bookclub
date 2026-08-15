import { Runtime } from "foldkit";
import { makeBookclubApplication } from "./application.ts";
import "../index.css";

Runtime.run(makeBookclubApplication(document.getElementById("root")!));
