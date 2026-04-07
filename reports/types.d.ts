export interface StockItem {
  articleNumber: string;
  name?: string;
  category?: string;
  unit?: string;
  supplier?: string;
  MOQ?: number;
  leadTimeDays?: number;
  safetyDays?: number;
  minQty?: number;
  orderUrl?: string;
  isActive?: boolean;
}

export interface StockMovement {
  id: string;
  articleNumber: string;
  movType: 'receipt' | 'issue' | 'stocktake';
  qty: number;
  timestamp: string;
  note?: string;
  deviceId?: string;
}

export interface ColoradoRecord {
  id: string;
  machineId: string;
  timestamp: string;
  inkTotalLiters: number;
  mediaTotalM2: number;
  note?: string;
  createdAt?: string;
}

export interface PrintLogRow {
  readyAt: string;
  printerName: string;
  jobName?: string;
  result?: string;
  mediaType?: string;
  printedAreaM2?: number | null;
  mediaLengthM?: number | null;
  durationSec?: number | null;
  inkTotalL?: number | null;
  inkCyanL?: number | null;
  inkMagentaL?: number | null;
  inkYellowL?: number | null;
  inkBlackL?: number | null;
  inkWhiteL?: number | null;
  sourceFile?: string | null;
}

export interface StockSummary {
  articleNumber: string;
  onHand: number;
  avgWeekly: number;
  daysLeft: number;
  status: 'ok' | 'warn' | 'crit';
  moveCount: number;
}

export interface ColoradoInterval {
  machineId: string;
  from: string;
  to: string;
  days: number;
  inkTotalTo: number;
  mediaTotalTo: number;
  inkUsed: number;
  mediaUsed: number;
  inkPerDay: number;
  mediaPerDay: number;
  inkPerM2: number | null;
  inkCost: number;
  mediaCost: number;
  totalCost: number;
  costPerM2: number | null;
  recordId: string;
}

export interface ColoradoMonthlySummaryRow {
  rowType: 'interval' | 'machine_total' | 'month_total';
  reportMonthFrom: string;
  reportMonthTo: string;
  machine: string;
  timestampFrom?: string;
  timestampTo?: string;
  daysElapsed?: number;
  inkTotalLTo?: number;
  mediaTotalM2To?: number;
  inkUsedL?: number;
  mediaUsedM2?: number;
  inkPerM2?: number | null;
  inkCost?: number | null;
  mediaCost?: number | null;
  totalCost?: number | null;
  costPerM2?: number | null;
}

export interface PrintErrorSummary {
  totalGroups: number;
  firstPassCount: number;
  firstPassRate: number;
  resolvedAfterRetryCount: number;
  unresolvedCount: number;
  avgAttempts: number;
  avgAttemptsSuccess: number;
}

export interface CsvColumnDef<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
}
