import { addDays, insert, nextSeq, row, run, stamp, todayStr, tx, weekday, clockStr } from './db.mjs';

const SETTINGS = {
  clinic_name: 'Remedium Care',
  tagline: 'Pain Relief & Rehabilitation Centre',
  support_email: 'care.support@remedium.in',
  phone: '',
  address: 'Barasat, North 24 Parganas, West Bengal',
  gstin: '',
  invoice_prefix: 'RC/INV',
  invoice_footer: 'Thank you for choosing Remedium Care. Wishing you a speedy recovery.',
};

const SERVICES = [
  ['consultation', 'Doctor Consultation', 600, 15],
  ['consultation', 'Doctor Consultation (Follow-up)', 400, 10],
  ['consultation', 'Orthopaedic Consultation', 800, 20],
  ['consultation', 'Pain Management Consultation', 700, 20],
  ['physiotherapy', 'Physiotherapy Session', 600, 45],
  ['physiotherapy', 'Physiotherapy Assessment', 500, 30],
  ['physiotherapy', 'Back & Neck Pain Therapy', 700, 45],
  ['physiotherapy', 'Post-operative Rehabilitation', 800, 60],
  ['physiotherapy', 'Sports Injury Rehabilitation', 800, 60],
  ['physiotherapy', 'Electrotherapy (IFT / TENS)', 400, 30],
  ['physiotherapy', 'Therapeutic Ultrasound', 400, 20],
  ['physiotherapy', 'Dry Needling / Cupping', 900, 30],
  ['lab', 'Complete Blood Count (CBC)', 350, 0],
  ['lab', 'Thyroid Stimulating Hormone (TSH)', 300, 0],
  ['lab', 'Thyroid Profile (T3, T4, TSH)', 550, 0],
  ['lab', 'Vitamin D (25-OH)', 1200, 0],
  ['lab', 'Vitamin B12', 900, 0],
  ['lab', 'Uric Acid', 200, 0],
  ['lab', 'RA Factor', 450, 0],
  ['lab', 'C-Reactive Protein (CRP)', 450, 0],
  ['lab', 'ESR', 120, 0],
  ['lab', 'Calcium (Serum)', 250, 0],
  ['lab', 'HbA1c', 500, 0],
  ['lab', 'Lipid Profile', 600, 0],
];

const AESTHETIC_SETTINGS = {
  clinic_name: 'Remedium Aesthetic',
  tagline: 'Skin, Hair & Body Clinic · a unit of Smilecure Lifestyle Pvt. Ltd.',
  support_email: 'aesthetic.support@remedium.in',
  phone: '',
  address: 'Bongaon & Barasat, North 24 Parganas, West Bengal',
  gstin: '',
  invoice_prefix: 'RA/INV',
  invoice_footer: 'Thank you for choosing Remedium Aesthetic.',
};

