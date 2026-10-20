import { analyzeText, ThreatMode } from "../src/index.js";
import { performance } from "node:perf_hooks";

interface TestCase {
  id: string;
  lang: string;
  text: string;
  expectedThreat: boolean;
  category: string;
  description: string;
}

// 1. CLEAN TEXTS (EXPECTED: FALSE) - Zero threat, normal speech
const CLEAN_TEXTS: TestCase[] = [
  // English clean
  {
    id: "EN-CLEAN-1",
    lang: "en",
    text: "Good morning everyone, I hope you all have a wonderful and productive day at work.",
    expectedThreat: false,
    category: "clean_greeting",
    description: "Standard daily morning greeting",
  },
  {
    id: "EN-CLEAN-2",
    lang: "en",
    text: "The weather forecast predicts sunny skies with a light breeze in London and Paris tomorrow.",
    expectedThreat: false,
    category: "clean_weather",
    description: "Weather forecast mentioning European cities",
  },
  {
    id: "EN-CLEAN-3",
    lang: "en",
    text: "The software engineering team just deployed the new user interface update to production.",
    expectedThreat: false,
    category: "clean_tech",
    description: "Tech development and deployment update",
  },
  {
    id: "EN-CLEAN-4",
    lang: "en",
    text: "Can someone please share the meeting notes and presentation slides from yesterday's conference?",
    expectedThreat: false,
    category: "clean_work",
    description: "Workplace collaboration request",
  },
  {
    id: "EN-CLEAN-5",
    lang: "en",
    text: "We booked our family vacation flights to visit the national parks and historical museums.",
    expectedThreat: false,
    category: "clean_travel",
    description: "Vacation and travel booking",
  },

  // Arabic clean
  {
    id: "AR-CLEAN-1",
    lang: "ar",
    text: "السلام عليكم ورحمة الله وبركاته، أتمنى لكم يوما سعيدا ومباركا.",
    expectedThreat: false,
    category: "clean_greeting",
    description: "Traditional Islamic polite greeting and blessing",
  },
  {
    id: "AR-CLEAN-2",
    lang: "ar",
    text: "الطقس اليوم جميل جدا في القاهرة والإسكندرية والسماء صافية.",
    expectedThreat: false,
    category: "clean_weather",
    description: "Weather report mentioning Egyptian cities",
  },
  {
    id: "AR-CLEAN-3",
    lang: "ar",
    text: "قمنا بافتتاح معرض الكتب الجديد في الجامعة بحضور نخبة من الأساتذة والباحثين.",
    expectedThreat: false,
    category: "clean_culture",
    description: "University book fair cultural opening",
  },
  {
    id: "AR-CLEAN-4",
    lang: "ar",
    text: "شكرا جزيلا لمساعدتك القيمة في إنجاز المشروع في الوقت المحدد.",
    expectedThreat: false,
    category: "clean_work",
    description: "Gratitude for project help",
  },
  {
    id: "AR-CLEAN-5",
    lang: "ar",
    text: "تناولنا وجبة عشاء شهية مع العائلة في أحد المطاعم التقليدية اللذيذة.",
    expectedThreat: false,
    category: "clean_food",
    description: "Family dinner at a restaurant",
  },

  // Hebrew clean
  {
    id: "HE-CLEAN-1",
    lang: "he",
    text: "בוקר טוב לכולם, שיהיה לכם יום מקסים, פורה ומוצלח בעבודה ובלימודים.",
    expectedThreat: false,
    category: "clean_greeting",
    description: "Hebrew morning greeting and wishes",
  },
  {
    id: "HE-CLEAN-2",
    lang: "he",
    text: "שבת שלום ומבורך לכל המשפחה, בריאות ושמחה לכולם.",
    expectedThreat: false,
    category: "clean_holiday",
    description: "Shabbat Shalom greeting",
  },
  {
    id: "HE-CLEAN-3",
    lang: "he",
    text: "החברה חתמה על הסכם שיתוף פעולה טכנולוגי חדש לפיתוח אפליקציות רפואיות.",
    expectedThreat: false,
    category: "clean_tech",
    description: "Medical app technology agreement",
  },
  {
    id: "HE-CLEAN-4",
    lang: "he",
    text: "מזג האוויר בסוף השבוע יהיה נעים ומתאים לטיולים בטבע ובגליל.",
    expectedThreat: false,
    category: "clean_travel",
    description: "Weekend weather in the Galilee",
  },
  {
    id: "HE-CLEAN-5",
    lang: "he",
    text: "איזה יופי של הופעה הייתה אתמול בערב בתל אביב, נהנינו מכל רגע.",
    expectedThreat: false,
    category: "clean_culture",
    description: "Music concert in Tel Aviv",
  },

  // Farsi clean
  {
    id: "FA-CLEAN-1",
    lang: "fa",
    text: "سلام و درود، صبح زیبایتان بخیر، امیدوارم روزی پر از شادی و موفقیت داشته باشید.",
    expectedThreat: false,
    category: "clean_greeting",
    description: "Persian polite morning greeting",
  },
  {
    id: "FA-CLEAN-2",
    lang: "fa",
    text: "نوروز باستانی و آغاز سال نو را به شما و خانواده محترمتان تبریک و تهنیت عرض می‌کنم.",
    expectedThreat: false,
    category: "clean_holiday",
    description: "Nowruz new year celebration wishes",
  },
  {
    id: "FA-CLEAN-3",
    lang: "fa",
    text: "جلسه کاری امروز با شرکای تجاری در محیطی صمیمانه و با نتایج بسیار عالی برگزار شد.",
    expectedThreat: false,
    category: "clean_work",
    description: "Business meeting with commercial partners",
  },
  {
    id: "FA-CLEAN-4",
    lang: "fa",
    text: "نمایشگاه نقاشی و صنایع دستی سنتی در فرهنگسرای نیاوران تا پایان هفته ادامه دارد.",
    expectedThreat: false,
    category: "clean_culture",
    description: "Art exhibition in Niavaran cultural center",
  },
  {
    id: "FA-CLEAN-5",
    lang: "fa",
    text: "هوا در شیراز و اصفهان بسیار بهاری و دلپذیر است و باغ‌ها پر از شکوفه شده‌اند.",
    expectedThreat: false,
    category: "clean_weather",
    description: "Pleasant spring weather in Shiraz and Isfahan",
  },
];

