import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  alertToImportTransaction,
  buildCaptureWebhookUrl,
  buildShortcutSnippet,
  matchAccountHint,
  parseClipboardOrShareAlert,
  pendingCapturedAlerts,
} from "../src/captureAlerts.ts";
import { demoLedger } from "../src/demo.ts";
import type { CapturedAlert } from "../src/domain.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libCode = fs.readFileSync(
  path.resolve(__dirname, "../pocketbase/pb_hooks/inbound_capture_lib.js"),
  "utf8",
);
const libModule = { exports: {} as Record<string, unknown> };
new Function("module", "exports", libCode)(libModule, libModule.exports);
const inboundLib = libModule.exports as {
  sha256Hex: (s: string) => string;
  constantTimeEqual: (a: string, b: string) => boolean;
  stripHtml: (html: string) => string;
  parseBankAlertText: (
    rawText: string,
    subject?: string,
    fallbackDate?: string,
  ) => {
    bank: string | null;
    parsed_type: "expense" | "income" | "unknown";
    parsed_amount: number;
    parsed_date: string;
    parsed_payee: string;
    parsed_notes: string;
    account_hint: string;
    is_skip: boolean;
    skip_reason: string;
  };
  extractPayloadFields: (
    body: unknown,
    authHeader?: string,
    tokenHeader?: string,
  ) => {
    token: string;
    source: "email" | "shortcut";
    subject: string;
    rawText: string;
  };
};

test("inbound_capture_lib: sha256Hex matches Node crypto and constantTimeEqual works", () => {
  for (const sample of ["", "flc_test_123", "AED 45.00 · Talabat 🚀"]) {
    const expected = crypto.createHash("sha256").update(sample, "utf8").digest("hex");
    assert.equal(inboundLib.sha256Hex(sample), expected);
  }
  assert.equal(inboundLib.constantTimeEqual("abc123", "abc123"), true);
  assert.equal(inboundLib.constantTimeEqual("abc123", "abc124"), false);
  assert.equal(inboundLib.constantTimeEqual("abc123", "abc12"), false);
});

test("inbound_capture_lib: stripHtml and extractPayloadFields normalize email webhooks", () => {
  const html =
    "<style>.x{color:red}</style><div><p>Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT &amp; CO.</p></div><script>alert(1)</script>";
  const stripped = inboundLib.stripHtml(html);
  assert.equal(
    stripped,
    "Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT & CO.",
  );

  const fromHtml = inboundLib.extractPayloadFields(
    { subject: "Bank Alert", HtmlBody: html },
    "Bearer tok_abc",
  );
  assert.equal(fromHtml.token, "tok_abc");
  assert.equal(fromHtml.source, "email");
  assert.equal(fromHtml.subject, "Bank Alert");
  assert.match(fromHtml.rawText, /TALABAT & CO\./);

  const fromShortcut = inboundLib.extractPayloadFields(
    { token: "tok_xyz", source: "shortcut", text: "AED 12.50 spent" },
  );
  assert.equal(fromShortcut.token, "tok_xyz");
  assert.equal(fromShortcut.source, "shortcut");
  assert.equal(fromShortcut.rawText, "AED 12.50 spent");
});

test("inbound_capture_lib: parseBankAlertText parses UAE bank alerts and skips OTP/declined", () => {
  const liv = inboundLib.parseBankAlertText(
    "Purchase of AED 45.50 with Debit Card ending 1234 at TALABAT, DUBAI. Avl Bal is AED 1,000.00",
    "Liv Alert",
    "2026-11-14",
  );
  assert.equal(liv.bank, "Liv");
  assert.equal(liv.parsed_type, "expense");
  assert.equal(liv.parsed_amount, 4550);
  assert.equal(liv.parsed_payee, "TALABAT, DUBAI");
  assert.equal(liv.account_hint, "Liv · Card 1234");
  assert.equal(liv.is_skip, false);

  const mashreq = inboundLib.parseBankAlertText(
    "Thank you for using your Mashreq Card ending 9876 for AED 120.00 at SPINNEYS on 05-MAY-2025.",
    "",
    "2026-11-14",
  );
  assert.equal(mashreq.bank, "Mashreq");
  assert.equal(mashreq.parsed_type, "expense");
  assert.equal(mashreq.parsed_amount, 12000);
  assert.equal(mashreq.parsed_date, "2025-05-05");
  assert.equal(mashreq.parsed_payee, "SPINNEYS");

  const enbd = inboundLib.parseBankAlertText(
    "Your ENBD Credit Card ending 5544 was used for AED 89.25 at CARREFOUR on 14/11/2026.",
    "",
    "2026-11-14",
  );
  assert.equal(enbd.bank, "ENBD");
  assert.equal(enbd.parsed_type, "expense");
  assert.equal(enbd.parsed_amount, 8925);
  assert.equal(enbd.parsed_date, "2026-11-14");
  assert.equal(enbd.parsed_payee, "CARREFOUR");

  const salary = inboundLib.parseBankAlertText(
    "Salary of AED 18,000.00 has been credited to your ADCB account.",
    "",
    "2026-11-14",
  );
  assert.equal(salary.bank, "ADCB");
  assert.equal(salary.parsed_type, "income");
  assert.equal(salary.parsed_amount, 1800000);

  const otp = inboundLib.parseBankAlertText(
    "Your OTP for AED 500.00 at Noon is 123456. Do not share.",
  );
  assert.equal(otp.is_skip, true);
  assert.equal(otp.skip_reason, "otp");

  const declined = inboundLib.parseBankAlertText(
    "Your transaction of AED 200.00 at Amazon was declined due to insufficient funds.",
  );
  assert.equal(declined.is_skip, true);
  assert.equal(declined.skip_reason, "declined");
});

