/* Pure CommonJS helper for PocketBase inbound alert capture (Goja & Node compatible). */
"use strict";

var MAX_PAYLOAD_BYTES = 64 * 1024;

var AED_PER_UNIT = {
  AED: 1,
  USD: 3.6725,
  SAR: 0.9793333333333333,
  QAR: 1.0089285714285714,
  BHD: 9.767287234042552,
  OMR: 9.551365409622885,
};

var MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** Pure JS UTF-8 + SHA-256 hex digest (works in both PocketBase Goja and Node). */
function sha256Hex(input) {
  var str = String(input || "");
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      i++;
      var cp =
        0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  var H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  var hi = Math.floor(bitLen / 0x100000000);
  var lo = bitLen >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  );

  var rotr = function (n, x) {
    return (x >>> n) | (x << (32 - n));
  };

  var W = new Array(64);
  for (var offset = 0; offset < bytes.length; offset += 64) {
    for (var t = 0; t < 16; t++) {
      var j = offset + t * 4;
      W[t] =
        ((bytes[j] << 24) |
          (bytes[j + 1] << 16) |
          (bytes[j + 2] << 8) |
          bytes[j + 3]) >>>
        0;
    }
    for (var t2 = 16; t2 < 64; t2++) {
      var s0 = rotr(7, W[t2 - 15]) ^ rotr(18, W[t2 - 15]) ^ (W[t2 - 15] >>> 3);
      var s1 = rotr(17, W[t2 - 2]) ^ rotr(19, W[t2 - 2]) ^ (W[t2 - 2] >>> 10);
      W[t2] = (W[t2 - 16] + s0 + W[t2 - 7] + s1) >>> 0;
    }

    var a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];

    for (var r = 0; r < 64; r++) {
      var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + K[r] + W[r]) >>> 0;
      var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  var out = "";
  for (var k = 0; k < 8; k++) {
    out += ("00000000" + H[k].toString(16)).slice(-8);
  }
  return out;
}

