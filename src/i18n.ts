import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "ar";
export type Direction = "ltr" | "rtl";
export const LOCALE_STORAGE_KEY = "fuloos.locale";

export function dir(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

const en = {
  // Brand & Workspace
  "brand.name": "fuloos",
  "workspace.label": "YOUR WORKSPACE",
  "workspace.personal": "Personal workspace",
  "workspace.demo": "Demo workspace",
  "workspace.demoSubtitle": "Sample data · not saved",
  "sidebar.noteTitle": "A little clarity goes a long way.",
  "sidebar.noteBody": "Make room for what matters. One transaction at a time.",
  "topbar.breadcrumb": "Personal finance",
  "topbar.country": "United Arab Emirates",
  "footer.tagline": "A little more clarity. A little less worry.",
  "footer.brand": "Made for your everyday.",

  // Navigation
  "nav.Overview": "Overview",
  "nav.Transactions": "Transactions",
  "nav.Recurring": "Recurring",
  "nav.Budgets": "Budgets",
  "nav.Goals": "Goals",
  "nav.Net Worth": "Net Worth",
  "nav.Reports": "Reports",
  "nav.Accounts": "Accounts",
  "nav.Categories": "Categories",

  // Page Titles & Subtitles
  "header.eyebrow": "YOUR MONEY, IN VIEW",
  "header.title.Overview": "A clearer picture.",
  "header.subtitle.Overview": "Your everyday finances, all in one calm place.",
  "header.subtitle.Transactions": "The small details behind the bigger picture.",
  "header.subtitle.Recurring":
    "Subscriptions, bills and regular income — balances stay untouched until paid.",
  "header.subtitle.Budgets":
    "Monthly limits per category, and how your spending measures up.",
  "header.subtitle.Goals":
    "Savings goals and sinking funds, tracked at your own pace.",
  "header.subtitle.Net Worth":
    "Cash, investments, gold, property, and liabilities in one view.",
  "header.subtitle.Reports": "The small details behind the bigger picture.",
  "header.subtitle.Accounts": "Every account. One place to see where you stand.",
  "header.subtitle.Categories":
    "Organize your money in a way that makes sense to you.",

  // Primary Action Buttons
  "action.addTransaction": "Add transaction",
  "action.addAccount": "Add account",
  "action.addCategory": "Add category",
  "action.addRecurring": "Add recurring",
  "action.addBudget": "Add budget",
  "action.addGoal": "Add goal",
  "action.addItem": "Add item",

  // Common Actions & States
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.export": "Export",
  "common.signOut": "Sign out",
  "common.settings": "Settings",
  "common.close": "Close",
  "common.done": "Done",
  "common.retry": "Retry",
  "common.loading": "Loading…",
  "common.loadingWorkspace": "Loading your workspace…",
  "common.dateRange": "Date range",
  "common.selectAll": "Select all",
  "common.selectedCount": "{count} selected",
  "common.deleteSelected": "Delete selected",
  "common.clearSelection": "Clear selection",
  "common.manageRules": "Manage rules",
  "common.transfer": "Transfer",

  // Demo Banner
  "demo.banner":
    "You're exploring a sample workspace. Changes last until you leave.",
  "demo.signInToSave": "Sign in to save",

  // Overview Cards & Sections
  "overview.totalNetBalance": "Total net balance",
  "overview.showBalances": "Show balances",
  "overview.hideBalances": "Hide balances",
  "overview.acrossAccounts": "Across {count} accounts",
  "overview.includingCredit": "Including credit balances",
  "overview.income": "Income",
  "overview.moneyComingIn": "Money coming in",
  "overview.expenses": "Expenses",
  "overview.moneyGoingOut": "Money going out",
  "overview.yourAccounts": "Your accounts",
  "overview.viewAllAccounts": "View all accounts",
  "overview.addAnAccount": "Add an account",
  "overview.bringMoneyTogether": "Bring your money together",
  "overview.whereItWent": "Where it went",
  "overview.spendingByCategory": "Your spending by category",
  "overview.totalSpent": "TOTAL SPENT",
  "overview.noSpendingTitle": "A little more detail, soon",
  "overview.noSpendingText": "Add an expense to see where your money goes.",
  "overview.recentActivity": "Recent activity",
  "overview.recentSubtitle": "The latest in your money story",
  "overview.viewAll": "View all",

  // Transactions Filters & Table Headers
  "tx.searchPlaceholder": "Search payee, notes, or category…",
  "tx.allAccounts": "All accounts",
  "tx.allTypes": "All types",
  "tx.allCategories": "All categories",
  "tx.expense": "Expense",
  "tx.income": "Income",
  "tx.transfer": "Transfer",
  "tx.importCsv": "Import CSV",
  "tx.importSms": "Import SMS",
  "tx.importPdf": "Import PDF",
  "tx.exportCsv": "Export CSV",
  "tx.col.date": "Date",
  "tx.col.account": "Account",
  "tx.col.payee": "Payee",
  "tx.col.notes": "Notes",
  "tx.col.category": "Category",
  "tx.col.payment": "Payment",
  "tx.col.deposit": "Deposit",
  "tx.col.balance": "Balance",

  // Section Headings (Accounts, Categories, Recurring, Budgets, Goals, Net Worth, Reports)
  "accounts.totalNetBalance": "Total net balance",
  "accounts.debtPayoffPlanner": "Debt payoff planner",
  "categories.rulesHint":
    "Automate categorization & tagging with deterministic rules.",
  "recurring.title": "Recurring",
  "budgets.title": "Budgets",
  "goals.title": "Goals",
  "netWorth.title": "Net Worth",
  "reports.title": "Fuloos Financial Report",
  "reports.netCashFlow": "Net cash flow",

  // Quick Add
  "quickAdd.eyebrow": "QUICK ADD · AED",
  "quickAdd.title": "Add transaction",
  "quickAdd.offline": "You're offline — reconnect to save changes.",
  "quickAdd.expense": "Expense",
  "quickAdd.income": "Income",
  "quickAdd.amount": "Amount (AED)",
  "quickAdd.account": "Account",
  "quickAdd.category": "Category",
  "quickAdd.payee": "Payee",
  "quickAdd.date": "Date",
  "quickAdd.save": "Save transaction",

  // Auth Screen
  "auth.eyebrow": "A LITTLE MORE CLARITY",
  "auth.heroLine1": "Your money.",
  "auth.heroLine2": "Your life.",
  "auth.heroLine3": "In balance.",
  "auth.heroBody1": "A calm space for your everyday finances.",
  "auth.heroBody2": "Bring your accounts together and make room",
  "auth.heroBody3": "for what matters.",
  "auth.feature1": "All your accounts, together",
  "auth.feature2": "Categories that feel like you",
  "auth.feature3": "Made for life in the UAE",
  "auth.storyFooter": "YOUR MONEY, IN VIEW.",
  "auth.welcome": "Welcome to Fuloos",
  "auth.signInTitle": "Good to have you here.",
  "auth.signUpTitle": "Make yourself at home.",
  "auth.signInSubtitle": "Sign in to pick up where you left off.",
  "auth.signUpSubtitle": "Create your account and start with a clear view.",
  "auth.continueGoogle": "Continue with Google",
  "auth.pleaseWait": "Please wait…",
  "auth.googleSetupNote":
    "Google sign-in is awaiting setup. Email and password are available below.",
  "auth.signIn": "Sign in",
  "auth.signUp": "Sign up",
  "auth.createAccount": "Create account",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.passwordPlaceholderSignIn": "Your password",
  "auth.passwordPlaceholderSignUp": "At least 8 characters",
  "auth.forgotPassword": "Forgot password?",
  "auth.orDivider": "or take a look around",
  "auth.exploreDemo": "Explore the demo",
  "auth.previewNote":
    "Preview mode · Live sign-in will be available once the database is connected.",
  "auth.footnote": "A clearer picture starts with one small step.",

  // Settings
  "settings.eyebrow": "PROFILE",
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.language": "Language",
  "settings.languageHint":
    "Choose your display language and reading direction. Saved on this device.",
  "settings.langEn": "English (LTR)",
  "settings.langAr": "العربية (RTL)",
  "settings.layout": "Layout",
  "settings.layoutHint":
    "Choose how transactions, accounts and categories are laid out. Saved on this device.",
  "settings.compactTitle": "Compact",
  "settings.compactText":
    "A tight, spreadsheet-style table. More rows on screen.",
  "settings.relaxedTitle": "Relaxed",
  "settings.relaxedText": "Roomier cards grouped by day, like the dashboard.",
  "settings.rulesTitle": "Transaction rules",
  "settings.rulesText":
    "Auto-categorize, rename payees, and tag transactions on import or in the editor.",
  "settings.captureTitle": "Email & Shortcut Capture",
  "settings.captureText":
    "Auto-capture bank alerts via email forwarding, iOS Shortcuts, Android Tasker, or clipboard.",
  "settings.capturedAlerts": "Captured alerts",
  "settings.deleteAccountTitle": "Delete my account",
  "settings.deleteAccountText":
    "Removes your sign-in and everything you have saved.",
  "settings.deleteEllipsis": "Delete…",

  // Theme & Language Switcher
  "theme.switchToDark": "Switch to dark mode",
  "theme.switchToLight": "Switch to light mode",
  "theme.dark": "Dark",
  "theme.light": "Light",
  "lang.switchLabel": "Switch language",
  "lang.shortEn": "EN",
  "lang.shortAr": "العربية",
} as const;

export type TranslationKey = keyof typeof en;

const ar: Record<TranslationKey, string> = {
  // Brand & Workspace
  "brand.name": "فلوس",
  "workspace.label": "مساحة العمل",
  "workspace.personal": "مساحة عمل شخصية",
  "workspace.demo": "مساحة العرض التجريبي",
  "workspace.demoSubtitle": "بيانات تجريبية · غير محفوظة",
  "sidebar.noteTitle": "قليل من الوضوح يصنع فرقاً كبيراً.",
  "sidebar.noteBody": "أفسح مجالاً لما يهمك، معاملة تلو الأخرى.",
  "topbar.breadcrumb": "المالية الشخصية",
  "topbar.country": "الإمارات العربية المتحدة",
  "footer.tagline": "مزيد من الوضوح. قلق أقل.",
  "footer.brand": "مصمم ليومياتك.",

  // Navigation
  "nav.Overview": "نظرة عامة",
  "nav.Transactions": "المعاملات",
  "nav.Recurring": "المدفوعات المتكررة",
  "nav.Budgets": "الميزانيات",
  "nav.Goals": "الأهداف",
  "nav.Net Worth": "صافي الثروة",
  "nav.Reports": "التقارير",
  "nav.Accounts": "الحسابات",
  "nav.Categories": "الفئات",

  // Page Titles & Subtitles
  "header.eyebrow": "أموالك في متناول نظرك",
  "header.title.Overview": "صورة أكثر وضوحاً.",
  "header.subtitle.Overview": "شؤونك المالية اليومية في مكان واحد هادئ.",
  "header.subtitle.Transactions": "التفاصيل الصغيرة التي تصنع الصورة الكبيرة.",
  "header.subtitle.Recurring":
    "الاشتراكات والفواتير والدخل المنتظم — تبقى الأرصدة كما هي حتى الدفع.",
  "header.subtitle.Budgets":
    "الحدود الشهرية لكل فئة، ومدى توافق إنفاقك معها.",
  "header.subtitle.Goals":
    "أهداف الادخار وصناديق التوفير، تتبعها بالوتيرة التي تناسبك.",
  "header.subtitle.Net Worth":
    "النقد والاستثمارات والذهب والعقارات والالتزامات في عرض واحد.",
  "header.subtitle.Reports": "التفاصيل الصغيرة التي تصنع الصورة الكبيرة.",
  "header.subtitle.Accounts": "كل حساباتك في مكان واحد لترى وضعك المالي بوضوح.",
  "header.subtitle.Categories": "نظّم أموالك بالطريقة التي تناسبك.",

  // Primary Action Buttons
  "action.addTransaction": "إضافة معاملة",
  "action.addAccount": "إضافة حساب",
  "action.addCategory": "إضافة فئة",
  "action.addRecurring": "إضافة متكررة",
  "action.addBudget": "إضافة ميزانية",
  "action.addGoal": "إضافة هدف",
  "action.addItem": "إضافة عنصر",

  // Common Actions & States
  "common.save": "حفظ",
  "common.cancel": "إلغاء",
  "common.delete": "حذف",
  "common.edit": "تعديل",
  "common.export": "تصدير",
  "common.signOut": "تسجيل الخروج",
  "common.settings": "الإعدادات",
  "common.close": "إغلاق",
  "common.done": "تم",
  "common.retry": "إعادة المحاولة",
  "common.loading": "جارٍ التحميل…",
  "common.loadingWorkspace": "جارٍ تحميل مساحة العمل…",
  "common.dateRange": "النطاق الزمني",
  "common.selectAll": "تحديد الكل",
  "common.selectedCount": "تم تحديد {count}",
  "common.deleteSelected": "حذف المحدد",
  "common.clearSelection": "إلغاء التحديد",
  "common.manageRules": "إدارة القواعد",
  "common.transfer": "تحويل",

  // Demo Banner
  "demo.banner":
    "أنت تستكشف مساحة عمل تجريبية. التغييرات مؤقتة وتنتهي عند المغادرة.",
  "demo.signInToSave": "سجّل الدخول للحفظ",

  // Overview Cards & Sections
  "overview.totalNetBalance": "إجمالي الرصيد الصافي",
  "overview.showBalances": "إظهار الأرصدة",
  "overview.hideBalances": "إخفاء الأرصدة",
  "overview.acrossAccounts": "عبر {count} حسابات",
  "overview.includingCredit": "شاملاً أرصدة البطاقات الائتمانية",
  "overview.income": "الدخل",
  "overview.moneyComingIn": "الأموال الواردة",
  "overview.expenses": "المصروفات",
  "overview.moneyGoingOut": "الأموال الصادرة",
  "overview.yourAccounts": "حساباتك",
  "overview.viewAllAccounts": "عرض كل الحسابات",
  "overview.addAnAccount": "إضافة حساب",
  "overview.bringMoneyTogether": "اجمع حساباتك في مكان واحد",
  "overview.whereItWent": "أين ذهبت أموالك",
  "overview.spendingByCategory": "إنفاقك حسب الفئة",
  "overview.totalSpent": "إجمالي الإنفاق",
  "overview.noSpendingTitle": "تفاصيل أكثر قريباً",
  "overview.noSpendingText": "أضف مصروفاً لترى أين تذهب أموالك.",
  "overview.recentActivity": "النشاط الأخير",
  "overview.recentSubtitle": "أحدث حركاتك المالية",
  "overview.viewAll": "عرض الكل",

  // Transactions Filters & Table Headers
  "tx.searchPlaceholder": "ابحث عن المستفيد أو الملاحظات أو الفئة…",
  "tx.allAccounts": "كل الحسابات",
  "tx.allTypes": "كل الأنواع",
  "tx.allCategories": "كل الفئات",
  "tx.expense": "مصروف",
  "tx.income": "دخل",
  "tx.transfer": "تحويل",
  "tx.importCsv": "استيراد CSV",
  "tx.importSms": "استيراد SMS",
  "tx.importPdf": "استيراد PDF",
  "tx.exportCsv": "تصدير CSV",
  "tx.col.date": "التاريخ",
  "tx.col.account": "الحساب",
  "tx.col.payee": "المستفيد",
  "tx.col.notes": "الملاحظات",
  "tx.col.category": "الفئة",
  "tx.col.payment": "مدفوع",
  "tx.col.deposit": "إيداع",
  "tx.col.balance": "الرصيد",

  // Section Headings
  "accounts.totalNetBalance": "إجمالي الرصيد الصافي",
  "accounts.debtPayoffPlanner": "مخطط سداد الديون",
  "categories.rulesHint": "أتمتة التصنيف والوسوم عبر قواعد تلقائية دقيقة.",
  "recurring.title": "المدفوعات المتكررة",
  "budgets.title": "الميزانيات",
  "goals.title": "الأهداف",
  "netWorth.title": "صافي الثروة",
  "reports.title": "التقرير المالي من فلوس",
  "reports.netCashFlow": "صافي التدفق النقدي",

  // Quick Add
  "quickAdd.eyebrow": "إضافة سريعة · درهم",
  "quickAdd.title": "إضافة معاملة",
  "quickAdd.offline": "أنت غير متصل — أعد الاتصال لحفظ التغييرات.",
  "quickAdd.expense": "مصروف",
  "quickAdd.income": "دخل",
  "quickAdd.amount": "المبلغ (درهم)",
  "quickAdd.account": "الحساب",
  "quickAdd.category": "الفئة",
  "quickAdd.payee": "المستفيد",
  "quickAdd.date": "التاريخ",
  "quickAdd.save": "حفظ المعاملة",

  // Auth Screen
  "auth.eyebrow": "قليل من الوضوح",
  "auth.heroLine1": "أموالك.",
  "auth.heroLine2": "حياتك.",
  "auth.heroLine3": "في توازن.",
  "auth.heroBody1": "مساحة هادئة لإدارة شؤونك المالية اليومية.",
  "auth.heroBody2": "اجمع حساباتك معاً وأفسح مجالاً",
  "auth.heroBody3": "لما يهمك حقاً.",
  "auth.feature1": "كل حساباتك في مكان واحد",
  "auth.feature2": "فئات مصممة لتناسب أسلوبك",
  "auth.feature3": "مصمم للحياة في الإمارات",
  "auth.storyFooter": "أموالك في متناول نظرك.",
  "auth.welcome": "مرحباً بك في فلوس",
  "auth.signInTitle": "يسعدنا وجودك هنا.",
  "auth.signUpTitle": "أهلاً بك في بيتك.",
  "auth.signInSubtitle": "سجّل الدخول للمتابعة من حيث توقفت.",
  "auth.signUpSubtitle": "أنشئ حسابك وابدأ برؤية مالية أوضح.",
  "auth.continueGoogle": "المتابعة عبر Google",
  "auth.pleaseWait": "يرجى الانتظار…",
  "auth.googleSetupNote":
    "تسجيل الدخول عبر Google قيد الإعداد. يمكنك استخدام البريد الإلكتروني وكلمة المرور أدناه.",
  "auth.signIn": "تسجيل الدخول",
  "auth.signUp": "إنشاء حساب",
  "auth.createAccount": "إنشاء الحساب",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.passwordPlaceholderSignIn": "كلمة المرور الخاصة بك",
  "auth.passwordPlaceholderSignUp": "8 أحرف على الأقل",
  "auth.forgotPassword": "هل نسيت كلمة المرور؟",
  "auth.orDivider": "أو ألقِ نظرة أولاً",
  "auth.exploreDemo": "استكشف العرض التجريبي",
  "auth.previewNote":
    "وضع المعاينة · سيتوفر تسجيل الدخول المباشر عند اتصال قاعدة البيانات.",
  "auth.footnote": "الصورة الأوضح تبدأ بخطوة واحدة صغيرة.",

  // Settings
  "settings.eyebrow": "الملف الشخصي",
  "settings.title": "الإعدادات",
  "settings.appearance": "المظهر",
  "settings.language": "اللغة",
  "settings.languageHint": "اختر لغة العرض واتجاه القراءة. يُحفظ على هذا الجهاز.",
  "settings.langEn": "English (LTR)",
  "settings.langAr": "العربية (RTL)",
  "settings.layout": "التخطيط",
  "settings.layoutHint":
    "اختر طريقة عرض المعاملات والحسابات والفئات. يُحفظ على هذا الجهاز.",
  "settings.compactTitle": "مضغوط",
  "settings.compactText": "جدول متراص يعرض صفوفاً أكثر على الشاشة.",
  "settings.relaxedTitle": "مريح",
  "settings.relaxedText": "بطاقات أوسع مجمّعة حسب اليوم، مثل لوحة المعلومات.",
  "settings.rulesTitle": "قواعد المعاملات",
  "settings.rulesText":
    "تصنيف تلقائي وتسمية المستفيدين وإضافة وسوم عند الاستيراد أو التعديل.",
  "settings.captureTitle": "التقاط البريد والاختصارات",
  "settings.captureText":
    "التقاط إشعارات البنك تلقائياً عبر البريد أو اختصارات iOS أو Tasker أو الحافظة.",
  "settings.capturedAlerts": "التنبيهات الملتقطة",
  "settings.deleteAccountTitle": "حذف حسابي",
  "settings.deleteAccountText": "يزيل تسجيل دخولك وكل ما قمت بحفظه.",
  "settings.deleteEllipsis": "حذف…",

  // Theme & Language Switcher
  "theme.switchToDark": "التبديل إلى الوضع الداكن",
  "theme.switchToLight": "التبديل إلى الوضع الفاتح",
  "theme.dark": "داكن",
  "theme.light": "فاتح",
  "lang.switchLabel": "تبديل اللغة",
  "lang.shortEn": "EN",
  "lang.shortAr": "العربية",
};

export const MESSAGES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  ar,
};

