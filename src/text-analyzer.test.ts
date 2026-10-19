import assert from "node:assert/strict";
import { analyzeText, getDictionaryStore } from "./index.js";

const store = getDictionaryStore();
assert.ok(store.getIndex("en"), "English dictionary must load");
assert.ok(store.getIndex("ar"), "Arabic dictionary must load");
assert.ok(store.getIndex("fa"), "Farsi dictionary must load");

// 1. English tests
const english = analyzeText("I will KILL the jews with a bomb!!!", "en");
assert.equal(english.matched, true);
assert.ok(english.terms.includes("kill"));
assert.ok(english.terms.includes("bomb"));
assert.ok(english.terms.includes("i will kill the jews"));

const englishPlural = analyzeText("The attacks were planned", "en");
assert.equal(englishPlural.matched, true);
assert.ok(englishPlural.terms.includes("attacks") || englishPlural.terms.includes("attack"));

const boundary = analyzeText("This skill is useful", "en");
assert.equal(boundary.terms.includes("kill"), false);

const hyphen = analyzeText("That dirty-jew slur", "en");
assert.ok(hyphen.terms.includes("dirty-jew") || hyphen.terms.includes("dirty jew"));

const unknown = analyzeText("hello", "he");
assert.equal(unknown.matched, false);
assert.equal(unknown.issues[0]?.code, "NO_DICTIONARIES");

// 2. Arabic tests
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

// 3. Farsi tests
const farsiExact = analyzeText("یک تهدید وجود دارد", "fa");
assert.equal(farsiExact.matched, true, "Farsi exact match should succeed");
assert.ok(farsiExact.terms.includes("تهدید"));

const farsiZwnj = analyzeText("تهدید‌ها را جدی بگیرید", "fa");
assert.equal(farsiZwnj.matched, true, "Farsi ZWNJ plural should match base term");
assert.ok(farsiZwnj.terms.includes("تهدید") || farsiZwnj.terms.includes("تهدیدها"));

const farsiIndefinite = analyzeText("این پیام شامل تهدیدی جدی است", "fa");
assert.equal(farsiIndefinite.matched, true, "Farsi indefinite suffix (-i) should match base term");
assert.ok(farsiIndefinite.terms.includes("تهدید"));

const farsiPluralEzafe = analyzeText("این گزارش درباره تهدیدهای یک گروه است", "fa");
assert.equal(farsiPluralEzafe.matched, true, "Farsi plural+ezafe (-haye) should match base term");
assert.ok(farsiPluralEzafe.terms.includes("تهدید"));

const farsiArabicChars = analyzeText("يك تهديد صريح", "fa"); // Arabic kaf and yeh
assert.equal(farsiArabicChars.matched, true, "Farsi should normalize Arabic Kaf/Yeh");
assert.ok(farsiArabicChars.terms.includes("تهدید"));

const farsiLoanwordPlural = analyzeText("جلوگیری از حملات تروریستی", "fa");
assert.equal(farsiLoanwordPlural.matched, true, "Farsi -at plural should match base form");
assert.ok(
  farsiLoanwordPlural.terms.includes("حمله") ||
    farsiLoanwordPlural.terms.includes("تروریستی"),
);

console.log("ALL TESTS PASSED SUCCESSFULLY!");
console.log("Loaded languages:", store.languages());
console.log("Farsi indefinite matched terms:", farsiIndefinite.terms);
console.log("Farsi ZWNJ matched terms:", farsiZwnj.terms);