/* Aesthetic instance: settings and the two clinics; treatments come from the aesthetic service catalogue. */
function seedAesthetic(db) {
  tx(db, () => {
    for (const [key, value] of Object.entries(AESTHETIC_SETTINGS)) {
      run(db, 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
    }
    for (const [name, code, city] of [['Bongaon', 'BGN', 'Bongaon'], ['Barasat', 'BRS', 'Barasat']]) {
      insert(db, 'branches', { name, code, city, address: `${city}, North 24 Parganas, West Bengal`, phone: '', manager: '', active: 1, created_at: stamp() });
    }
  });
  return true;
}

export function seedMasters(db, flavor = 'care') {
  const has = row(db, 'SELECT COUNT(*) AS n FROM branches').n > 0;
  if (has) return false;
  if (flavor === 'aesthetic') return seedAesthetic(db);
  tx(db, () => {
    for (const [key, value] of Object.entries(SETTINGS)) {
      run(db, 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
    }
    insert(db, 'branches', {
      name: 'Barasat Care Centre',
      code: 'BRS',
      city: 'Barasat',
      address: 'Barasat, North 24 Parganas, West Bengal',
      phone: '',
      manager: '',
      active: 1,
      created_at: stamp(),
    });
    for (const [category, name, price, duration] of SERVICES) {
      insert(db, 'services', { category, name, price, duration, active: 1 });
    }
  });
  return true;
}

/* ---------------------------------------------------------------- sample data */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_M = ['Anirban', 'Subhojit', 'Debasis', 'Sourav', 'Arijit', 'Rajib', 'Tapas', 'Sandip', 'Amit', 'Partha', 'Kaushik', 'Sumit', 'Abhijit', 'Pranab', 'Biswajit', 'Ritam', 'Indranil', 'Suman', 'Dipankar', 'Arnab', 'Saikat', 'Ayan', 'Tanmay', 'Gautam'];
const FIRST_F = ['Riya', 'Moumita', 'Sudeshna', 'Payel', 'Sreeparna', 'Tanushree', 'Ananya', 'Rituparna', 'Mousumi', 'Sharmila', 'Debjani', 'Priyanka', 'Swati', 'Rumki', 'Sohini', 'Madhumita', 'Barnali', 'Ishita', 'Paromita', 'Koel'];
const LAST = ['Saha', 'Das', 'Roy', 'Paul', 'Ghosh', 'Banerjee', 'Mukherjee', 'Chatterjee', 'Sen', 'Dutta', 'Bose', 'Sarkar', 'Mondal', 'Biswas', 'Chakraborty', 'Majumdar', 'Haldar', 'Pal', 'Kundu', 'Nandi'];
const CONDITIONS = ['Lower back pain', 'Cervical spondylosis', 'Frozen shoulder', 'Knee osteoarthritis', 'Sciatica', 'Plantar fasciitis', 'Post-op ACL rehab', 'Tennis elbow', 'Ankle sprain', 'Stroke rehabilitation', 'Lumbar disc prolapse', 'Neck pain'];
const MODES = ['UPI', 'UPI', 'UPI', 'Cash', 'Cash', 'Card'];

const PRACTITIONERS = [
  { name: 'Dr. Arindam Mukherjee', role: 'Doctor', specialty: 'Orthopaedics', fee: 600 },
  { name: 'Dr. Sharmistha Bose', role: 'Doctor', specialty: 'Pain Medicine', fee: 700 },
  { name: 'Sayan Chatterjee', role: 'Physiotherapist', specialty: 'BPT, Musculoskeletal', fee: 600 },
  { name: 'Priyanka Dutta', role: 'Physiotherapist', specialty: 'MPT, Neuro Rehab', fee: 700 },
  { name: 'Rahul Biswas', role: 'Physiotherapist', specialty: 'BPT, Sports', fee: 600 },
  { name: 'Tanmoy Ghosh', role: 'Lab Technician', specialty: 'Phlebotomy', fee: 0 },
  { name: 'Soma Saha', role: 'Pharmacist', specialty: 'D.Pharm', fee: 0 },
];

// name, category, unit, stock, reorder, cost, price, expiryDays
const ITEMS = [
  ['Ultrasound Gel (500 ml)', 'Physio Supply', 'bottle', 8, 10, 140, 220, null],
  ['Paracetamol 500 mg', 'Medicine', 'strip', 12, 20, 12, 20, 300],
  ['Kinesio Tape (5 cm)', 'Physio Supply', 'roll', 14, 10, 260, 450, null],
  ['Disinfectant Solution (1 L)', 'Housekeeping', 'bottle', 7, 5, 180, 260, null],
  ['Diclofenac Gel 30 g', 'Medicine', 'tube', 40, 15, 65, 110, 420],
  ['Aceclofenac + Paracetamol', 'Medicine', 'strip', 35, 20, 38, 68, 380],
  ['Calcium + Vitamin D3', 'Medicine', 'strip', 50, 20, 70, 125, 500],
  ['Pregabalin 75 mg', 'Medicine', 'strip', 25, 10, 95, 165, 45],
  ['Methylcobalamin 1500 mcg', 'Medicine', 'strip', 30, 15, 85, 150, 260],
  ['Etoricoxib 90 mg', 'Medicine', 'strip', 18, 15, 110, 190, 32],
  ['Pantoprazole 40 mg', 'Medicine', 'strip', 40, 20, 45, 85, 410],
  ['Thiocolchicoside 4 mg', 'Medicine', 'strip', 22, 10, 120, 210, 330],
  ['Hot Pack (Reusable)', 'Physio Supply', 'piece', 6, 4, 320, 520, null],
  ['Crepe Bandage 10 cm', 'Consumable', 'roll', 30, 10, 45, 80, null],
  ['Cervical Collar (Soft)', 'Orthotic', 'piece', 5, 3, 210, 380, null],
  ['LS Belt (Medium)', 'Orthotic', 'piece', 4, 3, 520, 890, null],
  ['Knee Cap (Pair)', 'Orthotic', 'pair', 8, 4, 260, 450, null],
  ['TENS Electrode Pads', 'Physio Supply', 'pack', 20, 10, 150, 260, null],
  ['Nitrile Gloves (Box of 100)', 'Consumable', 'box', 9, 5, 380, 520, null],
  ['Vacutainer EDTA', 'Lab Consumable', 'piece', 120, 50, 6, 10, 240],
  ['Syringe 5 ml', 'Lab Consumable', 'piece', 200, 80, 4, 7, null],
  ['Alcohol Swabs', 'Lab Consumable', 'piece', 300, 100, 1, 2, null],
  ['Resistance Band (Medium)', 'Physio Supply', 'piece', 10, 5, 240, 420, null],
];

// name, category, status, cost, lastServiceDaysAgo, nextServiceInDays
const ASSETS = [
  ['IFT Therapy Unit', 'Electrotherapy', 'Working', 68000, 70, 20],
  ['TENS Unit (Dual Channel)', 'Electrotherapy', 'Working', 9500, 40, 50],
  ['Therapeutic Ultrasound Unit', 'Electrotherapy', 'Working', 42000, 85, 5],
  ['Shortwave Diathermy', 'Electrotherapy', 'Under Maintenance', 125000, 120, -2],
  ['Cervical & Lumbar Traction Unit', 'Traction', 'Working', 98000, 30, 60],
  ['CPM Machine (Knee)', 'Rehabilitation', 'Working', 85000, 55, 35],
  ['Motorised Treadmill', 'Exercise', 'Working', 72000, 20, 70],
  ['Static Exercise Cycle', 'Exercise', 'Working', 24000, 20, 70],
  ['Hydrocollator (Hot Pack Unit)', 'Thermotherapy', 'Working', 36000, 60, 3],
  ['Wax Bath Unit', 'Thermotherapy', 'Working', 18000, 90, 0],
  ['Laboratory Centrifuge', 'Laboratory', 'Working', 28000, 45, 45],
  ['Pharmacy Refrigerator', 'Pharmacy', 'Working', 32000, 100, 80],
  ['Billing Desk Computer & Printer', 'IT', 'Working', 54000, 150, 30],
];

export function seedDemo(db) {
  if (row(db, 'SELECT COUNT(*) AS n FROM patients').n > 0) return false;
  const rand = rng(20261029);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const today = todayStr();
  const nowClock = clockStr();
  const branchId = row(db, 'SELECT id FROM branches ORDER BY id LIMIT 1').id;
  const services = db.prepare('SELECT * FROM services').all();
  const svc = (cat) => services.filter((s) => s.category === cat);

  tx(db, () => {
    const practitioners = PRACTITIONERS.map((p) =>
      ({ ...p, id: insert(db, 'practitioners', { ...p, branch_id: branchId, active: 1, demo: 1 }) }),
    );
    const doctors = practitioners.filter((p) => p.role === 'Doctor');
    const physios = practitioners.filter((p) => p.role === 'Physiotherapist');
    const labTech = practitioners.find((p) => p.role === 'Lab Technician');

    const items = ITEMS.map(([name, category, unit, stock, reorder, cost, price, expiryDays]) => {
      const sku = `RC-${String(nextSeq(db, 'item')).padStart(4, '0')}`;
      const id = insert(db, 'items', {
        name, sku, category, unit, stock, reorder_level: reorder, cost, price,
        expiry: expiryDays == null ? null : addDays(today, expiryDays),
        vendor: category === 'Medicine' ? 'Barasat Medical Agencies' : 'Kolkata Surgicals',
        branch_id: branchId, active: 1, created_at: `${addDays(today, -90)} 10:00:00`, demo: 1,
      });
      insert(db, 'stock_moves', { item_id: id, qty: stock, kind: 'Opening', note: 'Opening stock', at: `${addDays(today, -90)} 10:00:00`, by: 'system', demo: 1 });
      return { id, name, price, category };
    });
    const medicines = items.filter((i) => i.category === 'Medicine' || i.category === 'Orthotic');

    ASSETS.forEach(([name, category, status, cost, lastAgo, nextIn]) => {
      const n = nextSeq(db, 'asset');
      const id = insert(db, 'assets', {
        tag: `RC-AST-${String(n).padStart(3, '0')}`, name, category, branch_id: branchId, status,
        purchase_date: addDays(today, -between(200, 900)), cost, vendor: 'Medisys Healthcare',
        last_service: addDays(today, -lastAgo), next_service: addDays(today, nextIn), notes: '',
        created_at: stamp(), demo: 1,
      });
      insert(db, 'asset_logs', { asset_id: id, at: `${addDays(today, -lastAgo)} 11:00:00`, kind: 'Service', note: 'Routine preventive maintenance', by: 'system', demo: 1 });
    });

    // Patients
    const named = [['Anirban Saha', 'Male'], ['Riya Das', 'Female'], ['Subhojit Roy', 'Male'], ['Moumita Paul', 'Female'], ['Debasis Ghosh', 'Male']];
    const patients = [];
    const total = 340;
    for (let i = 0; i < total; i += 1) {
      const female = i < named.length ? named[i][1] === 'Female' : rand() < 0.48;
      const name = i < named.length ? named[i][0] : `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
      const daysAgo = i < named.length ? between(5, 40) : Math.floor((1 - Math.sqrt(rand())) * 160);
      const created = addDays(today, -daysAgo);
      const id = insert(db, 'patients', {
        code: `RC-P-${String(nextSeq(db, 'patient')).padStart(5, '0')}`,
        name, gender: female ? 'Female' : 'Male', age: between(19, 78),
        mobile: `${pick(['98', '97', '90', '83', '79', '62'])}${String(between(10000000, 99999999))}`,
        address: pick(['Barasat', 'Madhyamgram', 'Duttapukur', 'Hridaypur', 'Nabapally', 'Kazipara', 'Champadali']),
        condition: pick(CONDITIONS), branch_id: branchId,
        created_at: `${created} ${String(between(9, 19)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00`,
        created_by: 'system', demo: 1,
      });
      patients.push({ id, name, created });
    }
    const patientOn = (date) => {
      const pool = patients.filter((p) => p.created <= date);
      return pick(pool.length ? pool : patients);
    };

    const invoices = [];
    const appt = (data) => insert(db, 'appointments', {
      code: `AP-${String(nextSeq(db, 'appointment')).padStart(6, '0')}`,
      branch_id: branchId, created_by: 'system', demo: 1, ...data,
    });
    const slot = (i) => {
      const minutes = 9 * 60 + i * 20 + between(0, 10);
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    };
    const todayStatus = (time, flow) => {
      if (time < nowClock) return rand() < 0.08 ? 'No Show' : flow.done;
      const mins = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      const gap = mins(time) - mins(nowClock);
      if (gap < 30) return pick(flow.active);
      return 'Scheduled';
    };
    const billFor = (apptId, patient, type, name, amount, date, time) => {
      const roll = rand();
      const paid = roll < 0.9 ? amount : roll < 0.95 ? Math.round(amount / 2) : 0;
      invoices.push({ apptId, patient_id: patient.id, service_type: type, items: [{ name, qty: 1, rate: amount, amount }], total: amount, paid, at: `${date} ${time}:00` });
    };

    // Physiotherapy plans with scheduled sessions
    for (let d = -75; d <= 0; d += 1) {
      const start = addDays(today, d);
      if (weekday(start) === 0) continue;
      const count = rand() < 0.75 ? between(1, 2) : 0;
      for (let k = 0; k < count; k += 1) {
        const patient = patientOn(start);
        const therapist = pick(physios);
        const sessions = pick([6, 8, 10, 10, 12]);
        const service = pick(svc('physiotherapy').filter((s) => s.name !== 'Physiotherapy Assessment'));
        const freq = rand() < 0.5 ? 'daily' : 'alternate';
        const time = slot(between(0, 28));
        const planId = insert(db, 'therapy_plans', {
          code: `PT-${String(nextSeq(db, 'plan')).padStart(5, '0')}`, patient_id: patient.id,
          condition: pick(CONDITIONS), practitioner_id: therapist.id, total_sessions: sessions,
          fee: service.price, start_date: start, frequency: freq, status: 'Active', notes: '',
          branch_id: branchId, created_at: `${start} 09:30:00`, created_by: 'system', demo: 1,
        });
        let date = start;
        let completedAll = true;
        for (let s = 1; s <= sessions; s += 1) {
          while (weekday(date) === 0) date = addDays(date, 1);
          let status = 'Scheduled';
          if (date < today) status = rand() < 0.94 ? 'Completed' : 'No Show';
          else if (date === today) status = todayStatus(time, { done: 'Completed', active: ['Checked In', 'In Session', 'In Session'] });
          if (status !== 'Completed') completedAll = false;
          const id = appt({ patient_id: patient.id, type: 'physiotherapy', service: service.name, practitioner_id: therapist.id, plan_id: planId, session_no: s, date, time, status, fee: service.price, created_at: `${start} 09:30:00` });
          if (status === 'Completed') billFor(id, patient, 'physiotherapy', `${service.name} (Session ${s}/${sessions})`, service.price, date, time);
          date = addDays(date, freq === 'daily' ? 1 : 2);
        }
        if (completedAll) run(db, "UPDATE therapy_plans SET status = 'Completed' WHERE id = ?", planId);
      }
    }

    // Consultations and lab bookings, past 60 days through the next week
    for (let d = -60; d <= 6; d += 1) {
      const date = addDays(today, d);
      const sunday = weekday(date) === 0;
      const future = d > 0;
      const nConsult = future ? between(1, 4) : sunday ? between(1, 3) : between(6, 12);
      const nLab = future ? between(0, 2) : sunday ? between(0, 2) : between(3, 8);
      for (let i = 0; i < nConsult; i += 1) {
        const patient = patientOn(date);
        const doctor = pick(doctors);
        const service = rand() < 0.65 ? svc('consultation')[0] : pick(svc('consultation'));
        const time = slot(Math.floor((i * 28) / Math.max(nConsult, 1)));
        let status = 'Scheduled';
        if (d < 0) status = rand() < 0.93 ? 'Completed' : pick(['No Show', 'Cancelled']);
        else if (d === 0) status = todayStatus(time, { done: 'Completed', active: ['Checked In', 'Waiting'] });
        const id = appt({ patient_id: patient.id, type: 'consultation', service: service.name, practitioner_id: doctor.id, date, time, status, fee: service.price, created_at: `${addDays(date, -between(0, 3))} 10:00:00` });
        if (status === 'Completed' || (d === 0 && status === 'Checked In')) billFor(id, patient, 'consultation', service.name, service.price, date, time);
      }
      for (let i = 0; i < nLab; i += 1) {
        const patient = patientOn(date);
        const pool = svc('lab');
        const tests = [];
        const n = between(1, 3);
        while (tests.length < n) {
          const t = pick(pool);
          if (!tests.some((x) => x.name === t.name)) tests.push({ name: t.name, price: t.price });
        }
        const fee = tests.reduce((sum, t) => sum + t.price, 0);
        const time = slot(between(0, 12));
        let status = 'Scheduled';
        if (d < 0) status = rand() < 0.96 ? 'Reported' : 'Cancelled';
        else if (d === 0) status = time < nowClock ? pick(['Sample Collected', 'Reported']) : pick(['Waiting', 'Scheduled']);
        const id = appt({
          patient_id: patient.id, type: 'lab', service: tests.map((t) => t.name).join(', '), tests: JSON.stringify(tests),
          practitioner_id: labTech.id, date, time, status, fee,
          result: status === 'Reported' ? 'All parameters within reference range except where flagged.' : null,
          created_at: `${date} 08:30:00`,
        });
        if (status !== 'Cancelled' && d <= 0) {
          invoices.push({ apptId: id, patient_id: patient.id, service_type: 'lab', items: tests.map((t) => ({ name: t.name, qty: 1, rate: t.price, amount: t.price })), total: fee, paid: fee, at: `${date} ${time}:00` });
        }
      }
      if (!future) {
        const nPharm = sunday ? between(1, 3) : between(5, 10);
        for (let i = 0; i < nPharm; i += 1) {
          const lines = [];
          const n = between(1, 3);
          while (lines.length < n) {
            const it = pick(medicines);
            if (!lines.some((l) => l.item_id === it.id)) {
              const qty = between(1, 3);
              lines.push({ item_id: it.id, name: it.name, qty, rate: it.price, amount: qty * it.price });
            }
          }
          const total = lines.reduce((sum, l) => sum + l.amount, 0);
          const time = slot(between(0, 28));
          if (d === 0 && time > nowClock) continue;
          invoices.push({ apptId: null, patient_id: patientOn(date).id, service_type: 'pharmacy', items: lines, total, paid: total, at: `${date} ${time}:00` });
        }
      }
    }

    invoices.sort((a, b) => a.at.localeCompare(b.at));
    for (const inv of invoices) {
      const yymmdd = inv.at.slice(2, 10).replace(/-/g, '');
      const number = `RC/INV/${yymmdd}-${String(nextSeq(db, 'invoice')).padStart(4, '0')}`;
      const status = inv.paid >= inv.total ? 'Paid' : inv.paid > 0 ? 'Partially Paid' : 'Unpaid';
      const mode = pick(MODES);
      const id = insert(db, 'invoices', {
        number, patient_id: inv.patient_id, service_type: inv.service_type, items: JSON.stringify(inv.items),
        subtotal: inv.total, discount: 0, total: inv.total, paid: inv.paid, status, payment_mode: inv.paid > 0 ? mode : null,
        appointment_id: inv.apptId, branch_id: branchId, created_at: inv.at, created_by: 'system', demo: 1,
      });
      if (inv.paid > 0) insert(db, 'payments', { invoice_id: id, amount: inv.paid, mode, at: inv.at, by: 'system', demo: 1 });
      if (inv.apptId) run(db, 'UPDATE appointments SET invoice_id = ? WHERE id = ?', id, inv.apptId);
    }
  });
  return true;
}

export function clearDemo(db) {
  const demoPatients = 'SELECT id FROM patients WHERE demo = 1';
  const demoInvoices = `SELECT id FROM invoices WHERE demo = 1 OR patient_id IN (${demoPatients})`;
  const steps = [
    ['session_bills', `DELETE FROM session_bills WHERE patient_id IN (${demoPatients})`],
    ['payments', `DELETE FROM payments WHERE demo = 1 OR invoice_id IN (${demoInvoices})`],
    ['invoices', `DELETE FROM invoices WHERE demo = 1 OR patient_id IN (${demoPatients})`],
    ['appointments', `DELETE FROM appointments WHERE demo = 1 OR patient_id IN (${demoPatients})`],
    ['therapy_plans', `DELETE FROM therapy_plans WHERE demo = 1 OR patient_id IN (${demoPatients})`],
    ['patients', 'DELETE FROM patients WHERE demo = 1'],
    ['stock_moves', 'DELETE FROM stock_moves WHERE demo = 1 OR item_id IN (SELECT id FROM items WHERE demo = 1)'],
    ['items', 'DELETE FROM items WHERE demo = 1'],
    ['asset_logs', 'DELETE FROM asset_logs WHERE demo = 1 OR asset_id IN (SELECT id FROM assets WHERE demo = 1)'],
    ['assets', 'DELETE FROM assets WHERE demo = 1'],
  ];
  return tx(db, () => {
    const out = {};
    for (const [table, sql] of steps) out[table] = Number(run(db, sql).changes);
    run(db, 'UPDATE appointments SET practitioner_id = NULL WHERE practitioner_id IN (SELECT id FROM practitioners WHERE demo = 1)');
    run(db, 'UPDATE therapy_plans SET practitioner_id = NULL WHERE practitioner_id IN (SELECT id FROM practitioners WHERE demo = 1)');
    out.practitioners = Number(run(db, 'DELETE FROM practitioners WHERE demo = 1').changes);
    return out;
  });
}
