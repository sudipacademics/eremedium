export type GamificationLeader = {
  rank: number;
  employee: string;
  employee_name?: string;
  total_points: number;
  total_revenue: number;
  activity_count: number;
};

export type GamificationLeaderboard = {
  period: string;
  label: string;
  start_date: string;
  end_date: string;
  leaders: GamificationLeader[];
};

export type GamificationRule = {
  name: string;
  rule_code: string;
  title: string;
  reference_doctype: string;
  trigger_event: string;
  base_points: number;
  points_per_1000_revenue: number;
};

export type GamificationEntry = {
  name: string;
  employee: string;
  employee_name?: string;
  points: number;
  rule_code?: string;
  revenue_amount?: number;
  reference_doctype?: string;
  reference_name?: string;
  activity_date?: string;
  creation?: string;
};

export type MyGamificationStats = {
  employee?: string | null;
  employee_name?: string | null;
  linked: boolean;
  period_points: Record<
    string,
    { label: string; total_points: number; total_revenue: number }
  >;
};

export type StaffGamificationResponse = {
  leaderboards: Record<string, GamificationLeaderboard>;
  recent_entries: GamificationEntry[];
  active_rules: GamificationRule[];
  summary: {
    all_time_points: number;
    all_time_revenue: number;
    all_time_entries: number;
  };
  my_stats: MyGamificationStats;
  desk_url: string;
};
