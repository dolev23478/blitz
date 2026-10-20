import fs from "node:fs";
import path from "node:path";

interface CleanRule {
  lang: string;
  categoryName: string;
  terms: string[];
  reason: string;
}

const CLEANUP_RULES: CleanRule[] = [
  // 1. Dual-use fuels and materials (бензин, газ, дизель и др.)
  {
    lang: "ar.json",
    categoryName: "Топливо и бытовые газы (dual-use)",
    terms: [
      "بنزين", "البنزين", "وبنزين", "والبنزين", "بالبنزين", "للبنزين", "لالبنزين", "فالبنزين", "فبنزين", "كبنزين",
      "غاز", "الغاز", "وغاز", "والغاز", "بالغاز", "للغاز", "لغاز", "بغاز", "فالغاز", "فغاز", "كالغاز", "الغازات", "بالغازات", "والغازات", "للغازات", "كالغازات"
    ],
    reason: "Одиночные слова топлива/бытового газа, вызывавшие ложные тревоги на бытовые разговоры о заправке",
  },
  {
    lang: "fa.json",
    categoryName: "Топливо (dual-use)",
    terms: ["بنزين", "بنزین", "گاز"],
    reason: "Слово бензин/газ в фарси",
  },
  {
    lang: "he.json",
    categoryName: "Топливо (dual-use)",
    terms: ["בנזין", "הבנזין", "ובנזין", "והבנזין", "דלק", "הדלק", "ודלק", "סולר", "הסולר", "נפט"],
    reason: "Слова бензин, топливо, солярка на иврите",
  },
  {
    lang: "en.json",
    categoryName: "Топливо и сырье (dual-use)",
    terms: ["gasoline", "diesel", "petrol", "kerosene", "fuel", "truck"],
    reason: "Одиночные общеупотребительные слова топлива и грузовика",
  },

  // 2. Временные и календарные маркеры (дни, время, часы, сегодня)
  {
    lang: "fa.json",
    categoryName: "Календарные и временные маркеры",
    terms: [
      "امروز", "امشب", "فردا", "ساعت", "تاریخ", "تاريخ", "موعد", "سحر",
      "زمانبندي", "زمان‌بندي", "زمانبندی", "زمان‌بندی", "نيمهشب", "نيمه‌شب", "نیمهشب", "نیمه‌شب"
    ],
    reason: "Обычные слова времени: сегодня, завтра, час, дата, полночь",
  },

  // 3. Грамматические частицы, предлоги, союзы, обычные глаголы
  {
    lang: "ar.json",
    categoryName: "Грамматические частицы и бытовые слова",
    terms: [
      "إن", "ان", "تي",
      "جمع", "جهز", "حضر", "حاز", "شراء",
      "بقر", "جزر",
      "المحطة", "المحطه", "محطة", "محطه",
      "السوق", "سوق"
    ],
    reason: "Частицы (إن/ان = если/что), глаголы (купить, посетить, собрать), бытовые места (рынок, станция), животные/овощи (коровы, морковь)",
  },
  {
    lang: "he.json",
    categoryName: "Общеупотребительные слова и лица",
    terms: [
      "איש", "גבר", "אדם", // человек, мужчина
      "גמל", // верблюд
      "הרם", // поднять
      "בור", // яма
      "חדש" // новый
    ],
    reason: "Общие слова (человек, мужчина, поднять, новый, верблюд)",
  },
  {
    lang: "fa.json",
    categoryName: "Бытовые предметы и слова",
    terms: [
      "جشن", // праздник / торжество
      "آهن", "اهن", // железо
      "بیل", "بيل", // лопата
      "آجر", "اجر" // кирпич
    ],
    reason: "Обычные бытовые предметы и слова (железо, лопата, кирпич, праздник)",
  },

  // 4. Обычные английские слова и местоимения
  {
    lang: "en.json",
    categoryName: "Английские местоимения, ошибочные dogwhistles и чистые числа",
    terms: [
      "(((they)))", "(((them)))", "(((media)))", "(((echo)))", "(((bankers)))", "(((globalists)))",
      "18", "28", "45", "100", "105", "250", "300", "311", "318", "338", "357", "380", "450", "500", "504", "600", "700", "900", "1500", "2000",
      "1929", "1948", "1967", "1972"
    ],
    reason: "Местоимения (they/them), чистые числа и года, триггерившие ложные тревоги при нормализации",
  },
  {
    lang: "en.json",
    categoryName: "Одиночные общеупотребительные слова английского языка",
    terms: [
      "again", "actor", "agent", "agony", "alias", "alibi", "anger", "angry", "angle",
      "arm", "arms", "auto", "avoid", "bad", "bake", "baked", "ball", "ban", "bang",
      "bought", "quarter", "modern", "research", "technical", "engineer", "prime", "civil", "place", "saw", "there", "took"
    ],
    reason: "Общеупотребительные английские существительные и глаголы, попавшие в словарь угроз как одиночные слова",
  },
  {
    lang: "en.json",
    categoryName: "Обычные личные имена",
    terms: ["ahmed", "ali", "amir", "amin", "anwar"],
    reason: "Обычные распространенные имена людей, ошибочно помеченные как терроризм",
  }
];

function run() {
  const isApply = process.argv.includes("--apply");
  console.log(`=== ОЧИСТКА СЛОВАРЕЙ ОТ ПАРАЗИТНЫХ И БЫТОВЫХ СЛОВ [${isApply ? "ПРИМЕНЕНИЕ" : "ТЕСТОВЫЙ ПРОГОН"}] ===\n`);

  const dictDir = path.resolve(process.cwd(), "dictionaries");
  const files = ["ar.json", "fa.json", "he.json", "en.json"];

  for (const file of files) {
    const filePath = path.join(dictDir, file);
    if (!fs.existsSync(filePath)) continue;

    const dict = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const originalCount = dict.entries.length;

    const fileRules = CLEANUP_RULES.filter((r) => r.lang === file);
    const toRemoveMap = new Map<string, string>(); // termLower -> reason/category

    for (const rule of fileRules) {
      for (const t of rule.terms) {
        toRemoveMap.set(t.trim().toLowerCase(), rule.categoryName);
      }
    }

    const removedEntries: any[] = [];
    const keptEntries: any[] = [];

    for (const entry of dict.entries) {
      const termLower = (entry.term || "").trim().toLowerCase();
      if (toRemoveMap.has(termLower)) {
        removedEntries.push({ term: entry.term, concept: entry.concept, category: toRemoveMap.get(termLower) });
      } else {
        keptEntries.push(entry);
      }
    }

    console.log(`📁 [${file}] Исходно записей: ${originalCount}`);
    for (const rule of fileRules) {
      const ruleMatches = removedEntries.filter((r) => r.category === rule.categoryName);
      console.log(`   • ${rule.categoryName}: удалено ${ruleMatches.length} (${rule.reason})`);
    }
    console.log(`   => Всего удалено: ${removedEntries.length}, осталось: ${keptEntries.length}\n`);

    if (isApply && removedEntries.length > 0) {
      dict.entries = keptEntries;
      fs.writeFileSync(filePath, JSON.stringify(dict, null, 2), "utf-8");
    }
  }

  if (!isApply) {
    console.log("👉 Запустите с флагом --apply для сохранения изменений в файлы словарей.");
  }
}

run();