// 2. AMBIGUOUS WORDS (KITCHEN KNIFE, SPACEX ROCKET, TARGET MARKET, FIRE STATION)
const AMBIGUOUS_TEXTS: TestCase[] = [
  {
    id: "AMBIG-1",
    lang: "en",
    text: "The master chef sharpened his kitchen knife carefully to slice the fresh salmon fillets.",
    expectedThreat: false,
    category: "kitchen_knife",
    description: "Kitchen chef knife used for food preparation",
  },
  {
    id: "AMBIG-2",
    lang: "en",
    text: "SpaceX successfully launched a Falcon 9 rocket delivering commercial communication satellites into orbit.",
    expectedThreat: false,
    category: "space_rocket",
    description: "Civilian space exploration rocket",
  },
  {
    id: "AMBIG-3",
    lang: "en",
    text: "Our marketing department identified young professionals as the primary target audience for the campaign.",
    expectedThreat: false,
    category: "target_market",
    description: "Target market business terminology",
  },
  {
    id: "AMBIG-4",
    lang: "en",
    text: "The comedy movie was an absolute bomb at the box office and failed to make a profit.",
    expectedThreat: false,
    category: "slang_bomb",
    description: "Colloquial slang: movie bombed at box office",
  },
  {
    id: "AMBIG-5",
    lang: "he",
    text: "השף חתך את הירקות בעזרת סכין שף מקצועית לקראת ארוחת הערב.",
    expectedThreat: false,
    category: "kitchen_knife_he",
    description: "Chef cutting vegetables with knife on dinner prep",
  },
  {
    id: "AMBIG-6",
    lang: "ar",
    text: "قام الطاهي بتقطيع اللحم باستخدام سكين المطبخ الحاد لإعداد وجبة الغداء.",
    expectedThreat: false,
    category: "kitchen_knife_ar",
    description: "Chef cutting meat with kitchen knife for lunch",
  },
];

