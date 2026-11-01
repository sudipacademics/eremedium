import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api, ExpenseClaimRow, HrSelfService, LeaveApplicationRow } from '../../api';
import {
  composeExpenseRemark,
  fileToBase64,
  Le2Alerts,
  Le2ExpenseForm,
  Le2ExpenseSummary,
  Le2LeaveBalanceCard,
  Le2LeaveForm,
  Le2RecentExpenses,
  Le2RecentLeaves,
  Le2Tabs,
  Le2Unavailable,
  LeaveBalanceRow,
} from '../../components/LeaveExpenseV2';

type Tab = 'leave' | 'expense';

export function HrSelfServicePage() {
  const [data, setData] = useState<HrSelfService | null>(null);
  const [balances, setBalances] = useState<LeaveBalanceRow[]>([]);
  const [tab, setTab] = useState<Tab>('leave');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [leaveType, setLeaveType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');

  const [expenseType, setExpenseType] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [purpose, setPurpose] = useState('');
  const [location, setLocation] = useState('');
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [hrRes, peopleRes] = await Promise.allSettled([
        api.getHrSelfService(),
        api.getPeopleHrmsDashboard(),
      ]);
      if (hrRes.status === 'rejected') {
        throw hrRes.reason instanceof Error ? hrRes.reason : new Error('Failed to load HR data');
      }
      setData(hrRes.value.data);
      const lt = hrRes.value.data.leave_types?.[0];
      const et = hrRes.value.data.expense_types?.[0];
      if (lt) setLeaveType((prev) => prev || lt.name);
      if (et) setExpenseType((prev) => prev || et.name);
      if (peopleRes.status === 'fulfilled') {
        setBalances(peopleRes.value.data.leave_balances || []);
      } else {
        setBalances([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load HR data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetLeaveForm() {
    setFromDate('');
    setToDate('');
    setLeaveReason('');
  }

  function resetExpenseForm() {
    setAmount('');
    setExpenseDate('');
    setExpenseDesc('');
    setPaymentMode('Cash');
    setPurpose('');
    setLocation('');
    setReceiptFiles([]);
  }

  async function onLeaveSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitLeaveApplication({
        leave_type: leaveType,
        from_date: fromDate,
        to_date: toDate,
        description: leaveReason,
      });
      setMessage(res.message || 'Leave submitted');
      resetLeaveForm();
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit leave');
    } finally {
      setSubmitting(false);
    }
  }

  async function onExpenseSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitExpenseClaim({
        expense_type: expenseType,
        amount: Number(amount),
        description: composeExpenseRemark(expenseDesc, paymentMode, purpose, location),
        expense_date: expenseDate || undefined,
      });
      const claim = res.data.expense_claim;
      if (claim?.name && receiptFiles.length) {
        for (const file of receiptFiles) {
          const b64 = await fileToBase64(file);
          await api.attachExpenseReceipt(claim.name, file.name, b64);
        }
      }
      setMessage(res.message || 'Expense claim submitted');
      resetExpenseForm();
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit expense');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading HR self-service…</p>;
  }

  if (!data?.hr_available) {
    return (
      <Le2Unavailable
        title="HR self-service"
        detail="HR module is not installed on this server yet."
        missing={data?.missing_modules}
      />
    );
  }

  return (
    <div className="le2-root">
      <Le2Tabs tab={tab} onLeave={() => setTab('leave')} onExpense={() => setTab('expense')} />
      <Le2Alerts error={error} message={message} />

      {tab === 'leave' ? (
        <div className="le2-layout">
          <Le2LeaveForm
            leaveTypes={data.leave_types}
            leaveType={leaveType}
            fromDate={fromDate}
            toDate={toDate}
            reason={leaveReason}
            submitting={submitting}
            onLeaveType={setLeaveType}
            onFromDate={setFromDate}
            onToDate={setToDate}
            onReason={setLeaveReason}
            onSubmit={(e) => void onLeaveSubmit(e)}
            onCancel={resetLeaveForm}
          />
          <div className="le2-side">
            <Le2LeaveBalanceCard rows={balances} viewAllHref="/people/leave" />
            <Le2RecentLeaves rows={data.leave_applications as LeaveApplicationRow[]} viewAllHref="/people/leave" />
          </div>
        </div>
      ) : (
        <div className="le2-layout">
          <Le2ExpenseForm
            expenseTypes={data.expense_types}
            expenseType={expenseType}
            expenseDate={expenseDate}
            amount={amount}
            paymentMode={paymentMode}
            purpose={purpose}
            location={location}
            description={expenseDesc}
            files={receiptFiles}
            submitting={submitting}
            onExpenseType={setExpenseType}
            onExpenseDate={setExpenseDate}
            onAmount={setAmount}
            onPaymentMode={setPaymentMode}
            onPurpose={setPurpose}
            onLocation={setLocation}
            onDescription={setExpenseDesc}
            onFiles={setReceiptFiles}
            onSubmit={(e) => void onExpenseSubmit(e)}
            onCancel={resetExpenseForm}
          />
          <div className="le2-side">
            <Le2ExpenseSummary rows={data.expense_claims as ExpenseClaimRow[]} />
            <Le2RecentExpenses rows={data.expense_claims as ExpenseClaimRow[]} viewAllHref="/people/expenses" />
          </div>
        </div>
      )}
    </div>
  );
}
