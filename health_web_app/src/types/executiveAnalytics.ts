export type ExecutiveAnalyticsResponse = {
  period: string;
  period_label: string;
  start_date: string;
  end_date: string;
  summary: {
    total_revenue: number;
    lab_revenue: number;
    pharmacy_revenue: number;
    appointment_revenue: number;
    subscription_revenue: number;
    marketing_spend: number;
    estimated_cac: number | null;
    avg_ltv_proxy: number;
    new_patients: number;
    repeat_patients: number;
    unique_active_patients: number;
    critical_alerts_open: number;
  };
  funnel: Record<string, number>;
  hub_breakdown: Array<{
    franchisee_id: string;
    franchise_name: string;
    bookings: number;
    paid_bookings: number;
    revenue: number;
    conversion_rate: number;
  }>;
  revenue_trend: Array<{ date: string; lab_revenue: number }>;
  periods: Array<{ key: string; label: string }>;
};

export type CriticalAlertRow = {
  name: string;
  patient_name?: string;
  lab_report?: string;
  customer_trf?: string;
  parameter: string;
  result_value: string;
  unit?: string;
  abnormal_flag: string;
  reference_range?: string;
  alert_status: string;
  notified_patient?: number;
  notified_staff?: number;
  creation?: string;
};

export type CriticalAlertsResponse = {
  alerts: CriticalAlertRow[];
  count: number;
};
