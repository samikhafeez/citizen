// Resident-facing (public) segment. No login. The Shell component inside each
// page applies the header, footer and RTL/LTR direction for the chosen language.
export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