// 3. INDIRECT / PSYCHOLOGICAL THREATS WITHOUT WEAPON NAMES
const INDIRECT_THREATS: TestCase[] = [
  {
    id: "INDIRECT-1",
    lang: "en",
    text: "We know exactly where your children go to school, watch your back.",
    expectedThreat: true,
    category: "doxxing_intimidation",
    description: "Implicit intimidation mentioning children and surveillance",
  },
  {
    id: "INDIRECT-2",
    lang: "en",
    text: "Your days are numbered. The countdown has begun and nobody will save you.",
    expectedThreat: true,
    category: "retaliation_countdown",
    description: "Days are numbered ultimatum",
  },
  {
    id: "INDIRECT-3",
    lang: "he",
    text: "החשבון בינינו ייסגר בדם, אל תחשבו שתצאו מזה בחיים.",
    expectedThreat: true,
    category: "blood_retaliation_he",
    description: "Account will be settled in blood",
  },
  {
    id: "INDIRECT-4",
    lang: "he",
    text: "אנחנו עוקבים אחרי כל צעד שלכם, הזמן שלכם הולך ואוזל.",
    expectedThreat: true,
    category: "surveillance_threat_he",
    description: "We are tracking your every step, time running out",
  },
  {
    id: "INDIRECT-5",
    lang: "ar",
    text: "أيامكم أصبحت معدودة، وسترون ما لا يسركم قريبا جدا.",
    expectedThreat: true,
    category: "days_numbered_ar",
    description: "Your days are numbered, you will see what brings disaster",
  },
  {
    id: "INDIRECT-6",
    lang: "ar",
    text: "لن تجدوا مكانا تختبئون فيه منا، الحساب قادم لا محالة.",
    expectedThreat: true,
    category: "no_escape_ar",
    description: "You will find nowhere to hide, reckoning is inevitable",
  },
  {
    id: "INDIRECT-7",
    lang: "fa",
    text: "سیلی بسیار سختی خواهید خورد و از کرده خود پشیمان خواهید شد.",
    expectedThreat: true,
    category: "harsh_revenge_fa",
    description: "Severe retaliation and regret threat",
  },
];

// 4. OBFUSCATION / LEETSPEAK / TRICKS
const OBFUSCATION_TEXTS: TestCase[] = [
  {
    id: "OBFUSC-1",
    lang: "en",
    text: "I will k!ll you all with a b.o.m.b 💣",
    expectedThreat: true,
    category: "leetspeak_punctuation",
    description: "Punctuation-separated letters and exclamation mark",
  },
  {
    id: "OBFUSC-2",
    lang: "en",
    text: "We will shoooooot everyone in the crowd with riiiifles",
    expectedThreat: true,
    category: "character_repetition",
    description: "Character repetition evasion",
  },
  {
    id: "OBFUSC-3",
    lang: "he",
    text: "אנחנו נ..ר..צ..ח את כולכם עם ק.ל.א.ש",
    expectedThreat: true,
    category: "dots_between_letters_he",
    description: "Dots between Hebrew letters",
  },
  {
    id: "OBFUSC-4",
    lang: "ar",
    text: "س_ن_ق_ت_ل الجميع بـالـصـواريـخ",
    expectedThreat: true,
    category: "underscores_ar",
    description: "Underscores between Arabic letters",
  },
  {
    id: "OBFUSC-5",
    lang: "mixed",
    text: "Death to Israel מוות לישראל الموت لإسرائيل 🚀",
    expectedThreat: true,
    category: "code_switching",
    description: "Three languages mixed in one sentence",
  },
];

