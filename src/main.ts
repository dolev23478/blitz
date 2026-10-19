import { exit } from "node:process";
import { analyzeText, type AnalyzeTextResult } from "./index.js";

const examples_en = [

  "Our enemies think we have forgotten what they did. They are wrong.",
  "The time for revenge has come, and our anger will not disappear.",
  "Anyone who supports Israel is our enemy.",
  "They keep talking about peace while hatred continues to grow.",
  "Our movement will never stop fighting against its enemies.",
  "The occupation must end, and those responsible must face the consequences.",
  "We will never forgive those who have harmed our people.",
  "Their actions have created a generation filled with anger and resentment.",
  "Some people believe violence is the only language our enemies understand.",
  "The struggle will continue until our demands are heard.",
  "Our supporters believe that retaliation is justified.",
  "Hatred against Jewish people is spreading in extremist online communities.",
  "This channel shares propaganda from a radical organization.",
  "The group glorifies past attacks and praises those responsible.",
  "The speaker encourages followers to join the movement.",
  "The post calls for revenge against Israeli citizens.",
  "The message contains threatening language directed at Jewish communities.",
  "The author describes civilians as legitimate targets.",
  "The group claims that violence is necessary to achieve its political goals.",
  "The account repeatedly publishes extremist slogans and threats.",
  "Supporters are encouraged to spread the group's ideology online.",
  "The message celebrates an attack and expresses support for further violence.",
  "The speaker portrays an entire nationality as an enemy.",
  "The post uses dehumanizing language to justify hatred.",
  "The organization presents itself as a resistance movement while praising attacks on civilians.",
  "The author threatens retaliation against people who disagree with the group's ideology.",
  "The message calls for hostility toward Jewish institutions.",
  "The group tries to recruit people by exploiting anger and resentment.",
  "The account describes terrorism as heroic and encourages admiration for extremists.",
  "The post warns that the conflict will continue and contains threatening language.",





"Israel must be wiped off the map.",
"They keep threatening Israel and its people.",
"The comments call for violence against Israeli citizens.",
"The post celebrates attacks on Jewish people.",
"The author says the enemy deserves no mercy.",
"The account calls for revenge against Israel.",
"The comments describe Israelis as enemies who should be eliminated.",
"The post glorifies the destruction of Tel Aviv.",
"The message contains threats against Jewish communities.",
"The author praises people who carry out terrorist attacks.",
"The comments encourage hatred toward Jews.",
"The post says that violence is the only answer.",
"The account threatens retaliation against Israeli citizens.",
"The message calls for the destruction of Israel.",
"The author uses dehumanizing language about Jewish people.",
"The post celebrates the deaths of Israeli civilians.",
"The comments call for attacks on Jewish institutions.",
"The message praises an extremist organization.",
"The author says that revenge against Israelis is justified.",
"The account spreads propaganda encouraging violence against Israel.",
"I will kill all the Jews in Israel.",
"love kill all the Jews in Israel.",
"destroy il",
"explode"
]


