// タイムアウト設定
export const LIGHT_TIMEOUT_MS = 1000; // 軽量OCRのタイムアウト
export const FULL_TIMEOUT_MS = 1500; // フル処理のタイムアウト

// 予算設定のクイックリプライ
export const BUDGET_QUICK_REPLY_MIN = 30000; // 最小予算額
export const BUDGET_QUICK_REPLY_MAX = 100000; // 最大予算額
export const BUDGET_QUICK_REPLY_STEP = 10000; // 予算設定の増分

// 予算設定インストラクション用のクイックリプライ
export const BUDGET_INSTRUCTION_MIN = 40000; // 最小予算額
export const BUDGET_INSTRUCTION_MAX = 100000; // 最大予算額
export const BUDGET_INSTRUCTION_STEP = 10000; // 予算設定の増分

// 時間設定
export const PENDING_BUDGET_TIMEOUT_MS = 300000; // 5分以内（予算設定待機時間）

// OCR処理設定
export const OCR_TEXT_PREVIEW_LENGTH = 100; // Light OCR テキストプレビューの長さ
export const OCR_TEXT_PREVIEW_LENGTH_FULL = 200; // Full OCR テキストプレビューの長さ
export const REMAINING_TIME_THRESHOLD = 100; // 残り時間の閾値（ms）

// 取引取得数
export const RECENT_TRANSACTIONS_LIMIT = 50; // 削除・編集時の取引取得数
export const CHART_TRANSACTIONS_LIMIT = 100; // チャート用の取引取得数

// パーセンテージ閾値
export const BUDGET_WARNING_THRESHOLD = 80; // 予算警告の閾値（%）
export const BUDGET_DANGER_THRESHOLD = 100; // 予算危険の閾値（%）

// プログレスバー設定
export const PROGRESS_BAR_TOTAL_DOTS = 10; // プログレスバーの総ドット数
export const PROGRESS_BAR_MAX_WIDTH = 100; // プログレスバーの最大幅（%）

// 時間計算
export const WEEK_DAYS = 7; // 1週間の日数
export const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24; // 1日のミリ秒数

// HTTP ステータスコード
export const HTTP_BAD_REQUEST = 400;

// 色設定
export const COLORS = {
  primary: '#06C755',
  secondary: '#2196F3',
  success: '#17c950',
  warning: '#FF9800',
  danger: '#F44336',
  error: '#FF334B',
  text: {
    primary: '#333333',
    secondary: '#666666',
    muted: '#999999'
  },
  background: {
    primary: '#06C755',
    secondary: '#2196F3',
    success: '#17c950',
    danger: '#FF334B'
  }
} as const;