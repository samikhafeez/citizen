"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { t } from "@/lib/i18n";
import { getLang, clearSession } from "@/lib/client";
import type { Lang } from "@/lib/types";

export default function Complete() {
  return (
    <Suspense fallback={null}>
      <CompleteInner />
    </Suspense>
  );
}

function CompleteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const stopped = params.get("stopped") === "1";
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    setLang(getLang());
    if (!stopped) clearSession(); // completed: clear local resume cache
  }, [stopped]);

  return (
    <Shell lang={lang}>
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 6 }}>{stopped ? "🟦" : "✅"}</div>
        <h2 className="title">{t(lang, stopped ? "stopped_title" : "complete_title")}</h2>
        <p className="lead">{t(lang, stopped ? "stopped_body" : "complete_body")}</p>
        {!stopped && <p className="notice">{t(lang, "complete_withdraw")}</p>}

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {stopped && (
            <button className="btn btn-primary" onClick={() => router.push("/survey")}>
              {t(lang, "stopped_resume")}
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => {
              clearSession();
              router.push("/");
            }}
          >
            {t(lang, "restart")}
          </button>
        </div>
      </div>
    </Shell>
  );
}
