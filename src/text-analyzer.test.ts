import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeBatch,
  analyzeText,
  detectLanguages,
  evaluateThreat,
  getDictionaryStore,
  getNormalizer,
  parseDictionaryFile,
  REPORT_CATEGORIES,
  ReportCategory,
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
    // 1. Direct evaluateThreat test: neutral context term without weapon/violence
    const neutralSampleMatches = [
      {
        term: "neutral_sample",
        concept: "context.general",
        sourceFile: "en.json",
        normalizedTerm: "neutral_sample",
        tokenStart: 0,
        tokenEnd: 1,
      },
    ];
    const legacyEval = evaluateThreat(neutralSampleMatches, "dictionary_only");
    expect(legacyEval.matched).toBe(true); // Legacy mode matches any dictionary word

    const filteredEval = evaluateThreat(neutralSampleMatches, "category_filter");
    expect(filteredEval.matched).toBe(false); // Filtered mode ignores neutral terms!

    const neutralContext = "peaceful diplomatic meeting between nations";
    const neutralRes = analyzeText(neutralContext, "en", { mode: "dictionary_only" });
    expect(neutralRes.matched).toBe(false);

    // 2. Violent context with weapons
    const violentGas = "I will attack the building with rockets and bombs";
    const violentFiltered = analyzeText(violentGas, "en", { mode: "category_filter" });
    expect(violentFiltered.matched).toBe(true); // Flagged because combined with weapon/violence!

    // 3. Smart mode with risk scoring
    const smartRes = analyzeText(violentGas, "en", { mode: "smart" });
    expect(smartRes.matched).toBe(true);
    expect(smartRes.evaluation?.riskScore).toBeGreaterThanOrEqual(40);
    expect(smartRes.evaluation?.riskLevel).toBe("critical");

    // 4. Calling WITHOUT specifying language (auto-detection + options directly as 2nd arg)
    const noLangOptions = analyzeText(neutralContext, { mode: "category_filter" });
    expect(noLangOptions.languages).toContain("en");
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

    const optionFilterBool = analyzeText(neutralContext, { filter: true });
    expect(optionFilterBool.matched).toBe(false);
    expect(optionFilterBool.evaluation?.mode).toBe("category_filter");

    const batchBool = analyzeBatch(["I will kill you with a bomb 💣", neutralContext], true);
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

    // Long peaceful article that happens to mention an isolated non-violent word
    const longPeacefulArticle =
      "The university lecture on astronomy discussed the stars, planets, and galaxies. ".repeat(15) +
      " The speaker briefly mentioned the political campaign of bds during discussion.";
    const longRes = analyzeText(longPeacefulArticle, { mode: ThreatMode.Smart });
    expect(longRes.evaluation?.wordCount).toBeGreaterThan(120);
    expect(longRes.matched).toBe(false); // Dampened! Doesn't flag whole article as a terror threat!
    expect(
      longRes.evaluation?.flaggedReasons.some((r) =>
        r.includes("Long text sparsity dampening applied"),
      ),
    ).toBe(true);
  });

  it("handles character repetition evasion without corrupting double-letter words like killer", () => {
    // 1. Double-letter word 'killer' must remain 'killer' and NOT become 'kiler'
    const killerRes = analyzeText("the serial killer was arrested", "en");
    expect(killerRes.matched).toBe(true);
    expect(killerRes.terms).toContain("killer");
    expect(killerRes.terms).not.toContain("kiler");

    // 2. Character repetition with 3+ identical letters (e.g. shoooooot riiiifles, kiiiill)
    const repeatedRes = analyzeText("We will shoooooot everyone with riiiifles and kiiiill them", "en");
    expect(repeatedRes.matched).toBe(true);
    expect(repeatedRes.terms).toContain("shoot");
    expect(repeatedRes.terms).toContain("rifles");
    expect(repeatedRes.terms).toContain("kill");

    // 3. Hebrew dotted acronyms and letter spacing (ק.ל.א.ש and נ..ר..צ..ח)
    const hebrewDottedRes = analyzeText("אנחנו נ..ר..צ..ח את כולכם עם ק.ל.א.ש", "he");
    expect(hebrewDottedRes.matched).toBe(true);
    expect(hebrewDottedRes.terms).toContain("נרצח");
    expect(hebrewDottedRes.terms).toContain("קלאש");
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

  it("prevents false alarms on everyday innocent sentences across English, Hebrew, Arabic, and Farsi", () => {
    // 1. English: words like club, scissors, laptop, driving, shoes, entity, kitchen, machine, main, happy, etc.
    const innocentEn = [
      "Welcome to the chess club meeting",
      "I am driving my car to the office",
      "I bought a new pair of shoes at the mall",
      "My laptop is on the wooden table",
      "We traveled across the country by railway",
      "Let us know what you think about this proposal",
      "Join our team for lunch tomorrow",
      "This is a legal business entity",
      "Please pass me the scissors for cutting paper",
      "I ate a banana and an apple for breakfast",
      "Let us schedule a conference call tomorrow morning",
      "Happy birthday to you!",
      "I am cooking dinner in the kitchen",
      "We are training a machine learning model",
      "Merge the changes into the main branch",
      "Our company mission is to provide great service",
      "Please wait a moment while the page loads",
      "Do it yourself tutorial",
      "He is listening to a popular song",
      "I applied for a new job position",
      "For example, you can use this function",
      "The students are studying for the final exam",
      "We believe in freedom of speech and expression",
      "Please send me an email with the details",
      "I drank a cup of hot coffee this morning",
      "She wants to teach English at the university",
      "We respect the rule of law in democracy",
      "The staff meeting starts at 10 AM",
      "What is the total score of the game?",
      "The water surface was calm and still",
      "Never mind, we can do it tomorrow",
      "Nothing is wrong with the code",
      "He works as a real estate agent",
      "My left shoulder hurts after exercising",
      "We signed a business contract yesterday",
      "Take accountability for your decisions",
      "A pedestrian was crossing the street",
      "Node.js garbage collection cleans up memory",
      "Please remove the file from the directory",
      "Doctors treated his ear infection"
    ];
    for (const s of innocentEn) {
      const res = analyzeText(s, "en");
      expect(res.matched).toBe(false);
      expect(res.terms).toHaveLength(0);
    }

    // 2. Hebrew: words like שאלה, מפתח, בירה, שנקל, בנקל, מטבח, יהלום, שירה, צרור, סופה, הטבח, וכו'
    const innocentHe = [
      "יש לי שאלה קטנה לגבי הפרויקט",
      "אני מפתח תוכנה בחברה בינלאומית",
      "בוא נשתה בירה בפאב הערב",
      "שילמתי שנקל על המסטיק בקיוסק",
      "הוא עבר את המבחן בנקל בלי בעיה",
      "אני במטבח מכין ארוחת ערב",
      "קניתי טבעת יהלום יפה",
      "שירה היא חברה טובה שלי",
      "יש לו צרור מפתחות בכיס",
      "סופה חזקה מתקרבת לאזור הצפון",
      "המהנדס בדק את התוכניות של הדירה",
      "אין לו שום כוונת רווח בפרויקט הזה",
      "הילדים משחקים כדורגל בפארק",
      "היא קוראת ספר מעניין בסלון",
      "אנחנו נוסעים ברכבת לתל אביב",
      "קניתי אוטו חדש אתמול",
      "יש פקק תנועה גדול בכביש",
      "שלחתי לך הודעה ומייל עם הפרטים",
      "מזל טוב ליום ההולדת שלך",
      "אני שותה כוס מים קרים",
      "סיימתי את הפרויקט בהצלחה",
      "צריך לקחת אחריות על ההחלטות",
      "חתמנו על חוזה עסקי חדש",
      "הכתף שלי כואבת אחרי אימון",
      "החוק במדינה שומר על האזרחים"
    ];
    for (const s of innocentHe) {
      const res = analyzeText(s, "he");
      expect(res.matched).toBe(false);
      expect(res.terms).toHaveLength(0);
    }

    // 3. Arabic: words like أراك, أبيض, إنسانية, إليك, الأسرة, الطائرة, إبرة, مقص, ألماس, على الإطلاق, أطلقت, فتح, رد, فرد
    const innocentAr = [
      "أنا أراك غداً إن شاء الله في المساء",
      "اشتريت قميصاً أبيض وحذاء جديداً",
      "قدمت المنظمة مساعدات إنسانية وإمدادات غذائية",
      "تفضل هذا الكتاب المفيد إليك",
      "الأطفال يلعبون في حديقة المنزل مع الأسرة",
      "سافرت بالطائرة إلى مدينة دبي لحضور المؤتمر",
      "ركبت السفينة في رحلة بحرية ممتعة",
      "استخدمت إبرة الخياطة لإصلاح الثوب",
      "قصصت الورقة بالمقص في المكتب",
      "استخدمت المفك والشاكوش لتثبيت الرف",
      "اشتريت خاتم ألماس جميل لزوجتي",
      "هذا ليس صحيحاً على الإطلاق",
      "أطلقت الشركة موقعاً إلكترونياً جديداً",
      "عاش أجدادي في وادي جميل بجانب الجبل",
      "رأيت قوس قزح في السماء بعد نزول المطر",
      "أطعمنا الكلب في الحديقة",
      "شاهدنا النمر في حديقة الحيوان",
      "اشتريت جزمة مريحة للمشي",
      "فتح الولد الباب",
      "هو رد على الهاتف",
      "كل فرد في المجتمع له دور",
      "رصد النجوم في السماء",
      "عبد الله طالب مجتهد",
      "رش الماء على النباتات في الصباح",
      "رأسي يؤلمني قليلا اليوم",
      "أنا أطبخ العشاء في المطبخ",
      "الطلاب يدرسون للاختبار النهائي غدا",
      "وقعنا عقدا تجاريا جديدا",
      "كتفي يؤلمني بعد ممارسة التمارين الرياضية",
      "القانون يحمي جميع المواطنين"
    ];
    for (const s of innocentAr) {
      const res = analyzeText(s, "ar");
      expect(res.matched).toBe(false);
      expect(res.terms).toHaveLength(0);
    }

    // 4. Farsi: words like می‌کنم, می‌کنند, هواپیما, قدم زدیم, بیمار, قیچی, چکش, الماس, سگ, سطل زباله, زدن, کاخ, آرش, صمد, دار, نفت
    const innocentFa = [
      "سلام صبح بخیر حال شما چطوره",
      "من در یک شرکت نرم‌افزاری به عنوان برنامه‌نویس کار می‌کنم",
      "بچه‌ها در حیاط خانه با هم بازی می‌کنند",
      "من با هواپیما به شهر مشهد سفر کردم",
      "من با دوستم در پارک قدم زدیم و صحبت کردیم",
      "خیاط با نخ و سوزن لباس را دوخت",
      "با قیچی کاغذ را به دو نیم بریدم",
      "با چکش میخ را به دیوار زدم",
      "یک حلقه الماس زیبا برای همسرم خریدم",
      "سگ باوفا در باغ کنار درخت خوابیده بود",
      "پلنگ در جنگل‌های دور زندگی می‌کند",
      "پزشک به بیمار یک نسخه دارو داد",
      "او در بیمارستان بستری است",
      "آشغال‌ها را در سطل زباله ریختم",
      "لبخند زده و خوشحال بود",
      "ماه تیر فصل تابستان است",
      "کاخ گلستان در تهران بسیار دیدنی است",
      "آرش یک مهندس نرم‌افزار است",
      "صمد در دانشگاه درس می‌خواند",
      "ایران دارای منابع نفت و گاز است",
      "مادرم قالی را روی دار بافت",
      "من در آشپزخانه شام درست می‌کنم",
      "دانش‌آموزان برای امتحان نهایی فردا درس می‌خوانند",
      "ما دیروز یک قرارداد تجاری جدید امضا کردیم",
      "شانه‌ام بعد از تمرین ورزشی درد می‌کند",
      "قانون از حقوق همه شهروندان دفاع می‌کند"
    ];
    for (const s of innocentFa) {
      const res = analyzeText(s, "fa");
      expect(res.matched).toBe(false);
      expect(res.terms).toHaveLength(0);
    }
  });

  it("does not reach dictionary terms by stripping affixes off everyday words", () => {
    const innocent: [string, string][] = [
      ["he", "בוא נשתה בירה ונדבר על השמירה מחר"],
      ["he", "יש כמות גדולה של שמות ברשימה"],
      ["he", "אני מכין ארוחה במטבח"],
      ["he", "השירים של שירה מושמעים בשירות הלקוחות"],
      ["he", "הרוסים הגיעו בקרב התיירים לפני כמה דקות"],
      ["he", "רוצים להטיל מס חדש"],
      ["en", "I was lying on the couch"],
      ["en", "She takes the train and closes the gates"],
      ["en", "The opera was falling apart"],
      ["en", "Leaves were falling in the park"],
      ["ar", "أرى البيانات على الشاشة"],
      ["ar", "اشتريت السمك من السوق"],
      ["ar", "حصلت على الجنسية الجديدة"],
      ["ar", "صليت الفجر في المسجد"],
      ["fa", "میگه بریم بازار"],
      ["fa", "باید این کتاب رو بخونم"],
      ["fa", "مهاجرت به کانادا سخت است"],
    ];
    for (const [lang, s] of innocent) {
      const res = analyzeText(s, lang);
      expect(res.terms, `${lang}: ${s}`).toHaveLength(0);
    }
  });

  it("still matches real inflected threat words after affix-stripping limits", () => {
    const cases: [string, string, string][] = [
      ["he", "המחבל ירה בהם מטווח קצר", "ירה"],
      ["he", "וירו על האוטובוס", "ירו"],
      ["he", "בטבח בבארי נרצחו רבים", "טבח"],
      ["he", "מחבלים חדרו עם מצנחי רחיפה", "מצנחי רחיפה"],
      ["he", "אנחנו עוקבים אחריכם, עוד תשלמו על זה", "עוד תשלמו על זה"],
      ["en", "they were stabbing people", "stab"],
      ["en", "a truck rammed the crowd", "ram"],
      ["en", "he was killing everyone", "kill"],
      ["en", "the smallhat globalists", "smallhat"],
      ["ar", "سأقتلكم جميعا", "اقتل"],
      ["fa", "بکشمت", "بکشم"],
    ];
    for (const [lang, s, expected] of cases) {
      const res = analyzeText(s, lang);
      expect(res.matched, `${lang}: ${s}`).toBe(true);
      expect(
        res.matches.some((m) => m.term === expected || m.normalizedTerm === expected),
        `${lang}: ${s} -> ${JSON.stringify(res.terms)}`,
      ).toBe(true);
    }
  });

  it("passes mentions of Jews and Israel on as targets without scoring them as threats", () => {
    const mentions: [string, string][] = [
      ["en", "I love Israel and Israeli culture"],
      ["en", "We visited an ancient synagogue in Prague"],
      ["ar", "زرت إسرائيل الصيف الماضي"],
      ["fa", "خبرهای امروز درباره اسرائیل"],
    ];
    for (const [lang, s] of mentions) {
      // dictionary_only (the pipeline default) forwards them to the downstream model...
      const res = analyzeText(s, lang);
      expect(res.matched, `${lang}: ${s}`).toBe(true);
      expect(res.matches.every((m) => m.concept?.startsWith("target.")), `${lang}: ${s}`).toBe(true);
      // ...but a target alone is not a threat in the scoring modes
      expect(analyzeText(s, lang, { mode: ThreatMode.Smart }).matched, `${lang}: ${s}`).toBe(false);
      expect(analyzeText(s, lang, { mode: ThreatMode.CategoryFilter }).matched, `${lang}: ${s}`).toBe(false);
    }

    const threat = analyzeText("We will bomb the synagogue", "en", { mode: ThreatMode.Smart });
    expect(threat.matched).toBe(true);
    expect(threat.evaluation?.threatCategories).toContain("target.jewish");
  });

  it("assigns every dictionary entry one of the report categories", () => {
    for (const lang of ["he", "en", "ar", "fa", "emoji"]) {
      const raw = JSON.parse(readFileSync(`dictionaries/${lang}.json`, "utf8")) as {
        entries: { term: string; category?: string }[];
      };
      const missing = raw.entries.filter((e) => !REPORT_CATEGORIES.includes(e.category ?? ""));
      expect(missing.map((e) => e.term), lang).toEqual([]);
    }
    expect(() =>
      parseDictionaryFile({ language: "en", entries: [{ term: "x", category: "news" }] }, "bad.json"),
    ).toThrow(/category must be one of/);
  });

  it("reports the categories of matched terms in text order", () => {
    const cases: [string, string, string[]][] = [
      ["he", "צבע אדום בעוטף, נפילות בשטח פתוח", [ReportCategory.RocketsAerial]],
      ["he", "מחבל ביצע פיגוע דקירה", [ReportCategory.Terror]],
      ["he", "הפרות סדר ויידוי אבנים בצומת", [ReportCategory.Riots]],
      ["he", "אירוע רב נפגעים לאחר קריסת מבנה", [ReportCategory.CivilEmergency]],
      ["en", "riots and looting after the rocket barrage", [ReportCategory.Riots, ReportCategory.RocketsAerial]],
      ["ar", "صفارات الإنذار بعد إطلاق صواريخ", [ReportCategory.RocketsAerial]],
      ["fa", "آتش‌سوزی بزرگ و ریزش ساختمان", [ReportCategory.CivilEmergency]],
    ];
    for (const [lang, s, expected] of cases) {
      const res = analyzeText(s, lang);
      // a text can carry several categories; the expected ones must appear in text order
      expect(res.categories.filter((c) => expected.includes(c)), `${lang}: ${s} -> ${res.categories}`).toEqual(expected);
    }
    expect(analyzeText("a quiet afternoon in the park", "en").categories).toEqual([]);
  });

  it("does not flag general profanity that carries no threat", () => {
    const profanity: [string, string][] = [
      ["en", "you are such an idiot, what a bitch"],
      ["he", "איזה אידיוט, חרא של סרט"],
      ["ar", "يا غبي يا حمار"],
      ["fa", "خفه شو احمق"],
    ];
    for (const [lang, s] of profanity) {
      const res = analyzeText(s, lang);
      expect(res.terms, `${lang}: ${s}`).toHaveLength(0);
    }
  });

  it("detects restraint and abduction tools across all supported languages", () => {
    // English: handcuffs, shackles, gag, tied with ropes
    const enRestraints = analyzeText("The kidnapper bound him in handcuffs and put a gag in his mouth", "en");
    expect(enRestraints.matched).toBe(true);
    expect(enRestraints.terms).toContain("handcuffs");
    expect(enRestraints.terms).toContain("gag");

    // Hebrew: אזיקים, כפתו, שלשלאות, מחסום פה
    const heRestraints1 = analyzeText("החוטפים כפתו אותו באזיקים וסתמו את פיו במחסום פה", "he");
    expect(heRestraints1.matched).toBe(true);
    expect(heRestraints1.terms.some(t => t.includes("אזיק") || t.includes("כפת") || t.includes("מחסום פה"))).toBe(true);

    const heRestraints2 = analyzeText("קשרו אותו בשלשלאות וכבלו את רגליו", "he");
    expect(heRestraints2.matched).toBe(true);
    expect(heRestraints2.terms.some(t => t.includes("שלשלאות"))).toBe(true);

    // Arabic: أصفاد, سلاسل, تكبيل
    const arRestraints1 = analyzeText("قيدوا الضحية بالأصفاد وكمموا فمه بالسلاسل", "ar");
    expect(arRestraints1.matched).toBe(true);
    expect(arRestraints1.terms.some(t => t.includes("أصفاد") || t.includes("اصفاد") || t.includes("سلاسل"))).toBe(true);

    const arRestraints2 = analyzeText("قاموا بتكبيل يديه ووضعوا عصابة على عينيه", "ar");
    expect(arRestraints2.matched).toBe(true);
    expect(arRestraints2.terms.some(t => t.includes("تكبيل"))).toBe(true);

    // Farsi: دستبند, طناب‌پیچ, غل و زنجیر, چشم‌بند
    const faRestraints1 = analyzeText("گروگان را با دستبند بستند و با طناب‌پیچ دهانش را بستند", "fa");
    expect(faRestraints1.matched).toBe(true);
    expect(faRestraints1.terms.some(t => t.includes("دستبند") || t.includes("طناب‌پیچ") || t.includes("گروگان"))).toBe(true);

    const faRestraints2 = analyzeText("دست و پای اسیر را با غل و زنجیر بستند و چشم‌بند زدند", "fa");
    expect(faRestraints2.matched).toBe(true);
    expect(faRestraints2.terms.some(t => t.includes("زنجیر") || t.includes("چشم‌بند") || t.includes("چشمبند") || t.includes("اسیر"))).toBe(true);
  });

  it("detects vehicle ramming attacks across all supported languages", () => {
    // English
    const enRamming1 = analyzeText("The terrorist carried out a vehicle ramming attack into the crowd", "en");
    expect(enRamming1.matched).toBe(true);
    expect(enRamming1.terms.some(t => t.includes("ramming"))).toBe(true);

    const enRamming2 = analyzeText("A truck rammed pedestrians at the bus stop", "en");
    expect(enRamming2.matched).toBe(true);
    expect(enRamming2.terms.some(t => t.includes("rammed") || t.includes("ram"))).toBe(true);

    // Hebrew: דריסה, דרס
    const heRamming1 = analyzeText("המחבל ביצע פיגוע דריסה עם משאית", "he");
    expect(heRamming1.matched).toBe(true);
    expect(heRamming1.terms.some(t => t.includes("דריסה"))).toBe(true);

    const heRamming2 = analyzeText("נהג דרס הולכי רגל בכוונה תחילה", "he");
    expect(heRamming2.matched).toBe(true);
    expect(heRamming2.terms.some(t => t.includes("דרס"))).toBe(true);

    // Arabic: دهس, عملية دهس
    const arRamming = analyzeText("قام الإرهابي بعملية دهس للمشاة بالشاحنة", "ar");
    expect(arRamming.matched).toBe(true);
    expect(arRamming.terms.some(t => t.includes("دهس"))).toBe(true);

    // Farsi: زیر گرفتن
    const faRamming = analyzeText("تروریست با خودرو اقدام به زیر گرفتن عابران پیاده کرد", "fa");
    expect(faRamming.matched).toBe(true);
    expect(faRamming.terms.some(t => t.includes("زیر گرفتن") || t.includes("زير گرفتن"))).toBe(true);
  });

  it("detects weapons, shootings, bombings, and terror attacks across all supported languages", () => {
    // English
    const enThreat = analyzeText("He drew a combat knife and stabbed multiple victims", "en");
    expect(enThreat.matched).toBe(true);
    expect(enThreat.terms.some(t => t.includes("knife") || t.includes("stabbed"))).toBe(true);

    // Hebrew
    const heThreat1 = analyzeText("המחבל שלף סכין ודקר שלושה עוברי אורח", "he");
    expect(heThreat1.matched).toBe(true);
    expect(heThreat1.terms.some(t => t.includes("סכין") || t.includes("דקר") || t.includes("מחבל"))).toBe(true);

    const heThreat2 = analyzeText("ירי של רקטות ופצצות לעבר הישוב", "he");
    expect(heThreat2.matched).toBe(true);
    expect(heThreat2.terms.some(t => t.includes("ירי") || t.includes("רקטות") || t.includes("פצצות"))).toBe(true);

    const heThreat3 = analyzeText("מתכננים פיגוע התאבדות באוטובוס", "he");
    expect(heThreat3.matched).toBe(true);
    expect(heThreat3.terms.some(t => t.includes("פיגוע התאבדות") || t.includes("התאבדות"))).toBe(true);

    // Arabic
    const arThreat1 = analyzeText("استل سكيناً وطعن جنوداً في السوق", "ar");
    expect(arThreat1.matched).toBe(true);
    expect(arThreat1.terms.some(t => t.includes("طعن") || t.includes("سكينا"))).toBe(true);

    const arThreat2 = analyzeText("أطلق النار من رشاش كلاشنكوف على المارة", "ar");
    expect(arThreat2.matched).toBe(true);
    expect(arThreat2.terms.some(t => t.includes("أطلق النار") || t.includes("اطلق النار") || t.includes("رشاش") || t.includes("كلاشنكوف"))).toBe(true);

    const arThreat3 = analyzeText("تخطيط لتنفيذ عملية استشهادية وتفجير حزام ناسف", "ar");
    expect(arThreat3.matched).toBe(true);
    expect(arThreat3.terms.some(t => t.includes("استشهادية") || t.includes("تفجير") || t.includes("حزام ناسف"))).toBe(true);

    // Farsi
    const faThreat1 = analyzeText("او با چاقو و قمه به مردم حمله کرد و آن‌ها را زخمی نمود", "fa");
    expect(faThreat1.matched).toBe(true);
    expect(faThreat1.terms.some(t => t.includes("چاقو") || t.includes("قمه"))).toBe(true);

    const faThreat2 = analyzeText("شلیک گلوله با تفنگ کلاشنکوف به سوی سربازان", "fa");
    expect(faThreat2.matched).toBe(true);
    expect(faThreat2.terms.some(t => t.includes("کلاشنکوف") || t.includes("شلیک گلوله") || t.includes("تفنگ"))).toBe(true);

    const faThreat3 = analyzeText("بمب‌گذاری انتحاری در مرکز شهر و انفجار شدید", "fa");
    expect(faThreat3.matched).toBe(true);
    expect(faThreat3.terms.some(t => t.includes("بمب‌گذاری") || t.includes("انتحاری") || t.includes("انفجار"))).toBe(true);
  });

  it("verifies dictionary-only matching semantics and match metadata", () => {
    // In dictionary-only mode, matching is purely based on vocabulary present in dictionaries
    const res = analyzeText("The suspect carried a bomb into the station", "en", { mode: "dictionary_only" });
    expect(res.matched).toBe(true);
    expect(res.terms).toContain("bomb");

    const matchMeta = res.matches.find(m => m.term === "bomb");
    expect(matchMeta).toBeDefined();
    expect(matchMeta?.sourceFile).toBe("en.json");
    expect(matchMeta?.normalizedTerm).toBe("bomb");
    expect(matchMeta?.tokenStart).toBeGreaterThanOrEqual(0);
    expect(matchMeta?.tokenEnd).toBeGreaterThan(matchMeta?.tokenStart ?? 0);

    // Purely non-dictionary text returns clean empty results
    const nonDict = analyzeText("random neutral string of unrelated syllables", "en", { mode: "dictionary_only" });
    expect(nonDict.matched).toBe(false);
    expect(nonDict.terms).toHaveLength(0);
    expect(nonDict.matches).toHaveLength(0);
  });


  console.log("All tests passed successfully.");
});
