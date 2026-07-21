export const JOURNEY_STEPS = [
  'Nursing Intake',
  'Doctor Consultation',
  'Prescription Issued',
  'Medicine Ordered',
  'Diagnostics Booked',
  'Phlebotomist Assigned',
  'Sample Collected',
  'In Lab',
  'Report Review',
  'Authorized',
  'Dispatched',
] as const;

export type JourneyLabResult = {
  analyte_test_name?: string;
  numeric_result_value?: number | string;
  unit_of_measure?: string;
  reference_range?: string;
  abnormal_flag?: string;
};

export type JourneyTestSection = {
  test_name?: string;
  test?: string;
  parameters?: JourneyLabResult[];
};

export type CareJourney = {
  journey_id: string;
  patient?: string;
  patient_name: string;
  status: string;
  trf_id?: string;
  prescription?: string;
  pharmacy_order?: string;
  report_pdf?: string;
  pathologist_notes?: string;
  authorized_on?: string;
  results?: JourneyLabResult[];
  structured?: { tests?: JourneyTestSection[] };
};
