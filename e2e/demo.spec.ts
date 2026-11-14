import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/");
  await expect(async () => {
    const banner = page.getByText(/exploring a sample workspace/i);
    if (!(await banner.isVisible())) {
      await page.getByRole("button", { name: /explore the demo/i }).click();
    }
    await expect(banner).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

async function navTo(page: Page, name: string) {
  await page.locator("aside nav").getByRole("button", { name, exact: true }).click();
}

test.describe("Fuloos demo E2E critical flows", () => {
  test("add account", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Accounts");
    await page.getByRole("button", { name: "Add account" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Mashreq Neo");
    await dialog.getByLabel("Balance", { exact: false }).first().fill("2500");
    await dialog.getByRole("button", { name: /save|create|add account/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Mashreq Neo")).toBeVisible();
  });

  test("add category", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Categories");
    await page.getByRole("button", { name: "Add category" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Pet Care");
    await dialog.getByRole("button", { name: /save|create|add category/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Pet Care")).toBeVisible();
  });

  test("add, edit, and delete transaction", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Transactions");

    // Add transaction
    await page.getByRole("button", { name: "Add transaction" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount").fill("42.50");
    await dialog.getByLabel("Payee").fill("E2E Coffee Spot");
    await dialog.getByRole("button", { name: /save|add transaction/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("E2E Coffee Spot")).toBeVisible();

    // Edit transaction
    await page.getByRole("button", { name: /Edit E2E Coffee Spot/i }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Payee").fill("E2E Coffee Updated");
    await editDialog.getByRole("button", { name: /save/i }).click();
    await expect(editDialog).toBeHidden();
    await expect(page.getByText("E2E Coffee Updated")).toBeVisible();

    // Delete transaction
    await page.getByRole("button", { name: /Delete E2E Coffee Updated/i }).click();
    const confirmDialog = page.getByRole("alertdialog");
    await confirmDialog.getByRole("button", { name: /Delete transaction/i }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(page.getByText("E2E Coffee Updated")).toBeHidden();
  });

  test("month navigation", async ({ page }) => {
    await enterDemo(page);
    const pickerBtn = page.getByRole("button", { name: /Date range:.*Change/i });
    const initialLabel = await pickerBtn.getAttribute("aria-label");

    await page.getByRole("button", { name: "Previous month" }).click();
    const prevLabel = await pickerBtn.getAttribute("aria-label");
    expect(prevLabel).not.toBe(initialLabel);

    await page.getByRole("button", { name: "Next month" }).click();
    const restoredLabel = await pickerBtn.getAttribute("aria-label");
    expect(restoredLabel).toBe(initialLabel);
  });

  test("CSV import happy path", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Transactions");
    await page.getByRole("button", { name: "Import CSV" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Import CSV" })).toBeVisible();

    const now = new Date();
    const dmyStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
    const csvContent = [
      "Date,Description,Amount",
      `${dmyStr},E2E CSV Bakery,-18.50`,
    ].join("\n");

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent, "utf-8"),
    });

    await dialog.getByLabel("Date *").selectOption({ label: "Date (1)" });
    await dialog.getByLabel("Amount *").selectOption({ label: "Amount (3)" });
    await dialog
      .getByLabel("Payee / description")
      .selectOption({ label: "Description (2)" });

    await expect(dialog.getByText("E2E CSV Bakery")).toBeVisible();
    await dialog.getByRole("button", { name: /Import \d+ transaction/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("E2E CSV Bakery")).toBeVisible();
  });

  test("SMS import happy path", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Transactions");
    await page.getByRole("button", { name: "Import SMS" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Import bank SMS" })).toBeVisible();

    const smsText =
      "Purchase of AED 33.00 with Debit Card ending 1234 at E2E DESERT ROASTERS, DUBAI. Avl Bal is AED 1,000.00";
    await dialog.getByLabel("Paste SMS").fill(smsText);

    await expect(dialog.getByText(/DESERT ROASTERS/i)).toBeVisible();
    await dialog.getByRole("button", { name: /Import \d+ transaction/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/DESERT ROASTERS/i)).toBeVisible();
  });

  test("recurring create and confirm", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Recurring");

    await page.getByRole("button", { name: "Add recurring" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("E2E Cloud Backup");
    await dialog.getByRole("textbox", { name: /Amount/i }).fill("29.00");
    const todayStr = new Date().toISOString().slice(0, 10);
    await dialog.getByLabel("Start date").fill(todayStr);
    await dialog.getByRole("button", { name: /save|create|add/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("E2E Cloud Backup")).toBeVisible();

    // Confirm an upcoming occurrence via "Mark paid"
    const row = page.locator("article, tr, .recurring-item, .schedule-card, div").filter({
      hasText: "E2E Cloud Backup",
    });
    await row.getByRole("button", { name: /Mark paid/i }).first().click();

    const confirmModal = page.getByRole("dialog");
    await confirmModal.getByRole("button", { name: "Confirm & record" }).click();
    await expect(confirmModal).toBeHidden();
  });

  test("budget create and over-limit display", async ({ page }) => {
    await enterDemo(page);

    // Create a dedicated category so it never collides with existing demo budgets
    await navTo(page, "Categories");
    await page.getByRole("button", { name: "Add category" }).click();
    const catDialog = page.getByRole("dialog");
    await catDialog.getByLabel("Name").fill("E2E Budget Cat");
    await catDialog.getByRole("button", { name: /save|create|add category/i }).click();
    await expect(catDialog).toBeHidden();

    // Record an expense in that category exceeding the budget limit
    await navTo(page, "Transactions");
    await page.getByRole("button", { name: "Add transaction" }).click();
    const txDialog = page.getByRole("dialog");
    await txDialog.getByLabel("Amount").fill("500");
    await txDialog.getByLabel("Payee").fill("E2E Big Expense");
    await txDialog.getByLabel("Category").selectOption({ label: "E2E Budget Cat" });
    await txDialog.getByRole("button", { name: /save|add transaction/i }).click();
    await expect(txDialog).toBeHidden();

    await navTo(page, "Budgets");
    await page.getByRole("button", { name: "Add budget" }).click();
    const bDialog = page.getByRole("dialog");
    await bDialog.getByLabel("Category").selectOption({ label: "E2E Budget Cat" });
    await bDialog.getByLabel(/Monthly limit|Amount/i).fill("100");
    await bDialog.getByRole("button", { name: /save|create|add/i }).click();
    await expect(bDialog).toBeHidden();

    await expect(page.getByText(/Over by|Over budget/i).first()).toBeVisible();
  });

  test("reports render", async ({ page }) => {
    await enterDemo(page);
    await navTo(page, "Reports");
    await expect(page.getByRole("heading", { name: "Where it went" })).toBeVisible();
    await expect(page.getByText(/Net cash flow/i)).toBeVisible();
  });

  test("theme toggle", async ({ page }) => {
    await enterDemo(page);
    const html = page.locator("html");
    const initialTheme = await html.getAttribute("data-theme");
    const toggleBtn = page.getByRole("button", { name: /Switch to (dark|light) mode/i });
    await toggleBtn.click();
    const nextTheme = await html.getAttribute("data-theme");
    expect(nextTheme).not.toBe(initialTheme);
  });

  test("mobile viewport smoke", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterDemo(page);
    await expect(page.getByRole("heading", { name: "A clearer picture." })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add transaction", exact: true }),
    ).toBeVisible();
  });
});
