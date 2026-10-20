import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDictionaryFile } from "../src/dictionaries/schema.js";
import type { DictionaryEntry } from "../src/types.js";

// Specific term overrides for dual-use and temporal words
const TERM_OVERRIDES: Record<string, string> = {
  // Gasoline / Petrol / Cooking gas
  "بنزين": "context.dual_use_material",
  "بنزین": "context.dual_use_material",
  "غاز": "context.dual_use_material",
  "gasoline": "context.dual_use_material",
  "petrol": "context.dual_use_material",
  "diesel": "context.dual_use_material",
  "kerosene": "context.dual_use_material",
  "סולר": "context.dual_use_material",
  "בנזין": "context.dual_use_material",
  "דלק": "context.dual_use_material",

  // Temporal words
  "امروز": "context.temporal",
  "اليوم": "context.temporal",
  "غدا": "context.temporal",
  "فردا": "context.temporal",
  "today": "context.temporal",
  "tomorrow": "context.temporal",
  "היום": "context.temporal",
  "מחר": "context.temporal",
};

// Canonical Category Mapping
export const CANONICAL_CATEGORIES = new Set([
  // Weapon
  "weapon.firearm",
  "weapon.explosive",
  "weapon.missile_rocket",
  "weapon.drone",
  "weapon.blade",
  "weapon.cbrn",
  "weapon.ammunition",
  "weapon.military",
  "weapon.general",

  // Violence
  "violence.terrorism",
  "violence.killing",
  "violence.assault",
  "violence.kidnapping",
  "violence.explosion",
  "violence.arson",
  "violence.torture",
  "violence.genocide",
  "violence.general",

  // Threat
  "threat.direct",
  "threat.intimidation",
  "threat.retaliation",
  "threat.annihilation",
  "threat.general",

  // Target
  "target.israel",
  "target.israel_location",
  "target.israel_institution",
  "target.jewish",
  "target.civilian",
  "target.military",
  "target.infrastructure",
  "target.general",

  // Hate
  "hate.antisemitism",
  "hate.anti_israel",
  "hate.extremist_group",
  "hate.dehumanization",
  "hate.slur",
  "hate.neonazi",
  "hate.general",

  // Context
  "context.conflict",
  "context.alert",
  "context.slang",
  "context.temporal",
  "context.dual_use_material",
  "context.general",
]);

