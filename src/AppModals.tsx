import { planAccountDeletion } from "./accountDeletion";
import { BulkEdit } from "./BulkEdit";
import { BudgetEditorModal, type BudgetDraft } from "./BudgetsView";
import { planCategoryDeletion } from "./categoryDeletion";
import {
  backend,
  createLearningStore,
  createPresetStore,
  type Session,
} from "./client";
import type { ImportTransaction } from "./csv";
import { CsvImport } from "./CsvImport";
import { DeleteAccountDialog } from "./DeleteAccount";
import { DeleteCategoriesDialog } from "./DeleteCategories";
import { DeleteMoneyAccountDialog } from "./DeleteMoneyAccount";
import { DeleteTransactionsDialog } from "./DeleteTransactions";
import {
  emptyLedger,
  type Account,
  type Budget,
  type Category,
  type Ledger,
  type RecurringOccurrenceRecord,
  type RecurringSchedule,
  type Transaction,
} from "./domain";
import { Editor, type EditorModalState } from "./EditorModal";
import {
  ConfirmOccurrenceModal,
  RecurringEditorModal,
} from "./RecurringView";
import { SettingsDialog } from "./Settings";
import { SmsImport } from "./SmsImport";
import { planTransactionDeletion } from "./transactionDeletion";

export function AppModals({
  demo,
  session,
  ledger,
  setLedger,
  busy,
  hidden,
  concealed,
  load,
  save,
  settingsOpen,
  setSettingsOpen,
  deleteOpen,
  setDeleteOpen,
  accountToDelete,
  setAccountToDelete,
  deleteMoneyAccount,
  categoriesToDelete,
  setCategoriesToDelete,
  deleteCategories,
  transactionsToDelete,
  setTransactionsToDelete,
  deleteTransactions,
  bulkItems,
  setBulkItems,
  bulkUpdate,
  importOpen,
  setImportOpen,
  smsOpen,
  setSmsOpen,
  importTransactions,
  createCategories,
  presetStore,
  learningStore,
  recurringModal,
  setRecurringModal,
  saveRecurring,
  unlinkOccurrence,
  budgetModal,
  setBudgetModal,
  saveBudget,
  confirmOcc,
  setConfirmOcc,
  confirmCreateOccurrence,
  confirmLinkOccurrence,
  modal,
  setModal,
}: {
  demo: boolean;
  session: Session | null;
  ledger: Ledger;
  setLedger: (l: Ledger) => void;
  busy: boolean;
  hidden: boolean;
  concealed: (v: number) => string;
  load: () => Promise<void>;
  save: (
    table: "accounts" | "categories" | "transactions",
    value: Record<string, unknown>,
    id?: string,
  ) => Promise<void>;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  deleteOpen: boolean;
  setDeleteOpen: (v: boolean) => void;
  accountToDelete: Account | null;
  setAccountToDelete: (a: Account | null) => void;
  deleteMoneyAccount: (a: Account) => void;
  categoriesToDelete: string[] | null;
  setCategoriesToDelete: (ids: string[] | null) => void;
  deleteCategories: (ids: string[], target: string | null) => void;
  transactionsToDelete: string[] | null;
  setTransactionsToDelete: (ids: string[] | null) => void;
  deleteTransactions: (ids: string[]) => void;
  bulkItems: Transaction[] | null;
  setBulkItems: (items: Transaction[] | null) => void;
  bulkUpdate: (
    rows: Transaction[],
    progress: (records: Transaction[]) => void,
  ) => Promise<void>;
  importOpen: boolean;
  setImportOpen: (v: boolean) => void;
  smsOpen: boolean;
  setSmsOpen: (v: boolean) => void;
  importTransactions: (
    rows: ImportTransaction[],
    progress: (n: number) => void,
    source?: string,
    onSaved?: (n: number) => void,
    paired?: Transaction[],
  ) => Promise<void>;
  createCategories: (
    rows: Omit<Category, "id">[],
    progress: (n: number) => void,
  ) => Promise<void>;
  presetStore: ReturnType<typeof createPresetStore>;
  learningStore: ReturnType<typeof createLearningStore>;
  recurringModal: {
    open: true;
    item?: RecurringSchedule;
    initialDraft?: Partial<Omit<RecurringSchedule, "id">>;
  } | null;
  setRecurringModal: (v: null) => void;
  saveRecurring: (
    value: Omit<RecurringSchedule, "id">,
    id?: string,
  ) => Promise<void>;
  unlinkOccurrence: (occurrenceId: string) => Promise<void>;
  budgetModal: { item?: Budget; draft?: Partial<BudgetDraft> } | null;
  setBudgetModal: (v: null) => void;
  saveBudget: (value: BudgetDraft, id?: string) => Promise<void>;
  confirmOcc: {
    schedule: RecurringSchedule;
    occurrenceDate: string;
    existingConfirmation?: RecurringOccurrenceRecord;
  } | null;
  setConfirmOcc: (v: null) => void;
  confirmCreateOccurrence: (
    schedule: RecurringSchedule,
    occurrenceDate: string,
    tx: Omit<Transaction, "id">,
  ) => Promise<void>;
  confirmLinkOccurrence: (
    schedule: RecurringSchedule,
    occurrenceDate: string,
    transactionId: string,
    existingConfirmationId?: string,
  ) => Promise<void>;
  modal: EditorModalState;
  setModal: (v: EditorModalState) => void;
}) {
  return (
    <>
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onDeleteAccount={
            !demo && session
              ? () => {
                  setSettingsOpen(false);
                  setDeleteOpen(true);
                }
              : undefined
          }
        />
      )}
      {deleteOpen && backend && session && (
        <DeleteAccountDialog
          email={session.user.email}
          onClose={() => setDeleteOpen(false)}
          onDelete={async (progress) => {
            try {
              await backend!.deleteAccount(progress);
            } catch (e) {
              void load();
              throw e;
            }
            setDeleteOpen(false);
            setLedger(emptyLedger);
          }}
        />
      )}
      {accountToDelete && (
        <DeleteMoneyAccountDialog
          account={accountToDelete}
          plan={planAccountDeletion(ledger, accountToDelete.id)}
          onClose={() => setAccountToDelete(null)}
          onDelete={() => deleteMoneyAccount(accountToDelete)}
        />
      )}
      {categoriesToDelete && (
        <DeleteCategoriesDialog
          categories={ledger.categories.filter((c) =>
            categoriesToDelete.includes(c.id),
          )}
          plan={planCategoryDeletion(ledger, categoriesToDelete)}
          remaining={ledger.categories.filter(
            (c) => !categoriesToDelete.includes(c.id),
          )}
          onClose={() => setCategoriesToDelete(null)}
          onDelete={(target) => deleteCategories(categoriesToDelete, target)}
        />
      )}
      {transactionsToDelete && (
        <DeleteTransactionsDialog
          transactions={ledger.transactions
            .filter((t) => transactionsToDelete.includes(t.id))
            .sort((a, b) => b.date.localeCompare(a.date))}
          plan={planTransactionDeletion(ledger, transactionsToDelete)}
          accounts={ledger.accounts}
          categories={ledger.categories}
          hidden={hidden}
          onClose={() => setTransactionsToDelete(null)}
          onDelete={() => deleteTransactions(transactionsToDelete)}
        />
      )}
      {bulkItems && (
        <BulkEdit
          items={bulkItems}
          ledger={ledger}
          onClose={() => {
            if (!busy) setBulkItems(null);
          }}
          onApply={bulkUpdate}
        />
      )}
      {importOpen && (
        <CsvImport
          ledger={ledger}
          onClose={() => setImportOpen(false)}
          onImport={(rows, progress, paired) =>
            importTransactions(rows, progress, "CSV import:", undefined, paired)
          }
          onCreateCategories={createCategories}
          presetStore={presetStore}
          onCreateCategory={async (value) => {
            await save("categories", value);
          }}
        />
      )}
      {smsOpen && (
        <SmsImport
          ledger={ledger}
          owner={demo ? "demo" : (session?.user.id ?? "anonymous")}
          learning={learningStore}
          onClose={() => setSmsOpen(false)}
          onImport={(rows, progress, onSaved) =>
            importTransactions(rows, progress, "SMS import:", onSaved)
          }
        />
      )}
      {recurringModal && (
        <RecurringEditorModal
          item={recurringModal.item}
          initialDraft={recurringModal.initialDraft}
          ledger={ledger}
          concealed={concealed}
          busy={busy}
          onClose={() => {
            if (!busy) setRecurringModal(null);
          }}
          onSave={saveRecurring}
          onUnlinkOccurrence={(occurrenceId) =>
            void unlinkOccurrence(occurrenceId)
          }
        />
      )}
      {budgetModal && (
        <BudgetEditorModal
          ledger={ledger}
          item={budgetModal.item}
          draft={budgetModal.draft}
          busy={busy}
          onClose={() => {
            if (!busy) setBudgetModal(null);
          }}
          onSave={saveBudget}
        />
      )}
      {confirmOcc && (
        <ConfirmOccurrenceModal
          schedule={confirmOcc.schedule}
          occurrenceDate={confirmOcc.occurrenceDate}
          existingConfirmation={confirmOcc.existingConfirmation}
          ledger={ledger}
          busy={busy}
          onClose={() => {
            if (!busy) setConfirmOcc(null);
          }}
          onConfirmCreate={confirmCreateOccurrence}
          onConfirmLink={confirmLinkOccurrence}
        />
      )}
      {modal && (
        <Editor
          modal={modal}
          ledger={ledger}
          busy={busy}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          save={save}
          onUnlinkOccurrence={(occurrenceId) =>
            void unlinkOccurrence(occurrenceId)
          }
        />
      )}
    </>
  );
}
