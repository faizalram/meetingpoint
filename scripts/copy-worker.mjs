// MapLibre runs map work in a web worker file. Bundlers can't find it inside node_modules,
// so we copy it to public/ after every install and point MapLibre at it (see MapView.tsx).
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
console.log("Copied maplibre-gl-worker.mjs to public/");
