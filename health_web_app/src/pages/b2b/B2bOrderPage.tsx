import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type B2bCatalogItem, type PartnerCircuit } from '../../api';
import { matchesLabTestQuery } from '../../utils/labTestSearch';

/** Off-circuit hubs keep billing as today; circuit partners need the FOCO module (phlebotomy). */
function canBillPatient(circuit: PartnerCircuit) {
  if (!circuit.tier) return true;
  return circuit.tier === 'FOCO' || Boolean(circuit.services?.phlebotomy);
}
import { ReferringDoctorPicker, type ReferringDoctorValue } from '../../components/ReferringDoctorPicker';
import { HubBillEntryStep } from './HubBillEntryStep';
import {
  clearWalkInDraft,
  consumeWalkInItemQueue,
  loadWalkInDraft,
  saveWalkInDraft,
  type WalkInDraft,
} from '../../utils/walkInDraft';
import { parseAgeInput } from '../../utils/patientAge';
import './partner-order-v2.css';

type CollectionMode = 'cash' | 'card' | 'upi' | 'bank';
type CatalogRow = B2bCatalogItem & { lab_category?: string };

const COLLECTION_OPTIONS: Array<{ id: CollectionMode; label: string; hint: string }> = [
  { id: 'cash', label: 'Cash', hint: 'Payment received in cash at centre.' },
  { id: 'card', label: 'Card (POS)', hint: 'Card payment collected on hub POS terminal.' },
  { id: 'upi', label: 'UPI / QR', hint: 'UPI or QR payment confirmed at reception.' },
  { id: 'bank', label: 'Bank Transfer', hint: 'NEFT/IMPS transfer received for this bill.' },
];

const REF_OPTIONS = [
  { value: 'Walk-in / Self', label: 'Walk-in / Self' },
  { value: 'Doctor', label: 'Dr' },
  { value: 'Camp / Outreach', label: 'Camp / Outreach' },
  { value: 'Corporate', label: 'Corporate' },
] as const;

function isDoctorRef(value: string) {
  const v = value.trim().toLowerCase();
  return v === 'doctor' || v === 'dr' || v === 'dr.' || v.startsWith('doctor');
}
const UNCATEGORISED = 'Uncategorised';
const DOTS = ['#0f766e', '#7c3aed', '#dc2626', '#2563eb', '#ca8a04', '#db2777', '#059669'];
const CHIP_LIMIT = 5;

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function categoryOf(row: CatalogRow) {
  return (row.lab_category || row.item_group || '').trim() || UNCATEGORISED;
}