export function getSavedLocale(): Locale | null {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(LOCALE_STORAGE_KEY)
        : null;
    return raw === "en" || raw === "ar" ? raw : null;
  } catch {
    return null;
  }
}

export function detectLocale(): Locale {
  const saved = getSavedLocale();
  if (saved) return saved;
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.language === "string" &&
      navigator.language.toLowerCase().startsWith("ar")
    ) {
      return "ar";
    }
  } catch {
    // Ignore navigator access errors in restricted environments.
  }
  return "en";
}

export function applyLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = dir(locale);
}

let currentLocale: Locale = detectLocale();
applyLocale(currentLocale);

export function getGlobalLocale(): Locale {
  return currentLocale;
}

export function setGlobalLocale(locale: Locale): void {
  currentLocale = locale;
  applyLocale(locale);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
  } catch {
    // Ignore storage errors in private browsing or restricted environments.
  }
}

export function t(
  key: TranslationKey,
  vars?: Record<string, string | number>,
  locale: Locale = currentLocale,
): string {
  const table = MESSAGES[locale] ?? MESSAGES.en;
  let template = table[key] ?? MESSAGES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}

export function formatLocalizedAed(
  amountFils: number,
  locale: Locale = currentLocale,
): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    style: "currency",
    currency: "AED",
  }).format(amountFils / 100);
}

