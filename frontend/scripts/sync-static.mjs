import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const outDir = path.join(frontendDir, "out");
const targetDir = path.resolve(
  frontendDir,
  "..",
  "backend",
  "src",
  "draftboard",
  "static"
);

if (!fs.existsSync(path.join(outDir, "index.html"))) {
  console.error("frontend/out/index.html not found. Run `next build` first.");
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(outDir, targetDir, { recursive: true });
console.log(`Synced frontend static bundle -> ${targetDir}`);
