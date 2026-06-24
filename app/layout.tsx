import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Citizen Feedback — Water Management",
  description:
    "A short, anonymous survey about digital technology in water management. Your answers help research; the chatbot gives no advice.",
};

// The <html lang/dir> is intentionally generic here; the survey shell sets the
// active language and text direction per the participant's choice.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