const examples_ar = [
    "أريد تنفيذ هجوم إرهابي.",
    "هناك تهديد بشن هجوم إرهابي.",
    "يجب منع أي هجوم يستهدف المدنيين.",
    "نرفض جميع أشكال الإرهاب والعنف ضد الأبرياء.",
    "نشر تهديداً ضد المجتمع اليهودي.",
    "هدد بمهاجمة كنيس يهودي.",
    "الشرطة تحقق في تهديد إرهابي ضد إسرائيليين.",
    "تم إحباط مخطط لتنفيذ هجوم إرهابي.",
    "أعلنت السلطات اعتقال شخص للاشتباه في التخطيط لهجوم.",
    "الرسالة تتضمن تهديداً خطيراً بارتكاب أعمال عنف.",
    "دعا المنشور إلى استهداف المدنيين.",
    "التحريض على قتل الأبرياء جريمة خطيرة.",
    "المجموعة تمجد الهجمات الإرهابية.",
    "نشر الحساب دعاية لجماعة إرهابية.",
    "يحاول التنظيم تجنيد أعضاء جدد.",
    "تم اعتقال مشتبه به بتهمة دعم الإرهاب.",
    "المنشور يشجع على العنف ضد اليهود.",
    "هذا تهديد يستهدف المدنيين الإسرائيليين.",
    "يجب حماية المعابد اليهودية من الهجمات.",
    "لا يجوز تبرير قتل المدنيين باسم أي قضية.",
    "تتضمن الرسالة دعوة صريحة إلى ارتكاب أعمال إرهابية.",
    "أعرب الكاتب عن دعمه لهجوم استهدف مدنيين.",
    "الشرطة تتعامل مع تهديد محتمل بوقوع هجوم.",
    "تراقب السلطات منشورات تحرض على الإرهاب.",
    "المحتوى يروج للكراهية ويدعو إلى العنف ضد جماعة دينية.",
    "أدان المسؤولون الهجوم الإرهابي الذي استهدف الأبرياء.",
    "تحدث الشاهد عن تهديدات تلقاها قبل الهجوم.",
    "تبحث الشرطة عن صاحب حساب نشر تهديدات إرهابية.",
    "يجب الإبلاغ عن أي تهديد موثوق بوقوع هجوم.",
    "لا ينبغي الخلط بين انتقاد الحكومة والتحريض على قتل المدنيين.",















"يجب محو إسرائيل من الخريطة.",
"تتضمن هذه الرسالة تهديداً ضد شعب إسرائيل.",
"تدعو هذه التعليقات إلى العنف ضد المواطنين الإسرائيليين.",
"يمجّد هذا المنشور الهجمات ضد اليهود.",
"يقول الكاتب إن العدو لا يستحق أي رحمة.",
"يدعو هذا الحساب إلى الانتقام من إسرائيل.",
"تصف التعليقات الإسرائيليين بأنهم أعداء يجب القضاء عليهم.",
"يحتفي هذا المنشور بتدمير تل أبيب.",
"تتضمن الرسالة تهديدات ضد المجتمعات اليهودية.",
"يمدح الكاتب الأشخاص الذين ينفذون هجمات إرهابية.",
"تعمل هذه التعليقات على نشر الكراهية ضد اليهود.",
"يقول هذا المنشور إن العنف هو الحل الوحيد.",
"يهدد هذا الحساب المواطنين الإسرائيليين بالانتقام.",
"تدعو هذه الرسالة إلى تدمير إسرائيل.",
"يستخدم الكاتب لغة تحط من إنسانية اليهود.",
"يعرب هذا المنشور عن الفرح بمقتل مدنيين إسرائيليين.",
"تدعو هذه التعليقات إلى مهاجمة المؤسسات اليهودية.",
"تمجّد هذه الرسالة منظمة متطرفة.",
"يبرر الكاتب الانتقام من الإسرائيليين.",
"ينشر هذا الحساب دعاية تشجع على العنف ضد إسرائيل."




];


