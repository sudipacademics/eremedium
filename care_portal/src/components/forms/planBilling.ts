import { api } from '../../api';
import { inr } from '../../format';

type Result = { invoice_id: number; invoice_number: string; carried: number };

/* Asks for the package amount and turns a pay-per-visit plan into one package invoice. */
export async function billPlanAsPackage(
  plan: { id: number; code: string; fee: number; total_sessions: number },
  mutate: <T>(work: () => Promise<T>, success?: string | ((value: T) => string)) => Promise<T | undefined>,
) {
  const suggested = Math.round(plan.fee * plan.total_sessions * 100) / 100;
  const answer = window.prompt(
    `Bill ${plan.code} as one package for all ${plan.total_sessions} sessions.\n` +
      'Any per-visit bills already raised for this plan are cancelled and their payments carried over.\n\n' +
      'Package amount (₹) — leave blank to use the sum of the session prices:',
    '',
  );
  if (answer === null) return undefined;
  const cleaned = answer.replace(/[₹,\s]/g, '');
  const amount = cleaned === '' ? undefined : Number(cleaned);
  if (amount !== undefined && !(amount > 0)) {
    window.alert(`Enter a valid package amount (about ${inr(suggested)}), or leave it blank.`);
    return undefined;
  }
  return mutate(
    () => api<Result>(`/plans/${plan.id}/package-billing`, { method: 'POST', body: { package_price: amount } }),
    (r) => `${plan.code} billed as a package on ${r.invoice_number}${r.carried ? ` (${inr(r.carried)} already received carried over)` : ''}`,
  );
}