export function formatLocalizedNumber(
  value: number,
  locale: Locale = currentLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(
    locale === "ar" ? "ar-AE" : "en-AE",
    options,
  ).format(value);
}

export function formatLocalizedDate(
  isoDate: string,
  locale: Locale = currentLocale,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  },
): string {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? `${isoDate}T00:00:00Z`
    : isoDate;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat(
    locale === "ar" ? "ar-AE" : "en-GB",
    options,
  ).format(date);
}

export interface LocaleContextValue {
  locale: Locale;
  dir: Direction;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: currentLocale,
  dir: dir(currentLocale),
  setLocale: setGlobalLocale,
  toggleLocale: () =>
    setGlobalLocale(currentLocale === "en" ? "ar" : "en"),
  t: (key, vars) => t(key, vars, currentLocale),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = detectLocale();
    currentLocale = initial;
    applyLocale(initial);
    return initial;
  });

  const setLocale = useCallback((next: Locale) => {
    setGlobalLocale(next);
    setLocaleState(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "en" ? "ar" : "en");
  }, [locale, setLocale]);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY) {
        const next = detectLocale();
        currentLocale = next;
        applyLocale(next);
        setLocaleState(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const translate = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      t(key, vars, locale),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: dir(locale),
      setLocale,
      toggleLocale,
      t: translate,
    }),
    [locale, setLocale, toggleLocale, translate],
  );

  return createElement(LocaleContext.Provider, { value }, children);
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
