import { exit } from "node:process";
import { analyzeText } from "./index.js";

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
  "The post warns that the conflict will continue and contains threatening language."


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
    "لا ينبغي الخلط بين انتقاد الحكومة والتحريض على قتل المدنيين."

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
    "هدف این برنامه شناسایی پیام‌های تهدیدآمیز و جلوگیری از حملات است."
];


const notMatched: string[] = [];

examples_en.forEach(example => {
    const result = analyzeText(example, "en");
    console.log(result);
    if (!result.matched) {
        notMatched.push(example);
    }
});
// result.matched, result.terms, result.matches, result.issues

console.log(notMatched);