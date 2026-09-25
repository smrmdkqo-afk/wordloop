import { mkdir, cp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of [
  "index.html",
  "styles.css",
  "src",
  "assets",
  "data",
  "manifest.webmanifest",
])
  await cp(file, "dist/" + file, { recursive: true });
await writeFile("dist/.nojekyll", "");
async function walk(dir) {
  let out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + d.name;
    if (d.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const paths = (await walk("dist")).sort();
const hash = createHash("sha256");
for (const p of paths) hash.update(await readFile(p));
const version = hash.digest("hex").slice(0, 14);
const sw = await readFile("sw.js", "utf8");
await writeFile(
  "dist/sw.js",
  sw
    .replace("DEV-CACHE", version)
    .replace(
      /\/\* PRECACHE \*\/\s*\[[\s\S]*?\]/,
      JSON.stringify(paths.map((p) => "./" + p.slice(5))),
    ),
);
console.log(`Built dist with offline cache ${version}`);
