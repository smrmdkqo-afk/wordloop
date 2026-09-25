import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const names = (await readdir("data"))
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .sort();
const files = [],
  senses = [];
for (const name of names) {
  const raw = await readFile("data/" + name);
  const pack = JSON.parse(raw);
  senses.push(...pack.senses);
  files.push({
    path: "data/" + name,
    sha256: createHash("sha256").update(raw).digest("hex"),
  });
}
const version =
  "1-" +
  createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 10);
await writeFile(
  "data/manifest.json",
  JSON.stringify(
    {
      schema: 1,
      version,
      words: new Set(senses.map((s) => s.word.toLowerCase())).size,
      senses: senses.length,
      examples: senses.reduce((n, s) => n + s.examples.length, 0),
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Catalog ${version}: ${new Set(senses.map((s) => s.word.toLowerCase())).size} words, ${senses.length} senses`,
);
