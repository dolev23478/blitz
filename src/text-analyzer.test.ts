import assert from 'node:assert/strict';
import {
  analyzeText,
  analyzeBatch,
  getDictionaryStore,
  getNormalizer,
} from './index.js';
import { it } from 'vitest';

it('normalizes and matches the production multilingual dictionaries', () => {
  const store = getDictionaryStore();
  assert.ok(store.getIndex('en'), 'English dictionary must load');
  assert.ok(store.getIndex('ar'), 'Arabic dictionary must load');
  assert.ok(store.getIndex('fa'), 'Farsi dictionary must load');
  assert.ok(store.getIndex('he'), 'Hebrew dictionary must load');

  // 1. English tests
  const english = analyzeText('I will KILL the jews with a bomb!!!', 'en');
  assert.equal(english.matched, true);
  assert.equal(english.text, 'I will KILL the jews with a bomb!!!');
  assert.equal(english.content, 'I will KILL the jews with a bomb!!!');
  assert.ok(english.terms.includes('kill'));
  assert.ok(english.terms.includes('bomb'));
  assert.ok(english.terms.includes('i will kill the jews'));

  const englishPlural = analyzeText('The attacks were planned', 'en');
  assert.equal(englishPlural.matched, true);
  assert.ok(
    englishPlural.terms.includes('attacks') ||
      englishPlural.terms.includes('attack'),
  );

  const boundary = analyzeText('This skill is useful', 'en');
  assert.equal(boundary.terms.includes('kill'), false);

  const hyphen = analyzeText('That dirty-jew slur', 'en');
  assert.ok(
    hyphen.terms.includes('dirty-jew') || hyphen.terms.includes('dirty jew'),
  );

  const unknown = analyzeText('hello', 'xx');
  assert.equal(unknown.matched, false);
  assert.equal(unknown.issues[0]?.code, 'NO_DICTIONARIES');

  // 2. Arabic tests
  const arabicExact = analyzeText('اقتل', 'ar');
  assert.ok(arabicExact.terms.includes('اقتل'));

  const arabicDiacritics = analyzeText('اُقْتُلْ', 'ar');
  assert.ok(arabicDiacritics.terms.includes('اقتل'));

  const arabicClitics = analyzeText('واقتلوهم', 'ar');
  assert.ok(
    arabicClitics.terms.includes('اقتلوهم') ||
      arabicClitics.terms.includes('اقتل'),
  );

  const arabicArticle = analyzeText('القتل ممنوع', 'ar');
  assert.ok(arabicArticle.matched);

  const arabizi = analyzeText('o8tlohom', 'ar');
  assert.ok(
    arabizi.matched,
    `expected Arabizi match, got terms=${arabizi.terms.join(',')}`,
  );

  // 3. Farsi tests
  const farsiExact = analyzeText('یک تهدید وجود دارد', 'fa');
  assert.equal(farsiExact.matched, true, 'Farsi exact match should succeed');
  assert.ok(farsiExact.terms.includes('تهدید'));

  const farsiZwnj = analyzeText('تهدید‌ها را جدی بگیرید', 'fa');
  assert.equal(
    farsiZwnj.matched,
    true,
    'Farsi ZWNJ plural should match base term',
  );
  assert.ok(
    farsiZwnj.terms.includes('تهدید') || farsiZwnj.terms.includes('تهدیدها'),
  );

  const farsiIndefinite = analyzeText('این پیام شامل تهدیدی جدی است', 'fa');
  assert.equal(
    farsiIndefinite.matched,
    true,
    'Farsi indefinite suffix (-i) should match base term',
  );
  assert.ok(farsiIndefinite.terms.includes('تهدید'));

  const farsiPluralEzafe = analyzeText(
    'این گزارش درباره تهدیدهای یک گروه است',
    'fa',
  );
  assert.equal(
    farsiPluralEzafe.matched,
    true,
    'Farsi plural+ezafe (-haye) should match base term',
  );
  assert.ok(farsiPluralEzafe.terms.includes('تهدید'));

  const farsiArabicChars = analyzeText('يك تهديد صريح', 'fa'); // Arabic kaf and yeh
  assert.equal(
    farsiArabicChars.matched,
    true,
    'Farsi should normalize Arabic Kaf/Yeh',
  );
  assert.ok(farsiArabicChars.terms.includes('تهدید'));

  const farsiLoanwordPlural = analyzeText('جلوگیری از حملات تروریستی', 'fa');
  assert.equal(
    farsiLoanwordPlural.matched,
    true,
    'Farsi -at plural should match base form',
  );
  assert.ok(
    farsiLoanwordPlural.terms.includes('حمله') ||
      farsiLoanwordPlural.terms.includes('تروریستی'),
  );

  // 4. Hebrew tests
  const hebrewNorm = getNormalizer('he');
  assert.equal(hebrewNorm.language, 'he');

  // Test Niqqud removal
  const withoutNiqqud = hebrewNorm.normalize('פִּגּוּעַ');
  assert.equal(withoutNiqqud, 'פגוע');

  // Test acronym quote removal (prevents acronym splitting)
  const acronymClean = hebrewNorm.normalize('ארגון צה"ל וגורמי אמל"ח');
  assert.deepEqual(hebrewNorm.tokenize(acronymClean), [
    'ארגון',
    'צהל',
    'וגורמי',
    'אמלח',
  ]);

  // Test prefix & suffix stripping with sofit conversion
  const hebrewVariants1 = hebrewNorm.tokenVariants('והמחבלים');
  assert.ok(hebrewVariants1.includes('מחבל'), 'והמחבלים should yield מחבל');

  const hebrewVariants2 = hebrewNorm.tokenVariants('בפיגוע');
  assert.ok(hebrewVariants2.includes('פיגוע'), 'בפיגוע should yield פיגוע');

  const hebrewVariants3 = hebrewNorm.tokenVariants('סכינים');
  assert.ok(hebrewVariants3.includes('סכין'), 'סכינים should yield sofit סכין');

  const hebrewVariants4 = hebrewNorm.tokenVariants('פיצוצים');
  assert.ok(
    hebrewVariants4.includes('פיצוץ'),
    'פיצוצים should yield sofit פיצוץ',
  );

  const hebrewVariants5 = hebrewNorm.tokenVariants('מתקפות');
  assert.ok(hebrewVariants5.includes('מתקפה'), 'מתקפות should yield מתקפה');

  const hebrewVariants6 = hebrewNorm.tokenVariants('מתקפת');
  assert.ok(
    hebrewVariants6.includes('מתקפה'),
    'מתקפת construct should yield מתקפה',
  );

  const hebrewAnalyzeExact = analyzeText('פיגוע טרור', 'he');
  assert.equal(hebrewAnalyzeExact.matched, true);
  assert.ok(
    hebrewAnalyzeExact.terms.includes('פיגוע') ||
      hebrewAnalyzeExact.terms.includes('טרור'),
  );

  const hebrewAnalyzeClitics = analyzeText('והטרוריסטים ביצעו מתקפה', 'he');
  assert.equal(hebrewAnalyzeClitics.matched, true);
  assert.ok(
    hebrewAnalyzeClitics.terms.includes('טרוריסטים') ||
      hebrewAnalyzeClitics.terms.includes('טרוריסט') ||
      hebrewAnalyzeClitics.terms.includes('מתקפה'),
  );

  // 5. Options and Batch tests
  const batchRes = analyzeBatch(['I will kill', 'peaceful greeting'], 'en');
  assert.equal(batchRes.length, 2);
  assert.equal(batchRes[0]?.matched, true);
  assert.equal(batchRes[1]?.matched, false);

  const filtered = analyzeText('I will kill the jews with a bomb', 'en', {
    concepts: ['violence.killing'],
  });
  assert.ok(filtered.terms.includes('kill'));
  assert.equal(
    filtered.matches.every((m) => m.concept?.startsWith('violence.killing')),
    true,
  );

  const capped = analyzeText('I will kill the jews with a bomb', 'en', {
    maxMatches: 1,
  });
  assert.equal(capped.matches.length, 1);

  // 6. Emoji token preservation test
  const englishNorm = getNormalizer('en');
  const emojiText = englishNorm.normalize('Attack with 🔪 and 💣');
  const emojiTokens = englishNorm.tokenize(emojiText);
  assert.ok(emojiTokens.includes('🔪'), 'Emoji 🔪 should be preserved');
  assert.ok(emojiTokens.includes('💣'), 'Emoji 💣 should be preserved');
});
