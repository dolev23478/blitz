# כלי הפוסטים לדוגמה (sample-feed)

הכלי מזין פוסטים קבועים מקובץ JSON לרכיבים של BLITZ במקום האוספים, בלי גישה לטלגרם, ל־X או לרשת. הוא מחליף רק את שלב האיסוף.
הכלי בונה **Nest application context** מהמודולים של הצוות (לא `AppModule`, ולכן האיסוף לא מופעל) ומריץ כל פוסט דרך הרכיבים האמיתיים.

```
פוסט מהקובץ ─► זיהוי שפה ─► TextAnalyzer (סינון) ─► TransformerWorkflow: מיפוי ← ולידציה ← שליחה
               לאוניד*       לאוניד                 יואב                               יואב / מקומי
```
\* תחליף מקומי, עד שהמודל של לאוניד ימוזג.

## הרצה

```bash
npm install

# מקומי (ברירת מחדל): רק PublishingProcessor מוחלף ברושם מקומי, לא נשלח דבר לקפקא
npm run samples

# קובץ אחר / תרחיש (תגית ב־tags) / מילון אחר
npm run samples -- --file samples/invalid-posts.json
npm run samples -- --scenario duplicate
npm run samples -- --dictionaries ./dictionaries --quiet
npm run samples -- --report run.json        # גם תוצאות כ־JSON

# שליחה אמיתית ל־reports.raw עם הגדרות KAFKA_* מ־.env (ראו .env.example)
npm run samples -- --publish --dictionaries ./dictionaries

# בדיקות הכלי, כולל ריצה מקצה לקצה של ה־CLI דרך ה־application context
npm run test:samples
```

`npm run samples` מריץ קודם `nest build`. ה־transformer מקבל את התלויות שלו לפי טיפוס, ולכן Nest צריך decorator metadata שרק tsc מייצר (tsx ו־vitest לא מייצרים אותו).

התגיות ב־`samples/posts.json`: `telegram`, `x`, `he`, `ar`, `en`, `mixed-language`, `text`, `photo`, `video`, `mixed-media`, `multi-match`, `missing-optional`, `passes`, `filtered`, `duplicate`.

קודי יציאה: `0` הכול תקין; `1` קלט לא תקין, כישלון או סטייה מהציפייה; `2` לא ניתן להריץ.

## מה מודפס

- **לכל דוגמה:** `processed`, `filtered out` או `FAILED at <שלב>` (למשל `transformer/validation_failed`), עם השפה, ההתאמות, **מפתח קפקא** וההודעה כפי שהייתה נשלחת.
- **`Components:`:** מציין לכל שלב אם הוא `team`, `stand-in` או `missing`.
- **`≠ schemas.html`:** שדות שבהם ההודעה שהמערכת מייצרת שונה מרשימת השדות ב־schemas.html (19.10). זו השוואה בלבד. הוולידציה עצמה היא של יואב (provisional, או גם מול JSON Schema של DE אם `DE_RAW_REPORT_SCHEMA_PATH` מוגדר).
- **סיכום:** כמה נקראו, קלט לא תקין, נפסלו בסינון, כפולות, נכשלו ו־processed. ה־processed מחולק ל־`local only` ול־`confirmed by Kafka`, שנספר רק כשקפקא החזירה אישור. כפולות מוצגות כ־"not detectable" כל עוד אין רכיב dedup.

## קובצי הדוגמאות

- [`samples/posts.json`](../samples/posts.json): 14 דוגמאות **בפורמט שהאוספים עצמם מחזירים**:
  - `"format": "StoredMessage"`: טלגרם, `src/types.ts`.
  - `"format": "ProfileScrapeResult"`: X עם פוסט אחד, `src/x-scraper/contracts`.

  הכלי מעביר את `post` כמו שהוא ל־`TransformerWorkflow.run(format, post, { language, matches })`. השדה `expect` משמש רק להשוואה אחרי ההרצה.
- [`samples/invalid-posts.json`](../samples/invalid-posts.json): תרחיש קלט לא תקין. כל שגיאה מציינת דוגמה ושדה, למשל `sample "invalid-x-media-type", field post.posts[0].media[0].type`. בקובץ יש גם דוגמה שעוברת את בדיקת הקלט ונפסלת אצל יואב (HTML בתוכן), ודוגמה תקינה שרצה כרגיל.
- [`samples/dictionaries/`](../samples/dictionaries/): מילון **דמה** בפורמט של לאוניד. המילון האמיתי נמצא ב־`/dictionaries`, שמוחרג ב־.gitignore, ונבחר עם `--dictionaries` או עם `DICTIONARIES_DIR`.

