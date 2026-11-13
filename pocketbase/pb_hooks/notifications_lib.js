// Self-contained notification computation, email formatting, and pluggable channel dispatcher.
// Compatible with both PocketBase's goja JS runtime and Node.js CommonJS tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FuloosNotifications = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  function utcDate(year, monthIndex, day) {
    var d = new Date(0);
    d.setUTCFullYear(year, monthIndex, day);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  function daysInMonth(year, month) {
    return utcDate(year, month, 0).getUTCDate();
  }

  function parseIsoDate(value) {
    if (typeof value !== "string") return null;
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth(year, month)
    ) {
      return null;
    }
    return { year: year, month: month, day: day };
  }

  function isValidIsoDate(value) {
    return parseIsoDate(value) !== null;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = "0" + s;
    return s;
  }

  function formatIsoDate(year, month, day) {
    return pad4(year) + "-" + pad2(month) + "-" + pad2(day);
  }

  function addDays(date, days) {
    var parsed = parseIsoDate(date);
    if (!parsed) throw new Error("Invalid ISO date: " + date);
    var d = new Date(
      utcDate(parsed.year, parsed.month - 1, parsed.day).getTime() +
        days * 86400000
    );
    return formatIsoDate(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate()
    );
  }

  function daysBetween(start, end) {
    var s = parseIsoDate(start);
    var e = parseIsoDate(end);
    if (!s || !e) throw new Error("Invalid ISO date range");
    return Math.round(
      (utcDate(e.year, e.month - 1, e.day).getTime() -
        utcDate(s.year, s.month - 1, s.day).getTime()) /
        86400000
    );
  }

  function occurrenceAtStep(startDate, frequency, step) {
    var start = parseIsoDate(startDate);
    if (!start) throw new Error("Invalid start date: " + startDate);
    if (typeof step !== "number" || step < 0 || Math.floor(step) !== step) {
      throw new Error("Step must be a nonnegative integer");
    }
    if (frequency === "daily") return addDays(startDate, step);
    if (frequency === "weekly") return addDays(startDate, step * 7);
    if (frequency === "monthly" || frequency === "quarterly") {
      var monthsPerStep = frequency === "quarterly" ? 3 : 1;
      var totalMonths =
        start.year * 12 + (start.month - 1) + step * monthsPerStep;
      var targetYear = Math.floor(totalMonths / 12);
      var targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
      var targetDay = Math.min(
        start.day,
        daysInMonth(targetYear, targetMonth)
      );
      return formatIsoDate(targetYear, targetMonth, targetDay);
    }
    var yearlyTargetYear = start.year + step;
    var yearlyTargetDay = Math.min(
      start.day,
      daysInMonth(yearlyTargetYear, start.month)
    );
    return formatIsoDate(yearlyTargetYear, start.month, yearlyTargetDay);
  }

  function firstStepOnOrAfter(startDate, frequency, targetDate) {
    if (targetDate <= startDate) return 0;
    var s = parseIsoDate(startDate);
    var t = parseIsoDate(targetDate);
    if (!s || !t) throw new Error("Invalid date");
    if (frequency === "daily") return daysBetween(startDate, targetDate);
    if (frequency === "weekly") {
      return Math.ceil(daysBetween(startDate, targetDate) / 7);
    }
    var monthsDiff = (t.year - s.year) * 12 + (t.month - s.month);
    var k =
      frequency === "monthly"
        ? Math.max(0, monthsDiff)
        : frequency === "quarterly"
          ? Math.max(0, Math.floor(monthsDiff / 3))
          : Math.max(0, t.year - s.year);
    while (k > 0 && occurrenceAtStep(startDate, frequency, k - 1) >= targetDate) {
      k--;
    }
    while (occurrenceAtStep(startDate, frequency, k) < targetDate) {
      k++;
    }
    return k;
  }

  function generateOccurrences(schedule, fromDate, toDate) {
    if (
      !isValidIsoDate(schedule.start_date) ||
      !isValidIsoDate(fromDate) ||
      !isValidIsoDate(toDate)
    ) {
      return [];
    }
    if (schedule.end_date && !isValidIsoDate(schedule.end_date)) {
      return [];
    }
    var effectiveFrom =
      fromDate > schedule.start_date ? fromDate : schedule.start_date;
    var effectiveTo =
      schedule.end_date && schedule.end_date < toDate
        ? schedule.end_date
        : toDate;
    if (effectiveTo < effectiveFrom) return [];
    var dates = [];
    var step = firstStepOnOrAfter(
      schedule.start_date,
      schedule.frequency,
      effectiveFrom
    );
    for (;;) {
      var occ = occurrenceAtStep(schedule.start_date, schedule.frequency, step);
      if (occ > effectiveTo) break;
      dates.push(occ);
      step++;
    }
    return dates;
  }

  function isMonth(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
    var m = Number(value.slice(5));
    return m >= 1 && m <= 12 && value >= "1970-01" && value <= "2100-12";
  }

  function budgetCovers(budget, month) {
    return (
      budget.start_month <= month &&
      (!budget.end_month || budget.end_month >= month)
    );
  }

  function budgetStatus(budgetAmount, actual) {
    if (actual > budgetAmount) return "over";
    if (budgetAmount > 0 && actual * 5 >= budgetAmount * 4) return "near";
    return "under";
  }

  function todayInTimezone(tz, now) {
    var d = now || new Date();
    var zone = tz || "Asia/Dubai";
    try {
      if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        var fmt = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        if (typeof fmt.formatToParts === "function") {
          var parts = fmt.formatToParts(d);
          var y = "";
          var m = "";
          var day = "";
          for (var i = 0; i < parts.length; i++) {
            if (parts[i].type === "year") y = parts[i].value;
            if (parts[i].type === "month") m = parts[i].value;
            if (parts[i].type === "day") day = parts[i].value;
          }
          if (y && m && day) return y + "-" + m + "-" + day;
        }
        var formatted = fmt.format(d);
        if (isValidIsoDate(formatted)) return formatted;
      }
    } catch (_) {
      // Fallback below for runtimes without full ICU timezone data
    }
    var offsetMinutes = zone === "UTC" ? 0 : 240;
    var shifted = new Date(d.getTime() + offsetMinutes * 60000);
    return formatIsoDate(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate()
    );
  }

  function weekdayForIsoDate(isoDate) {
    var parsed = parseIsoDate(isoDate);
    if (!parsed) return "sun";
    var d = utcDate(parsed.year, parsed.month - 1, parsed.day);
    return WEEKDAYS[d.getUTCDay()];
  }

  function isoWeekKey(isoDate) {
    var parsed = parseIsoDate(isoDate);
    if (!parsed) return "";
    var d = utcDate(parsed.year, parsed.month - 1, parsed.day);
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = utcDate(d.getUTCFullYear(), 0, 1);
    var weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return pad4(d.getUTCFullYear()) + "-W" + pad2(weekNo);
  }

  function computeRecurringAlerts(ledger, asOfDate, upcomingDays) {
    var days =
      typeof upcomingDays === "number" && upcomingDays >= 1 && upcomingDays <= 30
        ? Math.floor(upcomingDays)
        : 3;
    var upcomingEnd = addDays(asOfDate, days);
    var schedules = (ledger.recurring || []).filter(function (s) {
      return s.status === "active";
    });
    var occurrences = ledger.recurring_occurrences || [];
    var confirmed = {};
    for (var i = 0; i < occurrences.length; i++) {
      var occ = occurrences[i];
      confirmed[occ.recurring_id + ":" + occ.occurrence_date] = true;
    }

    var upcoming = [];
    var overdue = [];

    for (var j = 0; j < schedules.length; j++) {
      var s = schedules[j];
      var start = s.start_date < asOfDate ? s.start_date : asOfDate;
      var dates = generateOccurrences(s, start, upcomingEnd);
      for (var k = 0; k < dates.length; k++) {
        var date = dates[k];
        if (confirmed[s.id + ":" + date]) continue;
        var item = {
          schedule: s,
          scheduledDate: date,
          daysUntil: daysBetween(asOfDate, date),
          status: date < asOfDate ? "overdue" : date === asOfDate ? "due_today" : "upcoming",
        };
        if (date < asOfDate) {
          overdue.push(item);
        } else {
          upcoming.push(item);
        }
      }
    }

    var byDateName = function (a, b) {
      if (a.scheduledDate !== b.scheduledDate) {
        return a.scheduledDate < b.scheduledDate ? -1 : 1;
      }
      return a.schedule.name < b.schedule.name
        ? -1
        : a.schedule.name > b.schedule.name
          ? 1
          : 0;
    };
    upcoming.sort(byDateName);
    overdue.sort(byDateName);

    return { upcoming: upcoming, overdue: overdue };
  }

  function computeBudgetAlerts(ledger, month) {
    if (!isMonth(month)) return [];
    var budgets = ledger.budgets || [];
    var categories = ledger.categories || [];
    var transactions = ledger.transactions || [];

    var spentByCat = {};
    for (var i = 0; i < transactions.length; i++) {
      var t = transactions[i];
      if (
        t.type === "expense" &&
        t.category_id &&
        typeof t.date === "string" &&
        t.date.slice(0, 7) === month
      ) {
        spentByCat[t.category_id] = (spentByCat[t.category_id] || 0) + t.amount;
      }
    }

    var rows = [];
    for (var j = 0; j < categories.length; j++) {
      var cat = categories[j];
      var budget = null;
      for (var bIdx = 0; bIdx < budgets.length; bIdx++) {
        if (
          budgets[bIdx].category_id === cat.id &&
          budgetCovers(budgets[bIdx], month)
        ) {
          budget = budgets[bIdx];
          break;
        }
      }
      if (!budget) continue;
      var actual = spentByCat[cat.id] || 0;
      var status = budgetStatus(budget.amount, actual);
      rows.push({
        category: cat,
        budget: budget.amount,
        actual: actual,
        remaining: budget.amount - actual,
        ratio:
          budget.amount > 0
            ? actual / budget.amount
            : actual > 0
              ? Infinity
              : 0,
        status: status,
      });
    }

    var order = { over: 0, near: 1, under: 2 };
    rows.sort(function (a, b) {
      if (order[a.status] !== order[b.status]) {
        return order[a.status] - order[b.status];
      }
      if (b.ratio !== a.ratio) return b.ratio - a.ratio;
      return a.category.name < b.category.name
        ? -1
        : a.category.name > b.category.name
          ? 1
          : 0;
    });
    return rows;
  }

  function computeWeeklyDigest(ledger, asOfDate) {
    var fromDate = addDays(asOfDate, -6);
    var transactions = ledger.transactions || [];
    var income = 0;
    var expense = 0;
    var txCount = 0;
    for (var i = 0; i < transactions.length; i++) {
      var t = transactions[i];
      if (t.date >= fromDate && t.date <= asOfDate) {
        txCount++;
        if (t.type === "income") income += t.amount;
        else if (t.type === "expense") expense += t.amount;
      }
    }
    var alerts = computeRecurringAlerts(ledger, asOfDate, 7);
    var month = asOfDate.slice(0, 7);
    var budgets = computeBudgetAlerts(ledger, month);
    var nearCount = 0;
    var overCount = 0;
    for (var j = 0; j < budgets.length; j++) {
      if (budgets[j].status === "near") nearCount++;
      else if (budgets[j].status === "over") overCount++;
    }
    return {
      fromDate: fromDate,
      toDate: asOfDate,
      month: month,
      income: income,
      expense: expense,
      txCount: txCount,
      upcomingCount: alerts.upcoming.length,
      overdueCount: alerts.overdue.length,
      budgetsNearCount: nearCount,
      budgetsOverCount: overCount,
    };
  }

  function normalizePrefs(raw) {
    var p = raw || {};
    var days = Number(p.upcoming_bill_days);
    if (!Number.isFinite(days) || days < 1 || days > 30) days = 3;
    return {
      email_enabled: Boolean(p.email_enabled),
      upcoming_bill_enabled: Boolean(p.upcoming_bill_enabled),
      upcoming_bill_days: Math.floor(days),
      overdue_enabled: Boolean(p.overdue_enabled),
      budget_80_enabled: Boolean(p.budget_80_enabled),
      budget_100_enabled: Boolean(p.budget_100_enabled),
      weekly_digest_enabled: Boolean(p.weekly_digest_enabled),
      digest_day:
        WEEKDAYS.indexOf(p.digest_day) >= 0 ? p.digest_day : "sun",
      timezone:
        typeof p.timezone === "string" && p.timezone.trim()
          ? p.timezone.trim()
          : "Asia/Dubai",
      channels:
        p.channels && typeof p.channels === "object"
          ? p.channels
          : { email: Boolean(p.email_enabled) },
    };
  }

  function collectPendingNotifications(ledger, rawPrefs, asOfDate) {
    var prefs = normalizePrefs(rawPrefs);
    if (!prefs.email_enabled) return [];
    if (prefs.channels && prefs.channels.email === false) return [];

    var events = [];
    var recurringAlerts = computeRecurringAlerts(
      ledger,
      asOfDate,
      prefs.upcoming_bill_days
    );

    if (prefs.upcoming_bill_enabled) {
      for (var i = 0; i < recurringAlerts.upcoming.length; i++) {
        var up = recurringAlerts.upcoming[i];
        events.push({
          channel: "email",
          eventType: "upcoming_bill",
          periodKey: up.scheduledDate,
          dedupKey:
            "email:upcoming_bill:" + up.schedule.id + ":" + up.scheduledDate,
          payload: {
            scheduleName: up.schedule.name,
            scheduleType: up.schedule.type,
            amount: up.schedule.amount,
            scheduledDate: up.scheduledDate,
            daysUntil: up.daysUntil,
          },
        });
      }
    }

    if (prefs.overdue_enabled) {
      var minOverdueDate = addDays(asOfDate, -30);
      for (var j = 0; j < recurringAlerts.overdue.length; j++) {
        var ov = recurringAlerts.overdue[j];
        if (ov.scheduledDate < minOverdueDate) continue;
        events.push({
          channel: "email",
          eventType: "overdue_bill",
          periodKey: ov.scheduledDate,
          dedupKey:
            "email:overdue_bill:" + ov.schedule.id + ":" + ov.scheduledDate,
          payload: {
            scheduleName: ov.schedule.name,
            scheduleType: ov.schedule.type,
            amount: ov.schedule.amount,
            scheduledDate: ov.scheduledDate,
            daysOverdue: Math.abs(ov.daysUntil),
          },
        });
      }
    }

    var month = asOfDate.slice(0, 7);
    if (prefs.budget_80_enabled || prefs.budget_100_enabled) {
      var budgetRows = computeBudgetAlerts(ledger, month);
      for (var b = 0; b < budgetRows.length; b++) {
        var row = budgetRows[b];
        if (row.status === "over" && prefs.budget_100_enabled) {
          events.push({
            channel: "email",
            eventType: "budget_100",
            periodKey: month,
            dedupKey: "email:budget_100:" + row.category.id + ":" + month,
            payload: {
              categoryName: row.category.name,
              month: month,
              budget: row.budget,
              actual: row.actual,
            },
          });
        } else if (
          (row.status === "near" || row.status === "over") &&
          prefs.budget_80_enabled
        ) {
          events.push({
            channel: "email",
            eventType: "budget_80",
            periodKey: month,
            dedupKey: "email:budget_80:" + row.category.id + ":" + month,
            payload: {
              categoryName: row.category.name,
              month: month,
              budget: row.budget,
              actual: row.actual,
            },
          });
        }
      }
    }

    if (prefs.weekly_digest_enabled) {
      var weekday = weekdayForIsoDate(asOfDate);
      if (weekday === prefs.digest_day) {
        var weekKey = isoWeekKey(asOfDate);
        var digest = computeWeeklyDigest(ledger, asOfDate);
        events.push({
          channel: "email",
          eventType: "weekly_digest",
          periodKey: weekKey,
          dedupKey: "email:weekly_digest:" + weekKey,
          payload: digest,
        });
      }
    }

    return events;
  }

  function formatAed(fils) {
    var n = typeof fils === "number" && Number.isFinite(fils) ? Math.round(fils) : 0;
    var neg = n < 0;
    var abs = Math.abs(n);
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + "AED " + wholeStr + "." + pad2(frac);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildManagePrefsUrl(appUrl) {
    if (!appUrl || typeof appUrl !== "string") return "";
    var trimmed = appUrl.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return trimmed + "/?settings=notifications";
  }

  function wrapEmailHtml(title, bodyHtml, manageUrl) {
    var footerHtml = manageUrl
      ? '<p style="margin-top:24px;font-size:12px;color:#5f6b63;">Manage or unsubscribe from these emails in <a href="' +
        escapeHtml(manageUrl) +
        '" style="color:#1d5b48;">Fuloos Notification Settings</a>.</p>'
      : '<p style="margin-top:24px;font-size:12px;color:#5f6b63;">You can manage or turn off these emails anytime in Fuloos Settings → Notifications.</p>';
    return (
      '<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1b241e;line-height:1.5;max-width:560px;margin:0 auto;padding:20px;">' +
      '<h2 style="margin:0 0 12px;font-size:18px;color:#1d5b48;">' +
      escapeHtml(title) +
      "</h2>" +
      bodyHtml +
      footerHtml +
      "</body></html>"
    );
  }

  function wrapEmailText(bodyText, manageUrl) {
    var footer = manageUrl
      ? "\n\nManage or unsubscribe: " + manageUrl
      : "\n\nManage or unsubscribe in Fuloos Settings -> Notifications.";
    return bodyText + footer;
  }

  function buildEmailMessage(notification, appUrl) {
    var manageUrl = buildManagePrefsUrl(appUrl);
    var p = notification.payload || {};
    var subject = "";
    var text = "";
    var htmlBody = "";

    switch (notification.eventType) {
      case "upcoming_bill": {
        var when =
          p.daysUntil === 0
            ? "due today (" + p.scheduledDate + ")"
            : p.daysUntil === 1
              ? "due tomorrow (" + p.scheduledDate + ")"
              : "due in " + p.daysUntil + " days (" + p.scheduledDate + ")";
        var label = p.scheduleType === "income" ? "Upcoming recurring income" : "Upcoming bill due";
        subject = "Fuloos: " + p.scheduleName + " " + when;
        text =
          label +
          ": " +
          p.scheduleName +
          "\nAmount: " +
          formatAed(p.amount) +
          "\nScheduled date: " +
          p.scheduledDate;
        htmlBody =
          "<p><strong>" +
          escapeHtml(p.scheduleName) +
          "</strong> is " +
          escapeHtml(when) +
          ".</p><p>Amount: <strong>" +
          escapeHtml(formatAed(p.amount)) +
          "</strong></p>";
        break;
      }
      case "overdue_bill": {
        subject = "Fuloos: Overdue recurring item — " + p.scheduleName;
        text =
          "Unconfirmed recurring item: " +
          p.scheduleName +
          "\nAmount: " +
          formatAed(p.amount) +
          "\nScheduled date: " +
          p.scheduledDate +
          " (" +
          p.daysOverdue +
          " day(s) ago)";
        htmlBody =
          "<p><strong>" +
          escapeHtml(p.scheduleName) +
          "</strong> was scheduled for " +
          escapeHtml(p.scheduledDate) +
          " and has not been confirmed yet.</p><p>Amount: <strong>" +
          escapeHtml(formatAed(p.amount)) +
          "</strong></p>";
        break;
      }
      case "budget_80": {
        var pct80 = p.budget > 0 ? Math.round((p.actual / p.budget) * 100) : 100;
        subject = "Fuloos: " + p.categoryName + " budget at " + pct80 + "% (" + p.month + ")";
        text =
          "Your " +
          p.categoryName +
          " budget for " +
          p.month +
          " has reached " +
          pct80 +
          "%.\nSpent: " +
          formatAed(p.actual) +
          "\nBudget: " +
          formatAed(p.budget);
        htmlBody =
          "<p>Your <strong>" +
          escapeHtml(p.categoryName) +
          "</strong> budget for " +
          escapeHtml(p.month) +
          " has reached <strong>" +
          escapeHtml(String(pct80)) +
          "%</strong>.</p><p>Spent: <strong>" +
          escapeHtml(formatAed(p.actual)) +
          "</strong> of " +
          escapeHtml(formatAed(p.budget)) +
          "</p>";
        break;
      }
      case "budget_100": {
        subject = "Fuloos: " + p.categoryName + " budget exceeded (" + p.month + ")";
        text =
          "Your " +
          p.categoryName +
          " budget for " +
          p.month +
          " has been exceeded.\nSpent: " +
          formatAed(p.actual) +
          "\nBudget: " +
          formatAed(p.budget);
        htmlBody =
          "<p>Your <strong>" +
          escapeHtml(p.categoryName) +
          "</strong> budget for " +
          escapeHtml(p.month) +
          " has been exceeded.</p><p>Spent: <strong>" +
          escapeHtml(formatAed(p.actual)) +
          "</strong> (limit: " +
          escapeHtml(formatAed(p.budget)) +
          ")</p>";
        break;
      }
      case "weekly_digest": {
        subject = "Fuloos: Weekly summary (" + p.fromDate + " to " + p.toDate + ")";
        text =
          "Weekly summary (" +
          p.fromDate +
          " to " +
          p.toDate +
          ")\nTransactions recorded: " +
          p.txCount +
          "\nIncome: " +
          formatAed(p.income) +
          "\nExpenses: " +
          formatAed(p.expense) +
          "\nUpcoming bills (next 7 days): " +
          p.upcomingCount +
          "\nOverdue recurring items: " +
          p.overdueCount +
          "\nBudgets near/over limit (" +
          p.month +
          "): " +
          (p.budgetsNearCount + p.budgetsOverCount);
        htmlBody =
          "<p>Summary for <strong>" +
          escapeHtml(p.fromDate) +
          "</strong> to <strong>" +
          escapeHtml(p.toDate) +
          "</strong>:</p><ul>" +
          "<li>Transactions recorded: <strong>" +
          escapeHtml(String(p.txCount)) +
          "</strong></li>" +
          "<li>Income: <strong>" +
          escapeHtml(formatAed(p.income)) +
          "</strong></li>" +
          "<li>Expenses: <strong>" +
          escapeHtml(formatAed(p.expense)) +
          "</strong></li>" +
          "<li>Upcoming bills (next 7 days): <strong>" +
          escapeHtml(String(p.upcomingCount)) +
          "</strong></li>" +
          "<li>Overdue recurring items: <strong>" +
          escapeHtml(String(p.overdueCount)) +
          "</strong></li>" +
          "<li>Budgets near or over limit (" +
          escapeHtml(p.month) +
          "): <strong>" +
          escapeHtml(String(p.budgetsNearCount + p.budgetsOverCount)) +
          "</strong></li>" +
          "</ul>";
        break;
      }
      case "test":
      default: {
        subject = "Fuloos: Test notification email";
        text =
          "This is a test email from your Fuloos account confirming that email notifications are configured.";
        htmlBody =
          "<p>This is a test email from your Fuloos account confirming that email notifications are configured.</p>";
        break;
      }
    }

    return {
      subject: subject,
      text: wrapEmailText(text, manageUrl),
      html: wrapEmailHtml(subject, htmlBody, manageUrl),
    };
  }

  function createChannelDispatcher(handlers) {
    var registry = handlers || {};
    return {
      supports: function (channel) {
        return typeof registry[channel] === "function";
      },
      send: function (channel, recipient, message, meta) {
        var fn = registry[channel];
        if (typeof fn !== "function") {
          throw new Error("Unsupported notification channel: " + channel);
        }
        return fn(recipient, message, meta);
      },
    };
  }

  return {
    WEEKDAYS: WEEKDAYS,
    daysInMonth: daysInMonth,
    parseIsoDate: parseIsoDate,
    isValidIsoDate: isValidIsoDate,
    formatIsoDate: formatIsoDate,
    addDays: addDays,
    daysBetween: daysBetween,
    occurrenceAtStep: occurrenceAtStep,
    firstStepOnOrAfter: firstStepOnOrAfter,
    generateOccurrences: generateOccurrences,
    isMonth: isMonth,
    budgetCovers: budgetCovers,
    budgetStatus: budgetStatus,
    todayInTimezone: todayInTimezone,
    weekdayForIsoDate: weekdayForIsoDate,
    isoWeekKey: isoWeekKey,
    computeRecurringAlerts: computeRecurringAlerts,
    computeBudgetAlerts: computeBudgetAlerts,
    computeWeeklyDigest: computeWeeklyDigest,
    normalizePrefs: normalizePrefs,
    collectPendingNotifications: collectPendingNotifications,
    formatAed: formatAed,
    escapeHtml: escapeHtml,
    buildManagePrefsUrl: buildManagePrefsUrl,
    buildEmailMessage: buildEmailMessage,
    createChannelDispatcher: createChannelDispatcher,
  };
});
