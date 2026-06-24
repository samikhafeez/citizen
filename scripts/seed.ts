/**
 * Seed the Supabase survey content tables from lib/survey-data.ts.
 *
 *   npm run seed
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from
 * .env.local). Run AFTER applying supabase/migrations/0001_init.sql.
 *
 * Idempotent: clears and re-inserts questions/options for this survey version.
 */
import { readFileSync } from "fs";
import path from "path";

// Minimal .env.local loader (no dotenv dependency).
function loadEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}
loadEnv();

// Imported after env is loaded so the client picks up the keys.
async function main() {
  const { SURVEY } = await import("../lib/survey-data");
  const { getServiceClient } = await import("../lib/supabase");
  const db = getServiceClient();

  // 1. survey version
  {
    const { error } = await db
      .from("survey_versions")
      .upsert({ id: SURVEY.version, label: SURVEY.version, active: true });
    if (error) throw error;
  }

  // 2. clear existing questions/options for this version (idempotent re-seed)
  const qIds = SURVEY.questions.map((q) => q.id);
  await db.from("question_options").delete().in("question_id", qIds);
  await db.from("questions").delete().eq("version_id", SURVEY.version);

  // 3. questions
  const questionRows = SURVEY.questions.map((q, i) => ({
    id: q.id,
    version_id: SURVEY.version,
    theme: q.theme,
    type: q.type,
    prompt_en: q.prompt.en,
    prompt_ar: q.prompt.ar,
    show_if: q.showIf ?? null,
    ord: i,
  }));
  {
    const { error } = await db.from("questions").insert(questionRows);
    if (error) throw error;
  }

  // 4. options
  const optionRows = SURVEY.questions.flatMap((q) =>
    (q.options ?? []).map((o, i) => ({
      question_id: q.id,
      value: o.value,
      label_en: o.label.en,
      label_ar: o.label.ar,
      ord: i,
    }))
  );
  if (optionRows.length) {
    const { error } = await db.from("question_options").insert(optionRows);
    if (error) throw error;
  }

  console.log(
    `Seeded survey ${SURVEY.version}: ${questionRows.length} questions, ${optionRows.length} options.`
  );
}

main().catch((e) => {
  console.error("Seed failed:", e.message || e);
  process.exit(1);
});