/** Constant-time string equality check. */
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  var len = Math.max(a.length, b.length);
  var diff = a.length ^ b.length;
  for (var i = 0; i < len; i++) {
    var ca = i < a.length ? a.charCodeAt(i) : 0;
    var cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/** Strip HTML tags/styles/scripts into clean plain text. */
function stripHtml(html) {
  if (typeof html !== "string") return "";
  var s = html;
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(?:p|div|tr|li|h[1-6]|section|article)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  s = s.replace(/[ \t\r]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function uaeDateString(date) {
  var d = date || new Date();
  // Asia/Dubai is permanently UTC+4 (no DST).
  var shifted = new Date(d.getTime() + 4 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function validCalendarDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  var iso =
    String(y) +
    "-" +
    ("0" + String(m)).slice(-2) +
    "-" +
    ("0" + String(d)).slice(-2);
  var parsed = new Date(iso + "T00:00:00Z");
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function dateInText(text) {
  var s = String(text || "");
  var mIso = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/.exec(s);
  if (mIso) {
    var iso = validCalendarDate(+mIso[1], +mIso[2], +mIso[3]);
    if (iso) return iso;
  }
  var mMon = /\b(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})\b/.exec(s);
  if (mMon) {
    var monIdx = MONTHS.indexOf(mMon[2].toUpperCase()) + 1;
    if (monIdx > 0) {
      var dMon = validCalendarDate(+mMon[3], monIdx, +mMon[1]);
      if (dMon) return dMon;
    }
  }
  var slashRe = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g;
  var match;
  while ((match = slashRe.exec(s)) !== null) {
    var yr = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    var dSlash = validCalendarDate(yr, +match[2], +match[1]);
    if (dSlash) return dSlash;
  }
  return null;
}

function parseAmount(raw) {
  if (!raw) return NaN;
  var cleaned = String(raw).replace(/,/g, "").trim().replace(/\.+$/, "");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return NaN;
  return parseFloat(cleaned);
}

function detectBankFromText(text) {
  var s = String(text || "");
  if (/\b(?:liv\.?|liv\s*bank)\b/i.test(s)) return "Liv";
  if (/\bmashreq\b|\bneo\b/i.test(s)) return "Mashreq";
  if (/\badcb\b/i.test(s)) return "ADCB";
  if (/\bfab\b|first\s+abu\s+dhabi/i.test(s)) return "FAB";
  if (/\badib\b|abu\s+dhabi\s+islamic/i.test(s)) return "ADIB";
  if (/\benbd\b|emirates\s*nbd/i.test(s)) return "ENBD";
  return null;
}

function cleanMerchant(raw) {
  if (!raw) return "";
  var s = String(raw).replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\.\s*Avl\s*Bal.*$/i, "");
  s = s.replace(/\s*(?:Available|Avl\.?|Current)\s*Bal(?:ance)?.*$/i, "");
  s = s.replace(/\s+on\s+\d{1,2}[\/-](?:\d{1,2}|[A-Za-z]{3})[\/-]\d{2,4}.*$/i, "");
  s = s.replace(/^(?:SP|FAT|WL|TAP|MYF|SQ|SUMUP|NOMOD)\s*\*\s*/i, "");
  s = s.replace(/[.,;:\-]+$/, "").trim();
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s;
}

/**
 * Parse a UAE bank alert (SMS, email body, or shortcut text) into structured alert fields.
 * Supports Liv, Mashreq, ADCB, FAB, ADIB, ENBD, and generic UAE debit/credit alerts.
 */
function parseBankAlertText(rawText, subject, fallbackDate) {
  var body = String(rawText || "").replace(/\r\n?/g, "\n").trim();
  var subj = String(subject || "").replace(/\s+/g, " ").trim();
  var combined = (subj ? subj + " " : "") + body.replace(/\n+/g, " ");
  var flat = body.replace(/\n+/g, " ").trim();

  var date = dateInText(combined) || fallbackDate || uaeDateString(new Date());
  var bank = detectBankFromText(combined);

  var cardMatch =
    /(?:card\s+(?:ending(?:\s+with)?|no\.?|number|xx+|\*+)\s*|ending\s+(?:in\s+)?|xx+|[*]{2,})(\d{4})\b/i.exec(
      combined,
    );
  var cardLast4 = cardMatch ? cardMatch[1] : "";
  var accountHint = [bank, cardLast4 ? "Card " + cardLast4 : ""]
    .filter(Boolean)
    .join(" · ");

  // Skip OTPs & declined alerts
  if (
    /\bOTP\b|one[- ]time[- ]password|verification\s+code|authentication\s+code|security\s+code/i.test(
      combined,
    )
  ) {
    return {
      bank: bank,
      parsed_type: "unknown",
      parsed_amount: 0,
      parsed_date: date,
      parsed_payee: "",
      parsed_notes: subj || "One-time password alert",
      account_hint: accountHint,
      is_skip: true,
      skip_reason: "otp",
    };
  }
  if (
    /\bdeclined\b|could\s+not\s+be\s+(?:completed|processed)|insufficient\s+(?:funds|balance|limit)|has\s+been\s+rejected/i.test(
      combined,
    )
  ) {
    return {
      bank: bank,
      parsed_type: "unknown",
      parsed_amount: 0,
      parsed_date: date,
      parsed_payee: "",
      parsed_notes: subj || "Declined transaction alert",
      account_hint: accountHint,
      is_skip: true,
      skip_reason: "declined",
    };
  }

  var parsedType = "unknown";
  var currency = "AED";
  var amount = NaN;
  var merchant = "";
  var m;

  // 1. Liv / ENBD style: "Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT, DUBAI. Avl Bal is AED 1,000.00"
  if (
    (m =
      /Purchase\s+of\s+([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+with\s+(?:Debit|Credit)\s+Card\s+ending\s+\d+\s+at\s+([^.]+)/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = cleanMerchant(m[3]);
  }
  // 2. ENBD style: "Your Credit Card ending 1234 was used for AED 120.50 at CARREFOUR on 14/11/2026"
  else if (
    (m =
      /(?:Credit|Debit)\s+Card(?:\s+ending(?:\s+with)?\s+\d+|\s+no\.?\s*\S+)?\s+(?:was\s+used\s+for|has\s+been\s+charged(?:\s+for)?|transaction\s+of)\s+([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+(?:at|to)\s+(.+?)(?:\s+on\s+\d|\s*\.\s*Avl|\s*\.|$)/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = cleanMerchant(m[3]);
  }
  // 3. Mashreq style: "Thank you for using your Mashreq Card ending 1234 for AED 50.00 at SPINNEYS on 05-MAY-2025"
  else if (
    (m =
      /using\s+your\s+.*?Card\s+ending\s+\d+\s+for\s+([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+at\s+(.+?)(?:\s+on\s+\d|\s*\.|$)/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = cleanMerchant(m[3]);
  }
  // 4. ADCB style: "AED 89.00 spent on your ADCB Card XX1234 at AMAZON AE, DUBAI-AE on 14/11/2026"
  else if (
    (m =
      /([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+(?:was\s+)?(?:spent|charged|paid)\s+(?:on|using|from)\s+.*?(?:at|to)\s+(.+?)(?:\s+on\s+\d|\s*\.|$)/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = cleanMerchant(m[3]);
  }
  // 5. FAB / ADIB style: "Debit Card purchase of AED 35.00 at STARBUCKS DUBAI AE" or "Transaction of AED 35.00 at ..."
  else if (
    (m =
      /(?:Debit|Credit)\s+Card\s+purchase\s+of\s+([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+at\s+(.+?)(?:\s+on\s+\d|\s*\.\s*Avl|\s*\.|$)/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = cleanMerchant(m[3]);
  }
  // 6. Cash withdrawal
  else if (
    (m =
      /Cash\s+Withdrawal\s+of\s+([A-Z]{3})\s+([\d,]+(?:\.\d+)?)(?:\s+with\s+.*?at\s+([^.]+))?/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = cleanMerchant(m[3]) || "Cash withdrawal";
  }
  // 7. Income / Salary / Credit / Refund
  else if (
    (m =
      /(?:Salary|Interest|Refund|Credit\s+refund)\s+(?:of\s+)?([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+has\s+been\s+credited/i.exec(
        flat,
      ))
  ) {
    parsedType = "income";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = /salary/i.test(m[0])
      ? "Salary"
      : /refund/i.test(m[0])
        ? "Refund"
        : "Bank credit";
  } else if (
    (m =
      /([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+has\s+been\s+(?:credited|deposited|transferred\s+to\s+your)/i.exec(
        flat,
      ))
  ) {
    parsedType = "income";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    merchant = "Transfer in";
  }
  // 8. Generic debit: "AED 120.00 has been debited from your account..."
  else if (
    (m =
      /([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+has\s+been\s+(?:debited|deducted)/i.exec(
        flat,
      ))
  ) {
    parsedType = "expense";
    currency = m[1].toUpperCase();
    amount = parseAmount(m[2]);
    var atMatch = /\bat\s+([^.\n]+)/i.exec(flat);
    merchant = cleanMerchant(atMatch ? atMatch[1] : "") || "Bank debit";
  }
  // 9. Fallback: any currency+amount + debit/credit keyword
  else {
    var amtMatch =
      /\b(AED|USD|SAR|QAR|BHD|OMR)\s*([\d,]+(?:\.\d{1,2})?)\b/i.exec(combined);
    if (amtMatch) {
      currency = amtMatch[1].toUpperCase();
      amount = parseAmount(amtMatch[2]);
      if (
        /\b(?:credited|deposited|salary|refund|received|incoming)\b/i.test(
          combined,
        )
      ) {
        parsedType = "income";
      } else if (
        /\b(?:debited|deducted|purchase|spent|charged|paid|payment|withdrawal|pos)\b/i.test(
          combined,
        )
      ) {
        parsedType = "expense";
      }
      var mAt = /\bat\s+([A-Za-z0-9][A-Za-z0-9\s&*.'-]{1,60}?)(?:\s+on\s+\d|\s*\.|$)/i.exec(
        flat,
      );
      if (mAt) merchant = cleanMerchant(mAt[1]);
    }
  }

  var rate = AED_PER_UNIT[currency];
  var fils = 0;
  var foreignNote = "";
  if (typeof amount === "number" && !isNaN(amount) && rate) {
    fils = Math.round(amount * rate * 100);
    if (currency !== "AED") {
      foreignNote = " · " + amount.toFixed(2) + " " + currency;
    }
  } else if (typeof amount === "number" && !isNaN(amount) && !rate) {
    parsedType = "unknown";
    foreignNote = " · Unsupported currency " + currency;
  }

  var notes =
    "Captured " +
    (bank ? bank + " " : "") +
    "alert" +
    foreignNote +
    (subj ? " · " + subj.slice(0, 100) : "");

  return {
    bank: bank,
    parsed_type: parsedType,
    parsed_amount: fils,
    parsed_date: date,
    parsed_payee: merchant.slice(0, 120),
    parsed_notes: notes.slice(0, 500),
    account_hint: accountHint.slice(0, 64),
    is_skip: false,
    skip_reason: "",
  };
}

/** Normalize incoming webhook payload from Cloudflare Email Workers, Postmark, Mailgun, Resend, or Shortcuts. */
function extractPayloadFields(body, authHeader, tokenHeader) {
  var obj = body && typeof body === "object" ? body : {};
  var token = "";
  if (typeof obj.token === "string" && obj.token.trim()) {
    token = obj.token.trim();
  } else if (typeof tokenHeader === "string" && tokenHeader.trim()) {
    token = tokenHeader.trim();
  } else if (typeof authHeader === "string") {
    var m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (m) token = m[1].trim();
  }

  var subject = String(
    obj.subject || obj.Subject || "",
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  var rawText =
    obj.text ||
    obj.TextBody ||
    obj["body-plain"] ||
    obj.plain ||
    obj.message ||
    "";
  rawText = String(rawText || "").trim();

  var html = obj.html || obj.HtmlBody || obj["body-html"] || "";
  if (!rawText && typeof html === "string" && html.trim()) {
    rawText = stripHtml(html);
  }

  var source = obj.source === "shortcut" ? "shortcut" : "email";
  return {
    token: token,
    source: source,
    subject: subject,
    rawText: rawText,
  };
}

module.exports = {
  MAX_PAYLOAD_BYTES: MAX_PAYLOAD_BYTES,
  sha256Hex: sha256Hex,
  constantTimeEqual: constantTimeEqual,
  stripHtml: stripHtml,
  uaeDateString: uaeDateString,
  dateInText: dateInText,
  parseBankAlertText: parseBankAlertText,
  extractPayloadFields: extractPayloadFields,
};
