import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Turbopack runs out of memory on the 6 MB obfuscated trial bundle, so the browser loads it as a static file.
const source = createRequire(import.meta.url).resolve("@bryntum/gantt/gantt.module.js");
const target = new URL("../public/bryntum/", import.meta.url);
mkdirSync(target, { recursive: true });
copyFileSync(source, new URL("gantt.module.js", target));