כל המקורות והכתובות הם דמה (`fixtures.blitz.invalid`). אסור לשים בפוסט `language`, `matches` או `report_id`: ה־mapping של יואב משתמש ב־`language` שנמצא בפוסט כמו שהוא, וזה היה עוקף את זיהוי השפה. אותו פוסט פעמיים = שתי דוגמאות עם `id` שונה ואותו `url`.

## החיבור לתהליך (גל)

[`src/sample-feed/context.ts`](../src/sample-feed/context.ts) הוא נקודת החיבור:

- **`SampleFeedHostModule`** מכיל את `ConfigModule` (.env) ואת `TransformerModule`. כשיהיה מודול אינטגרציה של גל, מוסיפים אותו כאן.
- **במצב מקומי** הכלי משתמש ב־`Test.createTestingModule(...).overrideProvider(PublishingProcessor)`. זה application context של Nest שמחליף ספק אחד בתוך מודול מיובא. כל שאר הספקים הם האמיתיים.
- **ב־`--publish`** הכלי משתמש ב־`NestFactory.createApplicationContext` בלי שום החלפה.
- **`teamComponents.integration`:** עד שהאינטגרציה של גל תהיה זמינה, רצה [`integration.ts`](../src/sample-feed/integration.ts). הקובץ רק קורא לרכיבים לפי הסדר ולא מוסיף לוגיקה. כשהאינטגרציה של גל תמוזג, מחברים אותה כאן.
- **דרישה מהאינטגרציה של גל:** לשלוח לקפקא רק דרך `PublishingProcessor`, ולגשת ל־dedup דרך ספק Nest, כדי שההרצה המקומית תוכל להחליף את שניהם ולא לסמן דוגמאות במאגר המשותף.
- **`teamComponents.detectLanguage`:** כאן מחברים את המודל של לאוניד.

`--publish` מסרב לרוץ (לא נשלח דבר) כל עוד זיהוי השפה הוא תחליף או שהמילון הוא מילון הדמה, או כש־`KAFKA_BROKERS` לא מוגדר.
**שימו לב:** מה שנשלח ל־reports.raw אינו מסומן כנתוני תרגול. DE מוסיף `reality_id = 0`. יש לתאם עם DE לפני הרצת `--publish`.

## מצב הרכיבים (dev, 20.10.2026)

| שלב | אחראי | בכלי |
|---|---|---|
| אינטגרציה | גל | חסר → `integration.ts` זמני |
| זיהוי שפה | לאוניד | חסר → תחליף לפי ספירת אותיות (he/ar/en) |
| סינון | לאוניד | `TextAnalyzer` אמיתי |
| מילון | לאוניד | לא במאגר (`/dictionaries` ב־.gitignore) → מילון דמה |
| מיפוי + ולידציה + `report_id` | יואב | `TransformerModule` אמיתי |
| מניעת כפילויות (Redis) | יואב | חסר: הפוסט הכפול נשלח פעמיים, עם אותו מפתח |
| שליחה | יואב | `PublishingProcessor` אמיתי ב־`--publish`, רושם מקומי במצב רגיל |

## פערים שהכלי מראה (לא שיניתי חוזה משותף)

1. **`report_id`:** הוא int32 עם סימן (`src/transformer/report-id.ts`) והערכים יוצאים גם שליליים, בעוד שהחוזה מגדיר int64. הסיכוי להתנגשות גבוה, והייחודיות מול Atlas לא תואמה.
2. **`schema_version`:** הערך הוא `"1.0.0"`, מחרוזת, בעוד שהחוזה מגדיר מספר שלם של גרסה ראשית.
3. **`channel_name` ב־X:** הערך הוא `null`, בעוד שהחוזה מגדיר string. ב־transformer גם `account_name` מוגדר כ־nullable.
4. **`language`:** ה־transformer מקבל `unknown` כשאין שפה, בעוד שהחוזה מגדיר ISO 639-1.
5. **`media_type`:** ה־transformer מעביר גם `document`, `audio`, `other` ו־`animated_gif`, בעוד שהחוזה מתיר רק `text`, `photo` ו־`video`.
6. **`platform`:** ב־X הערך הוא `twitter` וב־Telegram `telegram`. כדאי לוודא שזה השם הסופי.
7. **סדר השלבים:** `TextAnalyzer` צריך לקבל את השפה כקלט, ולכן זיהוי השפה רץ **לפני** הסינון ולא אחריו כמו בתוכנית.