export function mapToCanonicalCategory(concept: string | undefined, term: string): string {
  const cleanTerm = term.trim().toLowerCase();
  if (TERM_OVERRIDES[cleanTerm]) {
    return TERM_OVERRIDES[cleanTerm];
  }

  if (!concept) {
    return "context.general";
  }

  const c = concept.trim().toLowerCase();

  // 1. WEAPONS
  if (
    c.startsWith("weapons.firearm") ||
    c.startsWith("weapon.firearm") ||
    c === "weapon.rifle" ||
    c === "violence.shooting" ||
    c === "violence.weapon.gun"
  ) {
    return "weapon.firearm";
  }

  if (
    c.startsWith("weapons.explosive") ||
    c.startsWith("weapon.explosive") ||
    c === "violence.bombing" ||
    c === "terrorism.suicide_bomber"
  ) {
    return "weapon.explosive";
  }

  if (
    c.startsWith("weapons.missile") ||
    c.startsWith("weapon.missile") ||
    c.includes("rocket")
  ) {
    return "weapon.missile_rocket";
  }

  if (c.startsWith("weapons.drone") || c.startsWith("weapon.drone")) {
    return "weapon.drone";
  }

  if (
    c.startsWith("weapons.melee") ||
    c.startsWith("weapon.blade") ||
    c === "weapon.knife" ||
    c.startsWith("weapon.blunt") ||
    c === "violence.stabbing" ||
    c.includes("blade") ||
    c.includes("axe")
  ) {
    return "weapon.blade";
  }

  if (
    c.startsWith("weapons.cbrn") ||
    c.startsWith("weapon.chemical") ||
    c.startsWith("weapon.biological") ||
    c.startsWith("weapon.radiological") ||
    c === "violence.poisoning"
  ) {
    return "weapon.cbrn";
  }

  if (c.startsWith("weapon.ammunition")) {
    return "weapon.ammunition";
  }

  if (c.startsWith("weapon.military") || c.includes("military_vehicle")) {
    return "weapon.military";
  }

  if (c.startsWith("weapon.") || c.startsWith("weapons.")) {
    return "weapon.general";
  }

  // 2. VIOLENCE
  if (
    c.startsWith("terrorism.") ||
    c === "violence.terrorism" ||
    c === "conflict.israel_terror" ||
    c.includes("terror")
  ) {
    return "violence.terrorism";
  }

  if (
    c === "violence.kill" ||
    c === "violence.killing" ||
    c === "violence.death" ||
    c === "violence.massacre" ||
    c === "violence.assassination" ||
    c === "violence.beheading" ||
    c.includes("beheading") ||
    c === "violence.strangulation" ||
    c === "violence.dismemberment" ||
    c === "violence.lynching" ||
    c === "violence.stoning" ||
    c === "violence.crucifixion"
  ) {
    return "violence.killing";
  }

  if (
    c === "violence.assault" ||
    c === "violence.attack" ||
    c === "violence.beating" ||
    c === "violence.sexual_assault" ||
    c === "violence.sexual_violence" ||
    c === "violence.rape" ||
    c === "violence.bodily_harm" ||
    c === "violence.injury"
  ) {
    return "violence.assault";
  }

  if (
    c === "violence.kidnapping" ||
    c === "violence.abduction" ||
    c === "violence.hostage" ||
    c === "target.hostage"
  ) {
    return "violence.kidnapping";
  }

  if (c === "violence.explosion" || c.includes("explosion")) {
    return "violence.explosion";
  }

  if (
    c === "violence.arson" ||
    c === "violence.burning" ||
    c === "violence.fire" ||
    c === "weapon.incendiary"
  ) {
    return "violence.arson";
  }

  if (c === "violence.torture") {
    return "violence.torture";
  }

  if (
    c === "violence.genocide" ||
    c === "violence.holocaust" ||
    c === "violence.extermination" ||
    c === "violence.ethnic_cleansing"
  ) {
    return "violence.genocide";
  }

  if (c.startsWith("violence.")) {
    return "violence.general";
  }

  // 3. THREATS
  if (
    c === "intent.annihilation" ||
    c.includes("annihilation")
  ) {
    return "threat.annihilation";
  }

  if (
    c === "violence.retribution" ||
    c === "intent.retribution" ||
    c === "intent.revenge" ||
    c === "violence.reprisal_idiom" ||
    c === "violence.retaliation" ||
    c.includes("revenge")
  ) {
    return "threat.retaliation";
  }

  if (
    c === "threat.intimidation" ||
    c.includes("intimidation") ||
    c.includes("warning")
  ) {
    return "threat.intimidation";
  }

  if (
    c === "intent.threat" ||
    c === "threat.explicit" ||
    c === "threat.death" ||
    c === "intent.death_call" ||
    c === "intent.call_to_violence" ||
    c === "intent.violent_command" ||
    c === "slang.threat" ||
    c === "threat.planned_attack" ||
    c.startsWith("threat.") ||
    c.startsWith("intent.")
  ) {
    return "threat.direct";
  }

  // 4. TARGETS
  if (c === "target.israel_location" || c === "target.israeli_city") {
    return "target.israel_location";
  }

  if (
    c === "target.israel_institution" ||
    c === "target.israeli_government" ||
    c === "target.israeli_mission" ||
    c === "target.israeli_venue" ||
    c === "target.israeli_cultural_site"
  ) {
    return "target.israel_institution";
  }

  if (
    c === "target.israel" ||
    c === "target.israeli_civilian" ||
    c === "target.zionism" ||
    c === "target.zionist" ||
    c === "targeting.israel"
  ) {
    return "target.israel";
  }

  if (
    c === "target.jew" ||
    c === "target.jewish" ||
    c === "target.jewish_institution" ||
    c === "target.synagogue" ||
    c.includes("jewish")
  ) {
    return "target.jewish";
  }

  if (c === "target.civilian" || c === "target.civilians" || c.includes("civilian")) {
    return "target.civilian";
  }

  if (
    c === "target.soldier" ||
    c === "target.military" ||
    c === "target.security_force" ||
    c === "target.israeli_security"
  ) {
    return "target.military";
  }

  if (
    c.includes("building") ||
    c.includes("school") ||
    c.includes("hospital") ||
    c.includes("airport") ||
    c.includes("embassy") ||
    c.includes("infrastructure")
  ) {
    return "target.infrastructure";
  }

  if (c.startsWith("target.") || c.startsWith("targeting.")) {
    return "target.general";
  }

  // 5. HATE SPEECH
  if (
    c.includes("antisemitic") ||
    c.includes("antisemitism") ||
    c.includes("holocaust_denial")
  ) {
    return "hate.antisemitism";
  }

  if (c.includes("anti_israel")) {
    return "hate.anti_israel";
  }

  if (
    c.includes("neonazi") ||
    c.includes("nazi")
  ) {
    return "hate.neonazi";
  }

  if (c.includes("dehumanization")) {
    return "hate.dehumanization";
  }

  if (
    c.includes("slur") ||
    c.includes("insult") ||
    c.includes("profanity")
  ) {
    return "hate.slur";
  }

  if (c.includes("proxy") || c.includes("organization") || c.includes("militant")) {
    return "hate.extremist_group";
  }

  if (c.startsWith("hate.") || c.startsWith("hate_speech.")) {
    return "hate.general";
  }

  // 6. CONTEXT
  if (c.includes("alert") || c.includes("siren") || c.includes("warning")) {
    return "context.alert";
  }

  if (c.includes("slang") || c.includes("arabizi") || c.includes("obfuscation")) {
    return "context.slang";
  }

  if (c.includes("timing") || c.includes("temporal") || c.includes("date")) {
    return "context.temporal";
  }

  if (c.includes("conflict") || c.includes("revolution") || c.includes("grievance")) {
    return "context.conflict";
  }

  return "context.general";
}

