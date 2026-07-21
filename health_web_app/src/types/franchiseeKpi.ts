export interface FranchiseeKpiPeriod {
  key: string;
  label: string;
}

export interface FranchiseeKpiValues {
  total_bookings: number;
  revenue_paid: number;
  revenue_pending: number;
  commission_earned: number;
  completed: number;
  cancelled: number;
  avg_order_value: number;
  conversion_rate: number;
}

export interface FranchiseeKpiTopTest {
  test: string;
  count: number;
}

export interface FranchiseeKpiTrendPoint {
  date: string;
  revenue: number;
}

export interface FranchiseeKpiResponse {
  franchisee: {
    name: string;
    franchise_name?: string;
    branch_code?: string;
    territory_region?: string | null;
    commission_rate?: number;
  };
  period: string;
  period_label: string;
  start_date: string;
  kpis: FranchiseeKpiValues;
  pipeline: Record<string, number>;
  top_tests: FranchiseeKpiTopTest[];
  revenue_trend: FranchiseeKpiTrendPoint[];
  periods: FranchiseeKpiPeriod[];
}