function dotColor(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash + label.charCodeAt(i)) % DOTS.length;
  return DOTS[hash];
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {children}
    </svg>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="po2-chip">
      <span className="po2-dot" style={{ background: dotColor(label) }} />
      {label}
    </span>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Patient Details', 'Select Tests', 'Payment & Confirm'];
  return (
    <nav className="po2-steps" aria-label="Walk-in order steps">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        return (
          <span key={label} style={{ display: 'contents' }}>
            {i > 0 ? <span className="po2-step-line" /> : null}
            <span className={`po2-step${n < current ? ' is-done' : n === current ? ' is-on' : ''}`}>
              <i>{n}</i>
              {label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

export function B2bOrderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState<1 | 2>(() => (searchParams.get('step') === '2' ? 2 : 1));
  const [walkInDraft, setWalkInDraft] = useState<WalkInDraft | null>(() =>
    searchParams.get('step') === '2' ? loadWalkInDraft() : null,
  );
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [age, setAge] = useState('');
  const [ageMonths, setAgeMonths] = useState('');
  const [ageDays, setAgeDays] = useState('');
  const [gender, setGender] = useState('Male');
  const [address, setAddress] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [waSame, setWaSame] = useState(true);
  const [refBy, setRefBy] = useState<string>('');
  const [referringDoctor, setReferringDoctor] = useState<ReferringDoctorValue>({
    id: null,
    name: '',
  });
  const [refCommissionPercent, setRefCommissionPercent] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [testSearch, setTestSearch] = useState('');
  const [testCategory, setTestCategory] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [collectionMode, setCollectionMode] = useState<CollectionMode>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [circuit, setCircuit] = useState<PartnerCircuit | null>(null);

  const doctorRequired = isDoctorRef(refBy);

  useEffect(() => {
    void api
      .getPartnerCircuit()
      .then((res) => setCircuit(res.data))
      .catch(() => setCircuit(null));
  }, []);

  useEffect(() => {
    void Promise.all([api.getB2bCatalog(), api.getLabCatalog().catch(() => null)]).then(([portal, publicCat]) => {
      const extras = new Map((publicCat?.data.items || []).map((row) => [row.name, row.lab_category || '']));
      setItems(
        (portal.data.items || []).map((row) => ({
          ...row,
          lab_category: extras.get(row.item_code) || '',
        })),
      );
    });
    const queued = consumeWalkInItemQueue();
    if (queued.length) {
      setSelectedCodes((current) => Array.from(new Set([...current, ...queued])));
    }
  }, []);

  useEffect(() => {
    if (waSame) setWhatsapp(patientPhone);
  }, [waSame, patientPhone]);

  const selectedItems = useMemo(
    () => selectedCodes.map((code) => items.find((item) => item.item_code === code)).filter(Boolean) as CatalogRow[],
    [items, selectedCodes],
  );

  const franchiseeType = items[0]?.franchisee_type || 'Pulse';
  const isVector = franchiseeType === 'Vector';
  const patientLabel = isVector ? 'Bill patient (MRP)' : 'Bill patient (FOCO)';
  const feeLabel = isVector ? 'Platform fee (wholesale)' : 'Platform fee (FOCO − commission)';
  const rateCol = isVector ? 'MRP (₹)' : 'FOCO Rate (₹)';

  const subtotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + Number(item.retail_rate || 0), 0),
    [selectedItems],
  );
  const wholesaleTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + Number(item.platform_fee ?? item.wholesale_rate ?? 0), 0),
    [selectedItems],
  );
  const marginTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + Number(item.commission_value ?? item.margin ?? 0), 0),
    [selectedItems],
  );
  const discountAmount = useMemo(() => {
    const raw = Number(discountInput || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.min(raw, subtotal);
  }, [discountInput, subtotal]);
  const payableAmount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

  const categories = useMemo(() => {
    const set = new Set(items.map(categoryOf));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);
  const visibleCats = categories.slice(0, CHIP_LIMIT);
  const extraCats = categories.slice(CHIP_LIMIT);

  const filteredCatalog = useMemo(() => {
    const query = testSearch.trim();
    return items.filter((item) => {
      if (testCategory && categoryOf(item) !== testCategory) return false;
      if (!query) return true;
      return matchesLabTestQuery(query, [item.item_name, item.item_code, categoryOf(item)]);
    });
  }, [items, testSearch, testCategory]);

  useEffect(() => {
    if (!selectedItems.length) {
      setAmountReceived('');
      return;
    }
    setAmountReceived(String(Math.round(payableAmount)));
  }, [payableAmount, selectedItems.length]);

  useEffect(() => {
    if (step === 2 && !walkInDraft) {
      const stored = loadWalkInDraft();
      if (stored) setWalkInDraft(stored);
      else setStep(1);
    }
  }, [step, walkInDraft]);

  useEffect(() => {
    if (!doctorRequired) {
      setReferringDoctor({ id: null, name: '' });
      setRefCommissionPercent('');
      return;
    }
    setReferringDoctor((prev) => (prev.name === 'Self' || !prev.name.trim() ? { id: null, name: '' } : prev));
  }, [doctorRequired]);

  function toggleTest(code: string) {
    setSelectedCodes((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  }

  function removeTest(code: string) {
    setSelectedCodes((current) => current.filter((item) => item !== code));
  }

  function clearPatientForm() {
    setPatientName('');
    setPatientPhone('');
    setAge('');
    setAgeMonths('');
    setAgeDays('');
    setGender('Male');
    setAddress('');
    setWhatsapp('');
    setWaSame(true);
    setRefBy('');
    setReferringDoctor({ id: null, name: '' });
    setRefCommissionPercent('');
    setError(null);
  }

  function buildDraft(): WalkInDraft {
    return {
      patientName: patientName.trim(),
      patientPhone: patientPhone.trim(),
      age: String(age || '').trim(),
      ageMonths: String(ageMonths || '').trim(),
      ageDays: String(ageDays || '').trim(),
      gender: String(gender || '').trim(),
      address: address.trim(),
      whatsapp: whatsapp.trim(),
      refBy,
      referringDoctorId: referringDoctor.id,
      referringDoctorName: referringDoctor.name,
      refCommissionPercent,
      selectedItems: selectedItems.map((item) => ({
        item_code: item.item_code,
        item_name: item.item_name,
        retail_rate: item.retail_rate,
        wholesale_rate: item.wholesale_rate,
        margin: item.margin,
      })),
      discountInput,
      collectionMode,
      amountReceived,
      paymentDate,
      notes,
    };
  }

  function continueToBill(e?: FormEvent) {
    e?.preventDefault();
    const name = patientName.trim();
    const phone = patientPhone.trim();
    const genderValue = String(gender || '').trim();

    if (!name || !phone || !genderValue || !selectedCodes.length) {
      setError('Patient name, mobile, gender and at least one lab test are required.');
      return;
    }
    if (!refBy.trim()) {
      setError('Ref By is required.');
      return;
    }
    if (
      doctorRequired &&
      (!referringDoctor.id || referringDoctor.id === 'Self' || !referringDoctor.name.trim() || referringDoctor.name === 'Self')
    ) {
      setError('Select or add a referring doctor.');
      return;
    }
    const draft = buildDraft();
    saveWalkInDraft(draft);
    setWalkInDraft(draft);
    setStep(2);
    setSearchParams({ step: '2' });
    setError(null);
  }

  function handleBillSaved() {
    clearWalkInDraft();
    setWalkInDraft(null);
    setPatientName('');
    setPatientPhone('');
    setWhatsapp('');
    setWaSame(true);
    setAddress('');
    setAge('');
    setAgeMonths('');
    setAgeDays('');
    setNotes('');
    setRefBy('');
    setReferringDoctor({ id: null, name: '' });
    setRefCommissionPercent('');
    setSelectedCodes([]);
    setDiscountInput('');
    setTestSearch('');
    setTestCategory('');
    setCollectionMode('cash');
    setPaymentDate(todayIso());
    setStep(1);
    setSearchParams({});
  }

  function backToIntake() {
    const stored = walkInDraft || loadWalkInDraft();
    if (stored) {
      setAge(stored.age || '');
      setAgeMonths(stored.ageMonths || '');
      setAgeDays(stored.ageDays || '');
      setRefBy(stored.refBy || '');
      setReferringDoctor({
        id: stored.referringDoctorId,
        name: stored.referringDoctorName || '',
      });
      setRefCommissionPercent(stored.refCommissionPercent || '');
    }
    setStep(1);
    setSearchParams({});
  }

  if (circuit && !canBillPatient(circuit)) {
    return (
      <div className="po2">
        <div className="po2-head">
          <h1>Walk-in Lab Order</h1>
          <p>Walk-in patient billing needs the FOCO module.</p>
        </div>
        <div className="partners-alert error">
          {circuit.franchise_name || 'This hub'} is a <b>{circuit.tier}</b> without Phlebotomist Service, so it cannot bill
          patients. It bills B2B partners (including FOCOs mapped under it) for sample accession and shipment. Ask the
          Remedium team to enable Phlebotomist Service if this centre also runs a FOCO.
        </div>
      </div>
    );
  }

  if (step === 2 && walkInDraft) {
    return (
      <div className="po2">
        <div className="po2-head">
          <h1>Walk-in Lab Order</h1>
          <p>Complete receipt, adjustments and save the work order once. Patient details from Step 1 are pre-filled.</p>
        </div>
        <Stepper current={3} />
        <HubBillEntryStep draft={walkInDraft} onBack={backToIntake} onSaved={handleBillSaved} />
      </div>
    );
  }

  return (
    <div className="po2">
      <div className="po2-head">
        <h1>Walk-in Lab Order</h1>
        <p>
          {isVector
            ? 'Create a new walk-in patient order. Platform fee is Vector wholesale, prepaid from wallet plus credit limit.'
            : 'Create a new walk-in patient order. Platform fee is FOCO minus commission, prepaid from wallet.'}
        </p>
      </div>
      <Stepper current={1} />

      <form onSubmit={(event) => continueToBill(event)}>
        <div className="po2-grid">
          <section className="po2-card" aria-label="Patient information">
            <div className="po2-card-head">
              <h2>
                <Icon>
                  <path d="M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                </Icon>
                Patient Information
              </h2>
              <button type="button" className="po2-ghost" onClick={clearPatientForm}>
                Clear form
              </button>
            </div>

            <div className="po2-fields">
              <label className="po2-field">
                <span>
                  Intake channel <i className="req">*</i>
                </span>
                <span className="po2-input">
                  <Icon>
                    <path d="M3 21h18M5 21V8l7-4 7 4v13" />
                  </Icon>
                  <input value="Walk-in" readOnly />
                </span>
              </label>
              <label className="po2-field">
                <span>
                  Patient name <i className="req">*</i>
                </span>
                <span className="po2-input">
                  <Icon>
                    <path d="M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                  </Icon>
                  <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required placeholder="Enter full name" />
                </span>
              </label>
              <label className="po2-field">
                <span>
                  Mobile number <i className="req">*</i>
                </span>
                <span className="po2-input">
                  <Icon>
                    <path d="M6.5 3h3l1.5 4-2 1.5a13 13 0 0 0 6 6L16.5 13l4 1.5v3A2 2 0 0 1 18.5 20 15.5 15.5 0 0 1 4 5.5 2 2 0 0 1 6.5 3z" />
                  </Icon>
                  <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} required placeholder="10-digit mobile number" />
                </span>
              </label>
              <label className="po2-check" style={{ alignSelf: 'end', marginBottom: 10 }}>
                <input type="checkbox" checked={waSame} onChange={(e) => setWaSame(e.target.checked)} />
                Mobile & WhatsApp Same No
              </label>
              <div className="po2-field is-wide">
                <span>Age</span>
                <div className="po2-age-triple">
                  <label className="po2-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={age}
                      onChange={(e) => {
                        const next = parseAgeInput(e.target.value);
                        if (next != null) setAge(next);
                      }}
                      placeholder="Years"
                      aria-label="Age in years"
                    />
                    <small>Years</small>
                  </label>
                  <label className="po2-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={ageMonths}
                      onChange={(e) => {
                        const next = parseAgeInput(e.target.value);
                        if (next != null) setAgeMonths(next);
                      }}
                      placeholder="Months"
                      aria-label="Age in months"
                    />
                    <small>Months</small>
                  </label>
                  <label className="po2-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={ageDays}
                      onChange={(e) => {
                        const next = parseAgeInput(e.target.value);
                        if (next != null) setAgeDays(next);
                      }}
                      placeholder="Days"
                      aria-label="Age in days"
                    />
                    <small>Days</small>
                  </label>
                </div>
              </div>
              <label className="po2-field">
                <span>
                  Gender <i className="req">*</i>
                </span>
                <span className="po2-input">
                  <Icon>
                    <path d="M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                  </Icon>
                  <select value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </span>
              </label>
              <label className="po2-field is-wide">
                <span>WhatsApp (optional)</span>
                <span className="po2-input">
                  <Icon>
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </Icon>
                  <input
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="Same as mobile number"
                    readOnly={waSame}
                  />
                </span>
              </label>
              <label className="po2-field is-wide">
                <span>Address (optional)</span>
                <span className="po2-input textarea">
                  <Icon>
                    <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11zM12 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
                  </Icon>
                  <textarea
                    value={address}
                    maxLength={200}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter patient address"
                  />
                </span>
                <span className="po2-count">{address.length}/200</span>
              </label>
              <label className="po2-field is-wide">
                <span>
                  Ref By <i className="req">*</i>
                </span>
                <span className="po2-input">
                  <Icon>
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                  </Icon>
                  <select
                    required
                    value={refBy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRefBy(next);
                      if (!isDoctorRef(next)) {
                        setReferringDoctor({ id: null, name: '' });
                        setRefCommissionPercent('');
                      }
                    }}
                  >
                    <option value="">Select Ref By</option>
                    {REF_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              {doctorRequired ? (
                <div className="po2-field is-wide">
                  <ReferringDoctorPicker
                    variant="partners"
                    value={referringDoctor}
                    onChange={(next) => {
                      setReferringDoctor(next);
                    }}
                    commissionPercent={refCommissionPercent}
                    onCommissionChange={setRefCommissionPercent}
                    showCommission
                    required
                    showAddButton
                    allowSelf={false}
                    placeholder="Search and select doctor"
                  />
                </div>
              ) : null}
            </div>

            <div className="po2-field" style={{ marginTop: 16 }}>
              <span>
                Lab Test / Box / Location / Mutation Analyse <i className="req">*</i>
              </span>
              <label className="po2-search">
                <Icon>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3-3" />
                </Icon>
                <input
                  type="search"
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                  placeholder="Search test name, code or category... (e.g. CBC, TSH, LFT)"
                  aria-label="Search lab tests"
                />
              </label>
              <div className="po2-chips">
                <button type="button" className={!testCategory ? 'is-on' : ''} onClick={() => setTestCategory('')}>
                  All Tests
                </button>
                {visibleCats.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={testCategory === name ? 'is-on' : ''}
                    onClick={() => setTestCategory(name === testCategory ? '' : name)}
                  >
                    {name}
                  </button>
                ))}
                {extraCats.length ? (
                  <div className="po2-more-wrap">
                    <button type="button" className="po2-more" onClick={() => setMoreOpen((v) => !v)}>
                      More
                    </button>
                    {moreOpen ? (
                      <div className="po2-more-menu">
                        {extraCats.map((name) => (
                          <button
                            type="button"
                            key={name}
                            className={testCategory === name ? 'is-on' : ''}
                            onClick={() => {
                              setTestCategory(name);
                              setMoreOpen(false);
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="po2-table-wrap">
                {filteredCatalog.length ? (
                  <table className="po2-table">
                    <thead>
                      <tr>
                        <th />
                        <th>Test Name</th>
                        <th>Category</th>
                        <th>MRP (₹)</th>
                        <th>{rateCol}</th>
                        <th>Platform (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCatalog.map((item) => {
                        const checked = selectedCodes.includes(item.item_code);
                        return (
                          <tr key={item.item_code} className={checked ? 'is-on' : ''}>
                            <td>
                              <input type="checkbox" checked={checked} onChange={() => toggleTest(item.item_code)} />
                            </td>
                            <td>{item.item_name}</td>
                            <td>
                              <Chip label={categoryOf(item)} />
                            </td>
                            <td>{money(Number(item.mrp || item.retail_rate || 0))}</td>
                            <td>{money(Number(item.retail_rate || 0))}</td>
                            <td>{money(Number(item.platform_fee ?? item.wholesale_rate ?? 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="po2-empty">No tests match this search.</p>
                )}
              </div>
            </div>
            {error ? <p className="po2-alert">{error}</p> : null}
          </section>

          <aside>
            <section className="po2-card" aria-label="Selected tests">
              <div className="po2-card-head">
                <h2>
                  <Icon>
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <path d="M8 9h8M8 13h5" />
                  </Icon>
                  Selected Tests ({selectedItems.length})
                </h2>
                {selectedItems.length ? (
                  <button type="button" className="po2-ghost is-danger" onClick={() => setSelectedCodes([])}>
                    Clear all
                  </button>
                ) : null}
              </div>
              {selectedItems.length ? (
                <>
                  <ul className="po2-picked">
                    {selectedItems.map((item) => (
                      <li key={item.item_code}>
                        <span>{item.item_name}</span>
                        <strong>{money(item.retail_rate)}</strong>
                        <button type="button" aria-label={`Remove ${item.item_name}`} onClick={() => removeTest(item.item_code)}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="po2-totals">
                    <div>
                      <span>{patientLabel}</span>
                      <strong>{money(subtotal)}</strong>
                    </div>
                    <div>
                      <span>Discount</span>
                      <strong>{money(discountAmount)}</strong>
                    </div>
                    <div>
                      <span>Final payable</span>
                      <strong>{money(payableAmount)}</strong>
                    </div>
                    <div>
                      <span>{feeLabel}</span>
                      <strong>{money(wholesaleTotal)}</strong>
                    </div>
                    <div>
                      <span>Your commission</span>
                      <strong>{money(marginTotal)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <div className="po2-empty">
                  <div className="po2-empty-ico">
                    <Icon>
                      <path d="M8 3h8l2 4H6zM7 7h10v13H7zM12 11v6M9 14h6" />
                    </Icon>
                  </div>
                  <strong>No tests added yet</strong>
                  <small>Search and select tests from the left panel to add to this order.</small>
                </div>
              )}
            </section>

            <section className="po2-card" style={{ marginTop: 14 }} aria-label="Payment method">
              <div className="po2-card-head">
                <h2>
                  <Icon>
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <path d="M3 10h18" />
                  </Icon>
                  Payment Method <i className="req">*</i>
                </h2>
              </div>
              <p className="po2-head" style={{ margin: 0 }}>
                <span style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 500 }}>Select how the payment was collected.</span>
              </p>
              <div className="po2-pay" role="radiogroup" aria-label="Collection method">
                {COLLECTION_OPTIONS.map((option) => (
                  <label key={option.id} className={collectionMode === option.id ? 'is-on' : ''}>
                    <input
                      type="radio"
                      name="collection_mode"
                      value={option.id}
                      checked={collectionMode === option.id}
                      onChange={() => setCollectionMode(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="po2-fields">
                <label className="po2-field">
                  <span>Discount (₹)</span>
                  <span className="po2-input">
                    <span>%</span>
                    <input
                      inputMode="decimal"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="0"
                    />
                  </span>
                </label>
                <label className="po2-field">
                  <span>
                    Amount received (₹) <i className="req">*</i>
                  </span>
                  <span className="po2-input">
                    <span>₹</span>
                    <input
                      inputMode="decimal"
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="Enter amount"
                    />
                  </span>
                </label>
                <label className="po2-field is-wide">
                  <span>
                    Payment date <i className="req">*</i>
                  </span>
                  <span className="po2-input">
                    <Icon>
                      <path d="M8 2v3M16 2v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                    </Icon>
                    <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
                  </span>
                </label>
                <label className="po2-field is-wide">
                  <span>Notes (optional)</span>
                  <span className="po2-input textarea">
                    <Icon>
                      <path d="M4 5h16v14H4zM8 9h8M8 13h5" />
                    </Icon>
                    <textarea
                      value={notes}
                      maxLength={300}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Any payment or patient notes..."
                    />
                  </span>
                  <span className="po2-count">{notes.length}/300</span>
                </label>
              </div>
              <button className="po2-submit" type="submit" disabled={!selectedCodes.length}>
                Continue to Preview Bill
                <Icon>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </Icon>
              </button>
            </section>
          </aside>
        </div>
      </form>

      <p className="po2-note">
        Step 1: Collect patient details and select tests. Step 2: Preview bill and confirm payment. Step 3: Save the bill
        and print barcode (appears after save).
      </p>
    </div>
  );
}
