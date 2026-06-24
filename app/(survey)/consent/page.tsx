"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { t } from "@/lib/i18n";
import { api, getLang, setSessionId, getSessionId, clearSession } from "@/lib/client";
import type { Lang } from "@/lib/types";

export default function Consent() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => setLang(getLang()), []);

  async function agree() {
    setBusy(true);
    // Start a fresh pseudonymous session, then record consent.
    clearSession();
    const started = await api("start", { language: getLang() });
    if (started?.sessionId) {
      setSessionId(started.sessionId);
      await api("consent", { sessionId: started.sessionId, agreed: true });
      router.push("/survey");
    } else {
      setBusy(false);
    }
  }

  async function decline() {
    const sid = getSessionId();
    if (sid) await api("consent", { sessionId: sid, agreed: false });
    setDeclined(true);
  }

  return (
    <Shell lang={lang}>
      <div className="card">
        <h2 className="title">{t(lang, "consent_title")}</h2>
        <p className="lead">{t(lang, "consent_body")}</p>

        {!declined ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={agree}>
              {busy ? t(lang, "loading") : t(lang, "consent_agree")}
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={decline}>
              {t(lang, "consent_decline")}
            </button>
          </div>
        ) : (
          <div>
            <p className="notice">{t(lang, "consent_required")}</p>
            <button className="btn btn-secondary" onClick={() => router.push("/")}>
              {t(lang, "back")}
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}
