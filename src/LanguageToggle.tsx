import { Languages } from "lucide-react";
import { useLocale } from "./i18n";

export function LanguageToggle() {
  const { locale, toggleLocale, t } = useLocale();
  const nextLabel = locale === "en" ? t("lang.shortAr") : t("lang.shortEn");
  return (
    <button
      type="button"
      className="theme-toggle lang-toggle"
      onClick={toggleLocale}
      aria-label={t("lang.switchLabel")}
      aria-pressed={locale === "ar"}
      title={t("lang.switchLabel")}
    >
      <Languages size={17} aria-hidden />
      <span>{nextLabel}</span>
    </button>
  );
}
