export interface PlatformAnalytics {
  totalGmvCents: number;
  gmv30dCents: number;
  gmv30dDeltaPct: number;
  mrrCents: number;
  activeSubscriptions: number;
  orders30d: number;
  orders30dDeltaPct: number;
  revenueSeries: Array<{ date: string; cents: number }>;
  topTenants: Array<{ tenantId: string; name: string; totalCents: number }>;
  methodSplit: { cash: number; card: number };
}
