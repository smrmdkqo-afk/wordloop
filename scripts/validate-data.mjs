import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const names = (await readdir("data")).filter(
  (f) => f.endsWith(".json") && f !== "manifest.json",
);
const all = [];
for (const name of names) {
  const pack = JSON.parse(await readFile("data/" + name, "utf8"));
  assert.equal(pack.schema, 1, `${name}: schema`);
  all.push(...pack.senses);
}
const byId = new Map(all.map((s) => [s.id, s]));
assert.equal(byId.size, all.length, "Duplicate sense IDs");
for (const s of all) {
  const check = (v, msg) => assert(v, `${s.id}: ${msg}`);
  check(/^[a-z0-9][a-z0-9-]+$/.test(s.id), "invalid ID");
  check(/^[A-Za-z][A-Za-z '\-]*$/.test(s.word), "invalid word");
  check(
    ["beginner", "intermediate", "advanced"].includes(s.level),
    "invalid level",
  );
  check(
    ["noun", "verb", "adjective", "adverb", "other"].includes(s.pos),
    "invalid part of speech",
  );
  check(typeof s.ko === "string" && s.ko.trim(), "missing Korean hint");
  check(
    Array.isArray(s.definitions) &&
      s.definitions.length &&
      s.definitions.every((d) => typeof d === "string" && d.length > 5),
    "missing definition",
  );
  check(
    Array.isArray(s.examples) &&
      s.examples.length >= 2 &&
      s.examples.every(
        (e) => typeof e === "string" && e.split("{}").length === 2,
      ),
    "need two contextual examples with exactly one {} marker",
  );
  check(new Set(s.examples).size === s.examples.length, "duplicate examples");
  check(
    Array.isArray(s.distractors) &&
      new Set(s.distractors).size === s.distractors.length &&
      s.distractors.length >= 4,
    "need at least four distinct distractor candidates",
  );
  check(
    new Set(s.distractors.map((id) => byId.get(id)?.word)).size >= 4,
    "need four different distractor words",
  );
  for (const id of s.distractors) {
    const d = byId.get(id);
    check(d, "missing distractor " + id);
    check(d.id !== s.id && d.word !== s.word, "same word used as distractor");
    check(d.pos === s.pos, "distractor POS mismatch");
    check(
      !d.definitions.some((v) => s.definitions.includes(v)),
      "duplicate correct definition",
    );
  }
}
console.log(
  `Validated ${all.length} senses and ${all.reduce((n, s) => n + s.distractors.length, 0)} authored candidate links.`,
);