const examples_fa = [
    "می‌خواهم یک حمله تروریستی انجام دهم.",
    "تهدید به انجام یک حمله تروریستی منتشر شده است.",
    "این گروه از خشونت علیه غیرنظامیان حمایت می‌کند.",
    "باید از حمله به غیرنظامیان جلوگیری کرد.",
    "یک کنیسه یهودی تهدید شده است.",
    "او تهدید کرده است که به یهودیان حمله می‌کند.",
    "پلیس در حال بررسی تهدید علیه شهروندان اسرائیلی است.",
    "مقامات اعلام کردند که یک طرح تروریستی خنثی شده است.",
    "این حساب در شبکه‌های اجتماعی تبلیغات یک گروه تروریستی را منتشر می‌کند.",
    "این سازمان برای جذب اعضای جدید تلاش می‌کند.",
    "این پیام مردم را به خشونت علیه یهودیان تحریک می‌کند.",
    "نباید قتل غیرنظامیان را توجیه کرد.",
    "نویسنده از حمله به غیرنظامیان حمایت کرده است.",
    "مقامات درباره احتمال وقوع یک حمله هشدار داده‌اند.",
    "این گروه حملات تروریستی را ستایش می‌کند.",
    "او خواستار پایان دادن به خشونت شد.",
    "این پیام شامل تهدیدی جدی علیه یک جامعه مذهبی است.",
    "پلیس فردی را به ظن برنامه‌ریزی برای حمله بازداشت کرد.",
    "هرگونه تهدید معتبر باید به مقامات گزارش شود.",
    "انتقاد از دولت با تحریک به قتل غیرنظامیان یکسان نیست.",
    "آن‌ها می‌خواهند نفرت خود را به خشونت واقعی تبدیل کنند.",
    "دیگر فقط حرف زدن کافی نیست؛ آن‌ها خواهان اقدام هستند.",
    "این افراد باید از عواقب کارهایشان بترسند.",
    "او گفت که انتقام تنها راه‌حل است.",
    "این گروه خواستار حمله به اهداف غیرنظامی شده است.",
    "پیام منتشرشده حاوی تهدید علیه اسرائیلی‌ها بود.",
    "مردم باید در برابر افراط‌گرایی و تروریسم متحد شوند.",
    "این گزارش درباره تهدیدهای یک گروه افراطی است.",
    "او از خشونت علیه یهودیان حمایت نمی‌کند.",
    "هدف این برنامه شناسایی پیام‌های تهدیدآمیز و جلوگیری از حملات است.",












    
"اسرائیل باید از روی نقشه محو شود.",
"این پیام حاوی تهدید علیه مردم اسرائیل است.",
"این نظرات خواستار خشونت علیه شهروندان اسرائیلی هستند.",
"این پست حملات علیه یهودیان را ستایش می‌کند.",
"نویسنده می‌گوید که دشمن سزاوار هیچ رحمی نیست.",
"این حساب خواستار انتقام از اسرائیل است.",
"در این نظرات از نابودی اسرائیلی‌ها حمایت شده است.",
"این پست از نابودی تل‌آویو استقبال می‌کند.",
"این پیام شامل تهدید علیه جوامع یهودی است.",
"نویسنده افرادی را که حملات تروریستی انجام می‌دهند، تحسین می‌کند.",
"این نظرات نفرت علیه یهودیان را ترویج می‌کنند.",
"این پست می‌گوید که خشونت تنها راه‌حل است.",
"این حساب شهروندان اسرائیلی را به انتقام تهدید می‌کند.",
"این پیام خواستار نابودی اسرائیل است.",
"نویسنده درباره یهودیان از زبان تحقیرآمیز و غیرانسانی استفاده می‌کند.",
"این پست از کشته شدن غیرنظامیان اسرائیلی ابراز خوشحالی می‌کند.",
"این نظرات خواستار حمله به مراکز یهودی هستند.",
"این پیام یک سازمان افراطی را ستایش می‌کند.",
"نویسنده انتقام گرفتن از اسرائیلی‌ها را توجیه می‌کند.",
"این حساب تبلیغاتی را منتشر می‌کند که خشونت علیه اسرائیل را تشویق می‌کند."

];


function runBenchmark(name: string, lang: string, examples: string[]) {
  console.log(`\n================== ${name} (${lang}) ==================`);
  const notMatched: string[] = [];
  let matchedCount = 0;

  examples.forEach((example, idx) => {
    const result: AnalyzeTextResult = analyzeText(example, lang);
    if (result.matched) {
      matchedCount += 1;
      console.log(`[PASS] #${idx + 1}: terms=[${result.terms.join(", ")}] -> "${example}"`);
    } else {
      notMatched.push(example);
      console.log(`[FAIL] #${idx + 1}: "${example}"`);
    }
  });

  console.log(`\n--- Summary ${name}: ${matchedCount} / ${examples.length} matched (${Math.round((matchedCount / examples.length) * 100)}%) ---`);
  if (notMatched.length > 0) {
    console.log(`Missed ${notMatched.length} examples:`);
    notMatched.forEach((ex) => console.log(`  - ${ex}`));
  }
}

// runBenchmark("English", "en", examples_en);
// runBenchmark("Arabic", "ar", examples_ar);
// runBenchmark("Farsi", "fa", examples_fa);


examples_en.forEach((example, idx) => {
    const result: AnalyzeTextResult = analyzeText(example, "en");
    console.log(result);
  });