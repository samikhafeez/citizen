"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { t } from "@/lib/i18n";
import { getLang } from "@/lib/client";
import type { Lang } from "@/lib/types";

// Standalone "How your answers are used" page (also available as a modal everywhere).
export default function Info() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => setLang(getLang()), []);
  return (
    <Shell lang={lang}>
      <div className="card">
        <h2 className="title">{t(lang, "data_use_title")}</h2>
        <p className="lead">{t(lang, "data_use_body")}</p>
        <button className="btn btn-secondary" onClick={() => router.back()}>
          {t(lang, "back")}
        </button>
      </div>
    </Shell>
  );
}
