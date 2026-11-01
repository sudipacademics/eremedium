import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, PeopleHrmsDashboard } from '../../api';
import {
  composeExpenseRemark,
  fileToBase64,
  Le2Alerts,
  Le2ExpenseForm,
  Le2ExpenseSummary,
  Le2RecentExpenses,
  Le2Unavailable,
} from '../../components/LeaveExpenseV2';
import './people-portal.css';

export function PeopleExpensesPage() {
  const [data, setData] = useState<PeopleHrmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [expenseType, setExpenseType] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [desc, setDesc] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [purpose, setPurpose] = useState('');
  const [location, setLocation] = useState('');
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPeopleHrmsDashboard();
      setData(res.data);
      if (!expenseType && res.data.expense_types?.[0]?.name) {
        setExpenseType(res.data.expense_types[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load expenses');
    } finally {
      setLoading(false);
    }
  }, [expenseType]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetExpenseForm() {
    setAmount('');
    setExpenseDate('');
    setDesc('');
    setPaymentMode('Cash');
    setPurpose('');
    setLocation('');
    setReceiptFiles([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitExpenseClaim({
        expense_type: expenseType,
        amount: Number(amount),
        description: composeExpenseRemark(desc, paymentMode, purpose, location),
        expense_date: expenseDate || undefined,
      });
      const claim = res.data.expense_claim;
      if (claim?.name && receiptFiles.length) {
        for (const file of receiptFiles) {
          const b64 = await fileToBase64(file);
          await api.attachExpenseReceipt(claim.name, file.name, b64);
        }
      }
      setMessage(res.message || 'Expense submitted');
      resetExpenseForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit expense');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) return <p className="muted">Loading expenses…</p>;
  if (error && !data) return <div className="le2-alert is-err">{error}</div>;
  if (!data) return null;
  if (!data.hr_available) {
    return <Le2Unavailable title="Submit expense" detail="HR module is not available on this site yet." />;
  }

  return (
    <div className="le2-root">
      <Le2Alerts error={error} message={message} />
      <div className="le2-layout">
        <Le2ExpenseForm
          expenseTypes={data.expense_types || []}
          expenseType={expenseType}
          expenseDate={expenseDate}
          amount={amount}
          paymentMode={paymentMode}
          purpose={purpose}
          location={location}
          description={desc}
          files={receiptFiles}
          submitting={submitting}
          onExpenseType={setExpenseType}
          onExpenseDate={setExpenseDate}
          onAmount={setAmount}
          onPaymentMode={setPaymentMode}
          onPurpose={setPurpose}
          onLocation={setLocation}
          onDescription={setDesc}
          onFiles={setReceiptFiles}
          onSubmit={onSubmit}
          onCancel={resetExpenseForm}
        />
        <div className="le2-side">
          <Le2ExpenseSummary rows={data.expense_claims || []} />
          <Le2RecentExpenses rows={data.expense_claims || []} />
        </div>
      </div>
    </div>
  );
}
