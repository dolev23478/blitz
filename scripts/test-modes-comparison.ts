import { analyzeText, ThreatMode } from "../src/index.js";

interface TestCase {
  title: string;
  description: string;
  text: string;
}

const testCases: TestCase[] = [
  {
    title: "1. Прямая террористическая угроза с оружием (English)",
    description: "Явный призыв к убийству и ракетному удару с эмодзи",
    text: "We will launch rockets and kill all soldiers in Tel Aviv 🚀💣",
  },
  {
    title: "2. Бытовой текст со словом двойного назначения (Arabic - бензин)",
    description: "Мирный бытовой контекст: поездка на заправку за бензином",
    text: "ذهبت إلى المحطة واشتريت البنزين والغاز للسيارة اليوم",
  },
  {
    title: "3. Опасная комбинация: двойное назначение + насилие (Arabic - поджог)",
    description: "Тот же бензин, но с призывом сжечь здание",
    text: "سنحرق المبنى بالبنزين غدا",
  },
  {
    title: "4. Психологическая угроза / реванш без оружия (Hebrew)",
    description: "Запугивание и обещание расплаты без названий оружия",
    text: "חכו חכו, אתם עוד תשלמו ביוקר על מה שעשיתם.",
  },
  {
    title: "5. Длинная научная статья с единичным упоминанием локации (English)",
    description: "150 слов об астрономии с одним упоминанием телескопа в Хайфе",
    text:
      "The academic conference discussed regional architecture, astronomy, and planetary science across observatories. ".repeat(
        12,
      ) + " A telescope observed the night sky near Haifa.",
  },
];

console.log("================================================================================");
console.log("       СРАВНИТЕЛЬНЫЙ АНАЛИЗ РЕЖИМОВ РАБОТЫ ТЕКСТОВОГО АНАЛИЗАТОРА               ");
console.log("================================================================================\n");

for (const tc of testCases) {
  console.log(`📌 ТЕСТ: ${tc.title}`);
  console.log(`   Контекст:  ${tc.description}`);
  console.log(`   Текст:     "${tc.text.length > 80 ? tc.text.slice(0, 77) + "..." : tc.text}"\n`);

  // 1. Режим 'dictionary_only' (или analyzeText(text, false))
  const resDict = analyzeText(tc.text, false);

  // 2. Режим 'category_filter' (или analyzeText(tc.text, { filter: true }))
  const resFilter = analyzeText(tc.text, { filter: true });

  // 3. Режим 'smart' (или analyzeText(tc.text, true))
  const resSmart = analyzeText(tc.text, true);

  console.log("   ┌────────────────────┬───────────┬────────────┬───────────────────────────────────────┐");
  console.log("   │ Режим              │ Сработал? │ Уровень    │ Оценка / Детали                       │");
  console.log("   ├────────────────────┼───────────┼────────────┼───────────────────────────────────────┤");

  // Format dict row
  const dictFlag = resDict.matched ? "❌ ДА (100%)" : "✅ НЕТ     ";
  const dictTerms = resDict.terms.slice(0, 3).join(", ") + (resDict.terms.length > 3 ? "..." : "");
  console.log(`   │ dictionary_only    │ ${dictFlag}│ n/a        │ Найдено слов: ${resDict.terms.length} [${dictTerms}]`);

  // Format filter row
  const filterFlag = resFilter.matched ? "🚨 ДА      " : "✅ НЕТ     ";
  const filterCats = resFilter.evaluation?.threatCategories.slice(0, 2).join(", ") || "none";
  console.log(`   │ category_filter    │ ${filterFlag}│ n/a        │ Категории: ${filterCats}`);

  // Format smart row
  const smartFlag = resSmart.matched ? "🚨 ДА      " : "✅ НЕТ     ";
  const smartLevel = (resSmart.evaluation?.riskLevel || "none").padEnd(10);
  const smartScore = `Балл: ${resSmart.evaluation?.riskScore}/100, слов: ${resSmart.evaluation?.wordCount}`;
  console.log(`   │ smart              │ ${smartFlag}│ ${smartLevel} │ ${smartScore}`);
  console.log("   └────────────────────┴───────────┴────────────┴───────────────────────────────────────┘");

  if (resSmart.evaluation?.flaggedReasons.length) {
    console.log("   Причины оценки (smart):");
    for (const r of resSmart.evaluation.flaggedReasons) {
      console.log(`     • ${r}`);
    }
  }
  console.log("\n--------------------------------------------------------------------------------\n");
}