export function runCategoryStandardization(applyChanges = false) {
  const dir = "dictionaries";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const backupDir = "dictionaries_backup_before_canonical";

  if (applyChanges && !existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
    for (const file of files) {
      copyFileSync(join(dir, file), join(backupDir, file));
    }
    console.log(`Created backup of dictionaries in: ${backupDir}\n`);
  }

  console.log("================================================================");
  console.log(` STANDARDIZING CATEGORIES [${applyChanges ? "APPLY" : "DRY RUN"}]`);
  console.log("================================================================\n");

  for (const fileName of files) {
    const filePath = join(dir, fileName);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    const parsed = parseDictionaryFile(content, fileName);

    const oldConcepts = new Set<string>();
    const newConcepts = new Set<string>();

    const mergedEntries = new Map<string, DictionaryEntry>();
    const rawTermsBefore = new Set<string>();

    for (const entry of parsed.entries) {
      rawTermsBefore.add(entry.term.trim().toLowerCase());
      if (entry.concept) oldConcepts.add(entry.concept);

      const canonicalConcept = mapToCanonicalCategory(entry.concept, entry.term);
      newConcepts.add(canonicalConcept);

      const key = `${entry.term.trim().toLowerCase()}:::${canonicalConcept}`;
      if (!mergedEntries.has(key)) {
        mergedEntries.set(key, {
          term: entry.term.trim(),
          concept: canonicalConcept,
          ...(entry.extra ? { extra: entry.extra } : {}),
        });
      }
    }

    const finalEntries = [...mergedEntries.values()].sort((a, b) =>
      a.term.localeCompare(b.term, undefined, { sensitivity: "base" }),
    );

    const termsAfter = new Set<string>(finalEntries.map((e) => e.term.trim().toLowerCase()));
    let lost = 0;
    for (const t of rawTermsBefore) {
      if (!termsAfter.has(t)) lost++;
    }

    console.log(`----------------------------------------------------------------`);
    console.log(`File: [${fileName}] (${parsed.language.toUpperCase()})`);
    console.log(`  Raw entries:          ${parsed.entries.length.toLocaleString()}`);
    console.log(`  Unique terms:         ${termsAfter.size.toLocaleString()}`);
    console.log(`  Entries after dedupe: ${finalEntries.length.toLocaleString()}`);
    console.log(`  Concepts before:      ${oldConcepts.size} variants`);
    console.log(`  Concepts after:       ${newConcepts.size} canonical`);
    console.log(`  Word retention:       ${lost === 0 ? "✅ 100% (0 words lost)" : `🚨 ${lost} LOST`}`);

    if (applyChanges) {
      const output = {
        language: parsed.language,
        entries: finalEntries,
      };
      writeFileSync(filePath, JSON.stringify(output, null, 2), "utf-8");
    }
  }

  console.log("\n================================================================\n");
}

const isApply = process.argv.includes("--apply");
runCategoryStandardization(isApply);
