import fs from "node:fs";
import path from "node:path";

function updateVocab() {
  const dictDir = path.resolve(process.cwd(), "dictionaries");

  // 1. UPDATE HEBREW (he.json)
  const hePath = path.join(dictDir, "he.json");
  const he = JSON.parse(fs.readFileSync(hePath, "utf-8"));

  // Words to remove from Hebrew (damaging false positive words)
  const heToRemove = new Set([
    "לום", // crowbar tool -> matches inside שלום (Shalom)
    "משפחה", "המשפחה", // family -> civilian target
    "שבת", // shabbat -> jewish target
    "אדם", // human/person -> hate slur
    "איש", // man -> civilian target
    "גבר", // man -> civilian target
  ]);

  const beforeHeCount = he.entries.length;
  he.entries = he.entries.filter((x: any) => !heToRemove.has(x.term));
  const removedHeCount = beforeHeCount - he.entries.length;

  // Idioms and words to ADD to Hebrew
  const heToAdd = [
    // Slang Kalash
    { term: "קלאש", concept: "weapon.firearm" },
    { term: "קלאצ", concept: "weapon.firearm" },
    { term: "קלצ", concept: "weapon.firearm" },

    // Retaliation and blood threat idioms
    { term: "החשבון בינינו ייסגר", concept: "threat.direct" },
    { term: "החשבון ייסגר", concept: "threat.direct" },
    { term: "החשבון איתכם פתוח", concept: "threat.direct" },
    { term: "ייסגר בדם", concept: "threat.direct" },
    { term: "לא תצאו מזה בחיים", concept: "threat.direct" },
    { term: "לא תצאו מזה", concept: "threat.direct" },
    { term: "אתם הבאים בתור", concept: "threat.direct" },
    { term: "אתם על הכוונת", concept: "threat.direct" },
    { term: "הספירה לאחור החלה", concept: "threat.intimidation" },
    { term: "הספירה לאחור", concept: "threat.intimidation" },
    { term: "עוקבים אחרי כל צעד", concept: "threat.intimidation" },
    { term: "עוקבים אחריכם", concept: "threat.intimidation" },
    { term: "אנחנו עוקבים אחרי", concept: "threat.intimidation" },
    { term: "אל תעופו על עצמכם", concept: "threat.intimidation" },
    { term: "עוד תשלמו על זה", concept: "threat.direct" },
    { term: "תשלמו על זה", concept: "threat.direct" },
    { term: "תשלמו ביוקר", concept: "threat.direct" },
    { term: "הפעם זה לא יעבור בשקט", concept: "threat.intimidation" },
    { term: "זה לא יעבור לכם בשקט", concept: "threat.intimidation" },
    { term: "לא יעבור בשקט", concept: "threat.intimidation" },
    { term: "לא יהיה לכם שקט", concept: "threat.intimidation" },
    { term: "עוד תצטערו על היום", concept: "threat.intimidation" },
    { term: "תצטערו על היום", concept: "threat.intimidation" },
    { term: "אל תחשבו שאתם חסינים", concept: "threat.intimidation" },
    { term: "אתם עוד תראו מה זה", concept: "threat.intimidation" },
    { term: "הגיע הזמן למעשים", concept: "threat.direct" },
    { term: "נמאס מהדיבורים", concept: "threat.direct" },
    { term: "אנחנו לא שוכחים ולא סולחים", concept: "threat.intimidation" },
    { term: "לא שוכחים ולא סולחים", concept: "threat.intimidation" },
    { term: "שתרגישו בעצמכם את הפחד", concept: "threat.intimidation" },
    { term: "מישהו עוד ישלם על זה", concept: "threat.direct" },
    { term: "עוד ישלם על זה", concept: "threat.direct" },
    { term: "תאכלו את הכובע", concept: "threat.intimidation" },
    { term: "אתם לא יודעים מה מחכה לכם", concept: "threat.intimidation" },
    { term: "הזמן שלכם הולך ואוזל", concept: "threat.intimidation" },
  ];

  for (const item of heToAdd) {
    if (!he.entries.some((e: any) => e.term === item.term && e.concept === item.concept)) {
      he.entries.push(item);
    }
  }

  fs.writeFileSync(hePath, JSON.stringify(he, null, 2), "utf-8");
  console.log(`[he.json] Удалено паразитных слов: ${removedHeCount}, Добавлено идиом угроз: ${heToAdd.length}`);

  // 2. UPDATE ARABIC (ar.json)
  const arPath = path.join(dictDir, "ar.json");
  const ar = JSON.parse(fs.readFileSync(arPath, "utf-8"));

  // Remove standalone نخبة / نخبه
  const beforeArCount = ar.entries.length;
  ar.entries = ar.entries.filter((x: any) => x.term !== "نخبة" && x.term !== "نخبه");
  const removedArCount = beforeArCount - ar.entries.length;

  // Add precise military Nukhba compound terms
  const arToAdd = [
    { term: "قوات النخبة", concept: "violence.terrorism" },
    { term: "كتائب النخبة", concept: "violence.terrorism" },
    { term: "وحدة النخبة", concept: "violence.terrorism" },
  ];

  for (const item of arToAdd) {
    if (!ar.entries.some((e: any) => e.term === item.term)) {
      ar.entries.push(item);
    }
  }

  fs.writeFileSync(arPath, JSON.stringify(ar, null, 2), "utf-8");
  console.log(`[ar.json] Удалено паразитных слов: ${removedArCount}, Добавлено составных терминов: ${arToAdd.length}`);
}

updateVocab();
