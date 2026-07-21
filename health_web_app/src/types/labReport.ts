export type LabReportParam = {
  name: string;
  idx: number;
  include_in_report: number;
  test_name: string;
  parameter_code: string;
  description: string;
  result_value: string;
  unit: string;
  lower_range: number | null;
  upper_range: number | null;
  method: string;
  is_calculated: number;
  formula: string;
  abnormal_flag: string;
  interpretation: string;
  diagnostic_test: string;
  erp_item_code: string;
};

export type LabReportDetail = {
  lab_report: string;
  customer_trf: string;
  care_journey?: string | null;
  report_status: string;
  department?: string;
  report_title_1?: string;
  report_title_2?: string;
  patient_name?: string;
  specimen?: string;
  parameters: LabReportParam[];
  changed?: number;
};

export type LabReportQueueRow = {
  trf_id: string;
  patient_name?: string;
  order_status: string;
  test_required?: string;
  franchisee_id?: string;
  collection_slot?: string;
  modified?: string;
  lab_report: string | null;
  report_status: string | null;
};

export type LabReportReviewRow = {
  lab_report: string;
  trf_id: string;
  journey_id?: string | null;
  report_status: string;
  patient_name?: string;
  modified?: string;
};

export type LabReportQueue = {
  queue: LabReportQueueRow[];
  pending_review: LabReportReviewRow[];
  queue_count: number;
  review_count: number;
};

/** Editable subset a technician can send back on save. */
export type LabReportParamEdit = {
  name: string;
  result_value?: string;
  unit?: string;
  method?: string;
  abnormal_flag?: string;
  interpretation?: string;
  include_in_report?: number;
};

export const ABNORMAL_FLAGS = ['', 'N', 'H', 'L', 'Critical'] as const;

export const ABNORMAL_FLAG_LABELS: Record<string, string> = {
  '': '—',
  N: 'Normal',
  H: 'High',
  L: 'Low',
  Critical: 'Critical',
};
