export type ReportLifecycleJourney = {
  journey_id: string;
  patient_name?: string;
  status: string;
  customer_trf?: string;
  modified?: string;
  ago?: string;
  pathologist_notes?: string;
  authorized_on?: string;
  report_pdf?: string;
  lab_report?: string | null;
  report_status?: string | null;
};

export type ReportLifecycleVerified = {
  lab_report: string;
  trf_id: string;
  journey_id?: string | null;
  report_status: string;
  patient_name?: string;
  modified?: string;
  ago?: string;
};

export type ReportLifecycleQueue = {
  pending_review: ReportLifecycleJourney[];
  verified_reports: ReportLifecycleVerified[];
  authorized: ReportLifecycleJourney[];
  dispatched: ReportLifecycleJourney[];
  counts: {
    pending_review: number;
    verified_reports: number;
    authorized: number;
    dispatched_recent: number;
  };
  can_authorize: boolean;
};