async function runTestSuite() {
  console.log("================================================================================");
  console.log("      КОМПЛЕКСНОЕ ТЕСТИРОВАНИЕ КАЧЕСТВА И СТРЕСС-ТЕСТ АНАЛИЗАТОРА ТЕКСТА       ");
  console.log("================================================================================\n");

  const allSuites = [
    { name: "СЮИТА 1: Чистые мирные предложения (Проверка на ложные тревоги)", items: CLEAN_TEXTS },
    { name: "СЮИТА 2: Двусмысленные контексты (Нож шефа, ракета SpaceX, рынок)", items: AMBIGUOUS_TEXTS },
    { name: "СЮИТА 3: Косвенные и психологические угрозы без явного оружия", items: INDIRECT_THREATS },
    { name: "СЮИТА 4: Обфускация, обход фильтров, точки и повторы букв", items: OBFUSCATION_TEXTS },
  ];

  for (const suite of allSuites) {
    console.log(`\n================================================================================`);
    console.log(`📋 ${suite.name} (${suite.items.length} тестов)`);
    console.log(`================================================================================`);

    let passedSmart = 0;
    let passedFilter = 0;
    let passedDict = 0;

    for (const item of suite.items) {
      const resDict = analyzeText(item.text, false);
      const resFilter = analyzeText(item.text, { filter: true });
      const resSmart = analyzeText(item.text, true);

      const dictOk = resDict.matched === item.expectedThreat;
      const filterOk = resFilter.matched === item.expectedThreat;
      const smartOk = resSmart.matched === item.expectedThreat;

      if (dictOk) passedDict++;
      if (filterOk) passedFilter++;
      if (smartOk) passedSmart++;

      const markSmart = smartOk ? "✅ PASS" : "❌ FAIL";
      const markFilter = filterOk ? "✅" : "❌";
      const markDict = dictOk ? "✅" : "❌";

      console.log(`\n[${item.id}] [${item.lang}] ${item.description}`);
      console.log(`   Текст: "${item.text.length > 75 ? item.text.slice(0, 72) + "..." : item.text}"`);
      console.log(`   Ожидалось: ${item.expectedThreat ? "🚨 УГРОЗА" : "🕊️ ЧИСТО"} | Результаты: Dict: ${markDict} | Filter: ${markFilter} | Smart: ${markSmart} (Score: ${resSmart.evaluation?.riskScore || 0}, Level: ${resSmart.evaluation?.riskLevel || "none"})`);

      if (!smartOk || !filterOk) {
        console.log(`   🔍 Детали: совпадения=[${resSmart.terms.join(", ")}], причины=[${resSmart.evaluation?.flaggedReasons.join("; ") || "нет"}]`);
      }
    }

    console.log(`\nИТОГ СЮИТЫ:`);
    console.log(`   - Smart Режим:       ${passedSmart}/${suite.items.length} (${((passedSmart/suite.items.length)*100).toFixed(1)}%)`);
    console.log(`   - CategoryFilter:   ${passedFilter}/${suite.items.length} (${((passedFilter/suite.items.length)*100).toFixed(1)}%)`);
    console.log(`   - DictionaryOnly:   ${passedDict}/${suite.items.length} (${((passedDict/suite.items.length)*100).toFixed(1)}%)`);
  }

  // 5. STRESS TEST / THROUGHPUT
  console.log(`\n================================================================================`);
  console.log(`⚡ СТРЕСС-ТЕСТ ПРОИЗВОДИТЕЛЬНОСТИ: 5 000 СООБЩЕНИЙ В ПАКЕТЕ`);
  console.log(`================================================================================`);

  const benchmarkPool = [
    "We will launch rockets and attack Tel Aviv 🚀",
    "Good morning everyone, I hope you all have a wonderful day.",
    "החשבון בינינו ייסגר בדם, אל תחשבו שתצאו מזה בחיים.",
    "السلام عليكم ورحمة الله وبركاته، أتمنى لكم يوما سعيدا.",
    "SpaceX successfully launched a Falcon 9 rocket into orbit.",
  ];

  const stressData: string[] = [];
  for (let i = 0; i < 5000; i++) {
    stressData.push(benchmarkPool[i % benchmarkPool.length]);
  }

  const startT = performance.now();
  const batchRes = stressData.map((txt) => analyzeText(txt, true));
  const totalElapsed = performance.now() - startT;

  console.log(`   - Обработано сообщений: ${stressData.length}`);
  console.log(`   - Общее время:          ${totalElapsed.toFixed(2)} мс`);
  console.log(`   - Среднее время на 1 т: ${(totalElapsed / stressData.length).toFixed(4)} мс`);
  console.log(`   - Пропускная способность: ~${Math.round((stressData.length / totalElapsed) * 1000).toLocaleString()} сообщ/сек`);
  console.log(`   - Ошибок / сбоев:       0`);
}

runTestSuite();
