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

export type ReportChromeTemplate =
  | 'with_header'
  | 'without_header'
  | 'nabl'
  | 'non_nabl'
  | 'none'
  | 'remedium_with_header'
  | 'remedium_without_header'
  | 'slpl_with_header'
  | 'slpl_without_header';

export type ReportWhatsAppResult = {
  recipient?: string;
  portal_account_created?: boolean;
  portal_url?: string;
  [key: string]: unknown;
};
