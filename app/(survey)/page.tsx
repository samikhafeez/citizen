"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { t } from "@/lib/i18n";
import { getLang, setLang } from "@/lib/client";
import type { Lang } from "@/lib/types";

export default function Landing() {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => setLangState(getLang()), []);

  function choose(l: Lang) {
    setLang(l);
    setLangState(l);
  }

  return (
    <Shell lang={lang}>
      <div className="card">
        <h2 className="title">{t(lang, "landing_welcome")}</h2>
        <p className="lead">{t(lang, "landing_intro")}</p>
        <p className="notice">🔒 {t(lang, "landing_anonymous")}</p>
      </div>

      <div className="card">
        <p className="lead" style={{ marginBottom: 8 }}>
          {t(lang, "choose_language")}
        </p>
        <div className="lang-grid">
          <button
            className="lang-btn"
            style={lang === "en" ? { borderColor: "var(--blue)", background: "var(--blue-light)" } : {}}
            onClick={() => choose("en")}
          >
            English
          </button>
          <button
            className="lang-btn"
            style={lang === "ar" ? { borderColor: "var(--blue)", background: "var(--blue-light)" } : {}}
            onClick={() => choose("ar")}
          >
            العربية
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => router.push("/consent")}>
            {t(lang, "continue")}
          </button>
        </div>
      </div>
    </Shell>
  );
}
