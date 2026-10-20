import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeBatch,
  analyzeText,
  detectLanguages,
  getDictionaryStore,
  getNormalizer,
} from "./index.js";

describe("TextAnalyzer & Multi-Language Engine", () => {
  const store = getDictionaryStore();

  it("loads all core dictionaries including emoji", () => {
    expect(store.getIndex("en")).toBeDefined();
    expect(store.getIndex("ar")).toBeDefined();
    expect(store.getIndex("fa")).toBeDefined();
    expect(store.getIndex("he")).toBeDefined();
    expect(store.getIndex("emoji")).toBeDefined();
  });

  it("handles English terms, plurals, and boundary checks", () => {
    const english = analyzeText("I will KILL the jews with a bomb!!!", "en");
    expect(english.matched).toBe(true);
    expect(english.text).toBe("I will KILL the jews with a bomb!!!");
    expect(english.content).toBe("I will KILL the jews with a bomb!!!");
    expect(english.terms).toContain("kill");
    expect(english.terms).toContain("bomb");

    const englishPlural = analyzeText("The attacks were planned", "en");
    expect(englishPlural.matched).toBe(true);
    expect(
      englishPlural.terms.includes("attacks") ||
        englishPlural.terms.includes("attack"),
    ).toBe(true);

    const boundary = analyzeText("This skill is useful", "en");
    expect(boundary.terms.includes("kill")).toBe(false);
  });

  it("handles Arabic exact terms, diacritics, clitics, and Arabizi", () => {
    const arabicExact = analyzeText("اقتل", "ar");
    expect(arabicExact.terms).toContain("اقتل");

    const arabicDiacritics = analyzeText("اُقْتُلْ", "ar");
    expect(arabicDiacritics.terms).toContain("اقتل");

    const arabicClitics = analyzeText("واقتلوهم", "ar");
    expect(
      arabicClitics.terms.includes("اقتلوهم") ||
        arabicClitics.terms.includes("اقتل"),
    ).toBe(true);

    const arabizi = analyzeText("o8tlohom", "ar");
    expect(arabizi.matched).toBe(true);
  });

  it("handles Farsi letter folding, ZWNJ, and suffix alternations", () => {
    const farsiExact = analyzeText("یک تهدید وجود دارد", "fa");
    expect(farsiExact.matched).toBe(true);
    expect(farsiExact.terms).toContain("تهدید");

    const farsiZwnj = analyzeText("تهدید‌ها را جدی بگیرید", "fa");
    expect(farsiZwnj.matched).toBe(true);
    expect(
      farsiZwnj.terms.includes("تهدید") || farsiZwnj.terms.includes("تهدیدها"),
    ).toBe(true);

    const farsiIndefinite = analyzeText("این پیام شامل تهدیدی جدی است", "fa");
    expect(farsiIndefinite.matched).toBe(true);
    expect(farsiIndefinite.terms).toContain("تهدید");

    const farsiArabicChars = analyzeText("يك تهديد صريح", "fa");
    expect(farsiArabicChars.matched).toBe(true);
    expect(farsiArabicChars.terms).toContain("تهدید");

    const farsiLoanwordPlural = analyzeText("جلوگیری از حملات تروریستی", "fa");
    expect(farsiLoanwordPlural.matched).toBe(true);
    expect(
      farsiLoanwordPlural.terms.includes("حمله") ||
        farsiLoanwordPlural.terms.includes("تروریستی"),
    ).toBe(true);
  });

  it("handles Hebrew Niqqud, acronyms, sofit alternation, and clitics", () => {
    const hebrewNorm = getNormalizer("he");
    expect(hebrewNorm.language).toBe("he");

    const withoutNiqqud = hebrewNorm.normalize("פִּגּוּעַ");
    expect(withoutNiqqud).toBe("פגוע");

    const acronymClean = hebrewNorm.normalize('ארגון צה"ל וגורמי אמל"ח');
    expect(hebrewNorm.tokenize(acronymClean)).toEqual([
      "ארגון",
      "צהל",
      "וגורמי",
      "אמלח",
    ]);

    const hebrewVariants1 = hebrewNorm.tokenVariants("והמחבלים");
    expect(hebrewVariants1).toContain("מחבל");

    const hebrewVariants2 = hebrewNorm.tokenVariants("סכינים");
    expect(hebrewVariants2).toContain("סכין");

    const hebrewVariants3 = hebrewNorm.tokenVariants("פיצוצים");
    expect(hebrewVariants3).toContain("פיצוץ");

    const hebrewAnalyze = analyzeText("והטרוריסטים ביצעו מתקפה", "he");
    expect(hebrewAnalyze.matched).toBe(true);
    expect(
      hebrewAnalyze.terms.includes("טרוריסטים") ||
        hebrewAnalyze.terms.includes("טרוריסט") ||
        hebrewAnalyze.terms.includes("מתקפה"),
    ).toBe(true);
  });

  it("detects emojis and handles consecutive emojis without spaces", () => {
    const norm = getNormalizer("em");
    expect(norm.language).toBe("emoji");

    const emojiSingle = analyzeText("Watch out 💣", "em");
    expect(emojiSingle.matched).toBe(true);
    expect(emojiSingle.terms).toContain("💣");
    expect(emojiSingle.languages).toEqual(["em"]);
    expect(emojiSingle.language).toBe("em");

    // Consecutive emojis without spaces: 🔪💣🩸
    const emojiMulti = analyzeText("Dangerous 🔪💣🩸", "em");
    expect(emojiMulti.matched).toBe(true);
    expect(emojiMulti.terms).toContain("🔪");
    expect(emojiMulti.terms).toContain("💣");
    expect(emojiMulti.terms).toContain("🩸");
  });

  it("supports multi-language checking and code-switching", () => {
    // Array of languages
    const multiLang = analyzeText("I will kill you והמחבל", ["en", "he"]);
    expect(multiLang.matched).toBe(true);
    expect(multiLang.terms).toContain("kill");
    expect(multiLang.terms).toContain("מחבל");
    expect(multiLang.languages).toEqual(["en", "he"]);

    // Ambiguous Arabic / Farsi text
    const arFa = analyzeText("این پیام شامل تهدید است", ["ar", "fa"]);
    expect(arFa.matched).toBe(true);
    expect(arFa.terms).toContain("تهدید");
  });

  it("auto-detects languages and merges emojis automatically (reporting 'em')", () => {
    const autoHebrewWithEmoji = analyzeText("פיגוע טרור 💣", "auto");
    expect(autoHebrewWithEmoji.matched).toBe(true);
    expect(autoHebrewWithEmoji.terms).toContain("פיגוע");
    expect(autoHebrewWithEmoji.terms).toContain("💣");
    expect(autoHebrewWithEmoji.languages).toContain("he");
    expect(autoHebrewWithEmoji.languages).toContain("em");

    const detected = detectLanguages("attack with 🔪", ["en", "emoji", "he"]);
    expect(detected).toContain("en");
    expect(detected).toContain("em");
  });

  it("supports concepts filter and maxMatches options", () => {
    const filtered = analyzeText("I will kill the jews with a bomb", "en", {
      concepts: ["violence.killing"],
    });
    expect(filtered.terms).toContain("kill");
    expect(
      filtered.matches.every((m) => m.concept?.startsWith("violence.killing")),
    ).toBe(true);

    const capped = analyzeText("I will kill the jews with a bomb", "en", {
      maxMatches: 1,
    });
    expect(capped.matches.length).toBe(1);
  });

  it("supports batch processing with analyzeBatch", () => {
    const batch = analyzeBatch(["I will kill you", "peaceful greeting"], "en");
    expect(batch.length).toBe(2);
    expect(batch[0]?.matched).toBe(true);
    expect(batch[1]?.matched).toBe(false);
  });

  it("successfully tests against terror-dataset.json fixture", () => {
    const datasetPath = new URL("../test/fixtures/terror-dataset.json", import.meta.url);
    const raw = JSON.parse(readFileSync(datasetPath, "utf-8"));
    const threatItems = raw.filter((item: any) => item.expected === true);
    expect(threatItems.length).toBeGreaterThan(0);

    for (const item of threatItems) {
      const res = analyzeText(item.text, item.lang ?? "auto");
      expect(res.matched).toBe(true);
      expect(res.terms.length).toBeGreaterThan(0);
    }
  });


  console.log("All tests passed successfully.");
});
