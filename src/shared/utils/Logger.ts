/**
 * ログレベル
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

/**
 * ログエントリ
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  error?: Error;
}

/**
 * 統一ロガー
 */
export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private context: Record<string, any> = {};

  private constructor() {
    this.logLevel = this.getLogLevelFromEnv();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * 環境変数からログレベルを取得
   */
  private getLogLevelFromEnv(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'DEBUG': return LogLevel.DEBUG;
      case 'INFO': return LogLevel.INFO;
      case 'WARN': return LogLevel.WARN;
      case 'ERROR': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  /**
   * コンテキストを設定
   */
  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * コンテキストをクリア
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * ログレベルを設定
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * デバッグログ
   */
  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * 情報ログ
   */
  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * 警告ログ
   */
  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * エラーログ
   */
  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * ログ出力
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): void {
    if (level < this.logLevel) {
      return;
    }

    const logEntry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context: { ...this.context, ...context },
      error
    };

    this.output(logEntry);
  }

  /**
   * ログを実際に出力
   */
  private output(entry: LogEntry): void {
    const levelName = LogLevel[entry.level];
    const timestamp = entry.timestamp.toISOString();
    
    const logObject = {
      level: levelName,
      timestamp,
      message: entry.message,
      ...entry.context
    };

    if (entry.error) {
      (logObject as any).error = {
        name: entry.error.name,
        message: entry.error.message,
        stack: entry.error.stack
      };
    }

    // 開発環境では読みやすい形式、本番環境ではJSON形式
    if (process.env.NODE_ENV === 'development') {
      const colorCodes = {
        DEBUG: '\x1b[36m', // Cyan
        INFO: '\x1b[32m',  // Green
        WARN: '\x1b[33m',  // Yellow
        ERROR: '\x1b[31m'  // Red
      };
      const resetColor = '\x1b[0m';
      const color = colorCodes[levelName as keyof typeof colorCodes] || '';
      
      console.log(
        `${color}[${levelName}]${resetColor} ${timestamp} ${entry.message}`,
        entry.context && Object.keys(entry.context).length > 0 ? entry.context : '',
        entry.error ? entry.error : ''
      );
    } else {
      console.log(JSON.stringify(logObject));
    }
  }

  /**
   * パフォーマンス測定用タイマー
   */
  timer(label: string): () => void {
    const start = Date.now();
    this.debug(`Timer started: ${label}`);
    
    return () => {
      const duration = Date.now() - start;
      this.info(`Timer finished: ${label}`, { duration: `${duration}ms` });
    };
  }

  /**
   * 非同期関数の実行時間を測定
   */
  async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const stopTimer = this.timer(label);
    try {
      const result = await fn();
      stopTimer();
      return result;
    } catch (error) {
      stopTimer();
      this.error(`Error in ${label}`, error as Error);
      throw error;
    }
  }

  /**
   * 同期関数の実行時間を測定
   */
  measure<T>(label: string, fn: () => T): T {
    const stopTimer = this.timer(label);
    try {
      const result = fn();
      stopTimer();
      return result;
    } catch (error) {
      stopTimer();
      this.error(`Error in ${label}`, error as Error);
      throw error;
    }
  }
}

// シングルトンインスタンスをエクスポート
export const logger = Logger.getInstance();