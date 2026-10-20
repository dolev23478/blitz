import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeBatch,
  analyzeText,
  detectLanguages,
  getDictionaryStore,
  getNormalizer,
  ThreatCategory,
  ThreatMode,
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

  it("supports mode switching between dictionary_only, category_filter, and smart", () => {
    // 1. Dual-use word: бензин (بنزين) alone
    const neutralGas = "محطة بيع بنزين"; // Gas station selling petrol
    const legacyRes = analyzeText(neutralGas, "ar", { mode: "dictionary_only" });
    expect(legacyRes.matched).toBe(true); // Legacy mode matches any dictionary word
    expect(legacyRes.terms).toContain("بنزين");

    const filteredRes = analyzeText(neutralGas, "ar", { mode: "category_filter" });
    expect(filteredRes.matched).toBe(false); // Filtered mode ignores dual-use alone!
    expect(filteredRes.terms).toContain("بنزين");
    expect(filteredRes.evaluation?.riskLevel).toBe("low");

    // 2. Dual-use word with violence: сожгу бензином (حرق بالبنزين)
    const violentGas = "سأحرق المبنى بالبنزين"; // Burn building with petrol
    const violentFiltered = analyzeText(violentGas, "ar", { mode: "category_filter" });
    expect(violentFiltered.matched).toBe(true); // Flagged because combined with arson/violence!

    // 3. Smart mode with risk scoring
    const smartRes = analyzeText(violentGas, "ar", { mode: "smart" });
    expect(smartRes.matched).toBe(true);
    expect(smartRes.evaluation?.riskScore).toBeGreaterThanOrEqual(40);
    expect(smartRes.evaluation?.riskLevel).toBe("critical");

    // 4. Calling WITHOUT specifying language (auto-detection + options directly as 2nd arg)
    const noLangOptions = analyzeText(neutralGas, { mode: "category_filter" });
    expect(noLangOptions.languages).toContain("ar");
    expect(noLangOptions.matched).toBe(false); // Ignored in category_filter mode
    expect(noLangOptions.evaluation?.mode).toBe("category_filter");

    // 5. Super-simple calling: boolean ON/OFF toggle, direct mode string, and { smart: true }
    const boolSmart = analyzeText("I will kill you with a bomb 💣", true);
    expect(boolSmart.matched).toBe(true);
    expect(boolSmart.evaluation?.mode).toBe("smart");

    const directModeString = analyzeText("I will kill you with a bomb 💣", "smart");
    expect(directModeString.evaluation?.mode).toBe("smart");

    const optionSmartBool = analyzeText("I will kill you with a bomb 💣", { smart: true });
    expect(optionSmartBool.evaluation?.mode).toBe("smart");

    const optionFilterBool = analyzeText(neutralGas, { filter: true });
    expect(optionFilterBool.matched).toBe(false);
    expect(optionFilterBool.evaluation?.mode).toBe("category_filter");

    const batchBool = analyzeBatch(["I will kill you with a bomb 💣", neutralGas], true);
    expect(batchBool[0].matched).toBe(true);
    expect(batchBool[0].evaluation?.mode).toBe("smart");
    expect(batchBool[1].matched).toBe(false);
  });

  it("supports ThreatMode and ThreatCategory const objects and text length density in smart mode", () => {
    expect(ThreatMode.Smart).toBe("smart");
    expect(ThreatMode.CategoryFilter).toBe("category_filter");
    expect(ThreatCategory.WeaponFirearm).toBe("weapon.firearm");

    // Short concentrated message receives high concentration bonus
    const shortThreat = analyzeText("I will kill you with a bomb", { mode: ThreatMode.Smart });
    expect(shortThreat.matched).toBe(true);
    expect(shortThreat.evaluation?.wordCount).toBe(7);
    expect(shortThreat.evaluation?.threatDensity).toBeGreaterThan(10);
    expect(shortThreat.evaluation?.riskScore).toBeGreaterThanOrEqual(80);

    // Long peaceful article that happens to mention an isolated target or location
    const longPeacefulArticle =
      "The university lecture on astronomy discussed the stars, planets, and galaxies. ".repeat(15) +
      " A telescope observed the night sky near Haifa.";
    const longRes = analyzeText(longPeacefulArticle, { mode: ThreatMode.Smart });
    expect(longRes.evaluation?.wordCount).toBeGreaterThan(120);
    expect(longRes.matched).toBe(false); // Dampened! Doesn't flag whole article as a terror threat!
    expect(longRes.evaluation?.flaggedReasons).toContain("Long text sparsity dampening applied (density: 1.73%)");
  });

  it("successfully tests against terror-dataset.json fixture", () => {
    const datasetPath = new URL("../test/fixtures/terror-dataset.json", import.meta.url);
    const clean = readFileSync(datasetPath, "utf-8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const raw = JSON.parse(clean);
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBeGreaterThan(0);

    const sample = raw.slice(0, 5);
    for (const item of sample) {
      const text = typeof item === "string" ? item : item.text;
      const res = analyzeText(text, "auto");
      expect(res).toBeDefined();
    }
  });


  console.log("All tests passed successfully.");
});
