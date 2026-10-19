import assert from "node:assert/strict";
import { analyzeText, getDictionaryStore } from "./index.js";

const store = getDictionaryStore();
assert.ok(store.getIndex("en"), "English dictionary must load");
assert.ok(store.getIndex("ar"), "Arabic dictionary must load");
assert.equal(store.getIndex("fa"), undefined);

const emptyFa = store.issues.find((issue) => issue.fileName === "fa.json");
assert.ok(emptyFa, "empty fa.json should be reported");

const english = analyzeText("I will KILL the jews with a bomb!!!", "en");
assert.equal(english.matched, true);
assert.ok(english.terms.includes("kill"));
assert.ok(english.terms.includes("bomb"));
assert.ok(english.terms.includes("i will kill the jews"));

const boundary = analyzeText("This skill is useful", "en");
assert.equal(boundary.terms.includes("kill"), false);

const hyphen = analyzeText("That dirty-jew slur", "en");
assert.ok(hyphen.terms.includes("dirty-jew") || hyphen.terms.includes("dirty jew"));

const unknown = analyzeText("hello", "he");
assert.equal(unknown.matched, false);
assert.equal(unknown.issues[0]?.code, "NO_DICTIONARIES");

const arabicExact = analyzeText("اقتل", "ar");
assert.ok(arabicExact.terms.includes("اقتل"));

const arabicDiacritics = analyzeText("اُقْتُلْ", "ar");
assert.ok(arabicDiacritics.terms.includes("اقتل"));

const arabicClitics = analyzeText("واقتلوهم", "ar");
assert.ok(
  arabicClitics.terms.includes("اقتلوهم") ||
    arabicClitics.terms.includes("اقتل"),
);

const arabicArticle = analyzeText("القتل ممنوع", "ar");
assert.ok(arabicArticle.matched);

const arabizi = analyzeText("o8tlohom", "ar");
assert.ok(
  arabizi.matched,
  `expected Arabizi match, got terms=${arabizi.terms.join(",")}`,
);

console.log("self-check passed");
console.log("loaded languages:", store.languages());
console.log("load issues:", store.issues);
console.log("english terms:", english.terms.slice(0, 20));
console.log("arabic clitics terms:", arabicClitics.terms);
console.log("arabizi terms:", arabizi.terms);