test("captureAlerts: parseClipboardOrShareAlert, matchAccountHint, and alertToImportTransaction", () => {
  const ledger = demoLedger();
  const draft = parseClipboardOrShareAlert(
    "Purchase of AED 64.50 with Debit Card ending 4821 at CARREFOUR MARKET, DUBAI. Avl Bal is AED 14,785.50.",
    { fallbackDate: "2026-11-14" },
  );
  assert.equal(draft.source, "shortcut");
  assert.equal(draft.parsed_type, "expense");
  assert.equal(draft.parsed_amount, 6450);
  assert.equal(draft.parsed_date, "2026-11-14");
  assert.equal(draft.status, "pending");
  assert.match(draft.parsed_payee, /Carrefour/i);

  const matched = matchAccountHint("Everyday", ledger.accounts);
  assert.equal(matched, "current");

  const alert: CapturedAlert = { id: "a1", ...draft };
  const tx = alertToImportTransaction(alert, ledger, {
    account_id: "card",
    category_id: "groceries",
  });
  assert.equal(tx.account_id, "card");
  assert.equal(tx.category_id, "groceries");
  assert.equal(tx.amount, 6450);
  assert.equal(tx.type, "expense");

  // Applies ledger rules when category not overridden
  const ledgerWithRule = {
    ...ledger,
    rules: [
      {
        id: "r-carrefour",
        name: "Carrefour rule",
        enabled: true,
        priority: 1,
        match_field: "payee" as const,
        match_type: "contains" as const,
        pattern: "carrefour",
        set_category_id: "groceries",
        add_tags: ["supermarket"],
        set_payee: "Carrefour UAE",
      },
    ],
  };
  const ruledTx = alertToImportTransaction(alert, ledgerWithRule, {
    account_id: "card",
  });
  assert.equal(ruledTx.category_id, "groceries");
  assert.equal(ruledTx.payee, "Carrefour");
  assert.deepEqual(ruledTx.tags, ["supermarket"]);
});

test("captureAlerts: pendingCapturedAlerts and webhook helpers", () => {
  const alerts: CapturedAlert[] = [
    {
      id: "1",
      source: "email",
      subject: "",
      raw_text: "old",
      parsed_type: "expense",
      parsed_amount: 1000,
      parsed_date: "2026-11-10",
      parsed_payee: "A",
      parsed_notes: "",
      account_hint: "",
      status: "pending",
      created_at_iso: "2026-11-10T10:00:00Z",
    },
    {
      id: "2",
      source: "email",
      subject: "",
      raw_text: "imported",
      parsed_type: "expense",
      parsed_amount: 1000,
      parsed_date: "2026-11-12",
      parsed_payee: "B",
      parsed_notes: "",
      account_hint: "",
      status: "imported",
      created_at_iso: "2026-11-12T10:00:00Z",
    },
    {
      id: "3",
      source: "shortcut",
      subject: "",
      raw_text: "new",
      parsed_type: "expense",
      parsed_amount: 2000,
      parsed_date: "2026-11-14",
      parsed_payee: "C",
      parsed_notes: "",
      account_hint: "",
      status: "pending",
      created_at_iso: "2026-11-14T10:00:00Z",
    },
  ];
  const pending = pendingCapturedAlerts(alerts);
  assert.deepEqual(
    pending.map((a) => a.id),
    ["3", "1"],
  );

  const url = buildCaptureWebhookUrl("https://pb.example.com/");
  assert.equal(url, "https://pb.example.com/api/fuloos/inbound-email");
  assert.match(buildShortcutSnippet(url, "flc_123"), /flc_123/);
});
