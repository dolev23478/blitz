import { analyzeText } from "../src/index.js";

const args = process.argv.slice(2);
const text = args[0];
const lang = args[1] || "auto";

if (!text) {
  console.log("Usage: npx tsx scripts/test-text.ts \"<text to analyze>\" [language]");
  console.log("Examples:");
  console.log("  npx tsx scripts/test-text.ts \"I will kill with 💣\"");
  console.log("  npx tsx scripts/test-text.ts \"פיגוע טרור בישראל\"");
  console.log("  npx tsx scripts/test-text.ts \"أريد تنفيذ هجوم\"");
  console.log("  npx tsx scripts/test-text.ts \"این یک تهدید است\"");
  process.exit(1);
}

console.log(`\nAnalyzing [${lang}]: "${text}"\n`);
const result = analyzeText(text, lang);
console.log("--- RESULT ---");
console.log(`Matched:      ${result.matched ? "YES 🚨" : "NO ⚪"}`);
console.log(`Languages:    ${result.languages?.join(", ") || result.language}`);
console.log(`Terms found:  [${result.terms.join(", ")}]`);
console.log(`Used files:   [${result.usedSources.join(", ")}]`);

if (result.matches.length > 0) {
  console.log("\nMatches details:");
  result.matches.forEach((m, idx) => {
    console.log(
      `  #${idx + 1}: "${m.term}" -> concept: "${m.concept || "none"}" (from: ${m.sourceFile}, tokens: ${m.tokenStart}..${m.tokenEnd})`,
    );
  });
}

if (result.issues.length > 0) {
  console.log("\nIssues:");
  result.issues.forEach((i) => console.log(`  - [${i.code}] ${i.message}`));
}
console.log("");
