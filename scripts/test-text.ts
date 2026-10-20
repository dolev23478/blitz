import { analyzeText } from "../src/index.js";

const args = process.argv.slice(2);
const text = args[0];
const lang = args[1] && !args[1].startsWith("--") ? args[1] : "auto";

const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1] as any || "category_filter";

if (!text) {
  console.log("Usage: npx tsx scripts/test-text.ts \"<text to analyze>\" [language] [--mode=basic|category_filter|smart]");
  console.log("Examples:");
  console.log("  npx tsx scripts/test-text.ts \"I will kill with 💣\"");
  console.log("  npx tsx scripts/test-text.ts \"محطة بيع بنзин وغاز\" ar --mode=category_filter");
  console.log("  npx tsx scripts/test-text.ts \"سأحرق المبنى بالبنزين\" ar --mode=smart");
  process.exit(1);
}

console.log(`\nAnalyzing [${lang}] (mode: ${modeArg}): "${text}"\n`);
const result = analyzeText(text, lang, { mode: modeArg });
console.log("--- RESULT ---");
console.log(`Matched:      ${result.matched ? "YES 🚨" : "NO ⚪"}`);
console.log(`Languages:    ${result.languages?.join(", ") || result.language}`);
console.log(`Terms found:  [${result.terms.join(", ")}]`);
console.log(`Used files:   [${result.usedSources.join(", ")}]`);

if (result.evaluation) {
  console.log(`Risk Level:   ${result.evaluation.riskLevel.toUpperCase()}`);
  console.log(`Risk Score:   ${result.evaluation.riskScore} / 100`);
  if (result.evaluation.flaggedReasons.length > 0) {
    console.log(`Reasons:      ${result.evaluation.flaggedReasons.join(", ")}`);
  }
}

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
