"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ChatSurvey from "@/components/ChatSurvey";
import { getLang } from "@/lib/client";
import type { Lang } from "@/lib/types";

export default function SurveyPage() {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => setLang(getLang()), []);
  return (
    <Shell lang={lang}>
      <ChatSurvey />
    </Shell>
  );
}
