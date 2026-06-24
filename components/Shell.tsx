"use client";
import { useEffect, useState } from "react";
import { t, dir } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/**
 * Survey shell: header (title + data-use notice), footer ("no advice"),
 * and it applies the correct text direction for the active language.
 */
export default function Shell({
  lang,
  children,
}: {
  lang: Lang;
  children: React.ReactNode;
}) {
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir(lang);
  }, [lang]);

  return (
    <div className="page" dir={dir(lang)}>
      <header className="app-header">
        <h1>{t(lang, "app_title")}</h1>
        <button className="btn-ghost" onClick={() => setShowNotice(true)}>
          ⓘ {t(lang, "data_use_link")}
        </button>
      </header>

      <main className="content">{children}</main>

      <footer className="app-footer">{t(lang, "no_advice_footer")}</footer>

      {showNotice && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setShowNotice(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 520, margin: 0 }}
            onClick={(e) => e.stopPropagation()}
            dir={dir(lang)}
          >
            <h2 className="title">{t(lang, "data_use_title")}</h2>
            <p className="lead">{t(lang, "data_use_body")}</p>
            <button className="btn btn-primary" onClick={() => setShowNotice(false)}>
              {t(lang, "continue")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
