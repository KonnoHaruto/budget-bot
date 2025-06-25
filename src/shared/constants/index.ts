/**
 * アプリケーション定数
 */

/**
 * 通貨定数
 */
export const CURRENCIES = {
  JPY: 'JPY',
  USD: 'USD', 
  EUR: 'EUR',
  GBP: 'GBP',
  CNY: 'CNY',
  KRW: 'KRW'
} as const;

export type Currency = typeof CURRENCIES[keyof typeof CURRENCIES];

/**
 * 通貨記号
 */
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  KRW: '₩'
};

/**
 * 金額制限
 */
export const AMOUNT_LIMITS = {
  MIN: 1,                    // 1円/1セント
  MAX: 10_000_000,          // 1000万円/10万ドル
  BUDGET_MIN: 1000,         // 最低予算 1000円
  BUDGET_MAX: 10_000_000    // 最大予算 1000万円
} as const;

/**
 * 文字列長制限
 */
export const STRING_LIMITS = {
  DESCRIPTION_MIN: 1,
  DESCRIPTION_MAX: 100,
  USER_ID_MAX: 100
} as const;

/**
 * 日付制限
 */
export const DATE_LIMITS = {
  YEAR_MIN: 1900,
  YEAR_MAX: 2100
} as const;

/**
 * 予算警告レベルの閾値
 */
export const BUDGET_WARNING_THRESHOLDS = {
  WARNING: 50,   // 50%超過で警告
  DANGER: 80,    // 80%超過で危険
  OVER: 100      // 100%超過で超過
} as const;

/**
 * 予算アラートの閾値
 */
export const BUDGET_ALERT_THRESHOLDS = {
  WARNING: 70,   // 70%超過でアラート
  DANGER: 90,    // 90%超過で危険アラート
  OVER: 100      // 100%超過で超過アラート
} as const;

/**
 * OCR処理の設定
 */
export const OCR_SETTINGS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024,  // 10MB
  SUPPORTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp'],
  TIMEOUT_MS: 30000,                 // 30秒
  RETRY_COUNT: 3
} as const;

/**
 * LINE設定
 */
export const LINE_SETTINGS = {
  MAX_MESSAGE_LENGTH: 5000,
  FLEX_MESSAGE_MAX_ITEMS: 12,
  CAROUSEL_MAX_COLUMNS: 10
} as const;

/**
 * Cloud Tasks設定
 */
export const CLOUD_TASKS_SETTINGS = {
  DEFAULT_DELAY_SECONDS: 10,
  MAX_RETRY_COUNT: 5,
  RETRY_DELAY_SECONDS: 60
} as const;

/**
 * キャッシュ設定
 */
export const CACHE_SETTINGS = {
  PROCESSING_TRACKER_TTL: 15 * 60 * 1000,  // 15分
  USER_CACHE_TTL: 5 * 60 * 1000,           // 5分
  CURRENCY_RATE_TTL: 8 * 60 * 60 * 1000    // 8時間
} as const;

/**
 * ログ設定
 */
export const LOG_SETTINGS = {
  MAX_CONTEXT_SIZE: 1000,    // ログコンテキストの最大文字数
  PERFORMANCE_THRESHOLD: 1000 // パフォーマンス警告の閾値（ms）
} as const;

/**
 * エラーメッセージ
 */
export const ERROR_MESSAGES = {
  // バリデーション
  REQUIRED_FIELD: '{field} is required',
  INVALID_FORMAT: '{field} has invalid format',
  VALUE_TOO_SMALL: '{field} must be at least {min}',
  VALUE_TOO_LARGE: '{field} must be no more than {max}',
  
  // ビジネスロジック
  USER_NOT_FOUND: 'User not found',
  TRANSACTION_NOT_FOUND: 'Transaction not found',
  BUDGET_NOT_SET: 'Budget is not set',
  INSUFFICIENT_BUDGET: 'Insufficient budget remaining',
  
  // 外部API
  OCR_FAILED: 'Failed to process receipt image',
  LINE_API_ERROR: 'LINE API error occurred',
  CLOUD_TASKS_ERROR: 'Failed to enqueue task',
  
  // システム
  DATABASE_ERROR: 'Database operation failed',
  NETWORK_ERROR: 'Network connection error',
  INTERNAL_ERROR: 'Internal server error occurred'
} as const;

/**
 * 成功メッセージ
 */
export const SUCCESS_MESSAGES = {
  BUDGET_SET: '予算を{amount}に設定しました',
  EXPENSE_ADDED: '支出を追加しました: {description} {amount}',
  EXPENSE_UPDATED: '支出を更新しました',
  EXPENSE_DELETED: '支出を削除しました',
  BUDGET_CLEARED: '予算設定をクリアしました'
} as const;

/**
 * デフォルト値
 */
export const DEFAULTS = {
  CURRENCY: CURRENCIES.JPY,
  PAGINATION_LIMIT: 20,
  TRANSACTION_HISTORY_LIMIT: 5,
  BUDGET_SUGGESTIONS_COUNT: 3
} as const;

/**
 * 正規表現パターン
 */
export const REGEX_PATTERNS = {
  LINE_USER_ID: /^U[0-9a-f]{32}$/,
  AMOUNT: /^\d+(\.\d{1,2})?$/,
  CURRENCY_CODE: /^[A-Z]{3}$/,
  URL: /^https?:\/\/.+/
} as const;

/**
 * ライフスタイル別予算倍率
 */
export const LIFESTYLE_MULTIPLIERS = {
  minimal: [0.7, 1.0, 1.3],
  moderate: [1.0, 1.5, 2.0],
  comfortable: [1.5, 2.0, 3.0]
} as const;

/**
 * 環境変数のキー
 */
export const ENV_KEYS = {
  // LINE
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  LINE_CHANNEL_SECRET: 'LINE_CHANNEL_SECRET',
  
  // Google Cloud
  GOOGLE_CLOUD_PROJECT_ID: 'GOOGLE_CLOUD_PROJECT_ID',
  GOOGLE_CLOUD_LOCATION: 'GOOGLE_CLOUD_LOCATION',
  GOOGLE_CLOUD_QUEUE_NAME: 'GOOGLE_CLOUD_QUEUE_NAME',
  CLOUD_FUNCTION_URL: 'CLOUD_FUNCTION_URL',
  
  // Database
  DATABASE_URL: 'DATABASE_URL',
  
  // Logging
  LOG_LEVEL: 'LOG_LEVEL',
  
  // Environment
  NODE_ENV: 'NODE_ENV',
  PORT: 'PORT'
} as const;