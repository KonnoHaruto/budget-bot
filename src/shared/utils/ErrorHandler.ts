import { logger } from './Logger';

/**
 * エラーカテゴリ
 */
export enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  BUSINESS_LOGIC = 'BUSINESS_LOGIC',
  EXTERNAL_API = 'EXTERNAL_API',
  DATABASE = 'DATABASE',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  NETWORK = 'NETWORK',
  SYSTEM = 'SYSTEM',
  UNKNOWN = 'UNKNOWN'
}

/**
 * アプリケーションエラーの基底クラス
 */
export class AppError extends Error {
  public readonly category: ErrorCategory;
  public readonly isOperational: boolean;
  public readonly statusCode: number;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, any>
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.category = category;
    this.isOperational = isOperational;
    this.statusCode = statusCode;
    this.context = context;

    // V8スタックトレースのキャプチャ
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, ErrorCategory.VALIDATION, 400, true, context);
  }
}

/**
 * ビジネスロジックエラー
 */
export class BusinessLogicError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, ErrorCategory.BUSINESS_LOGIC, 422, true, context);
  }
}

/**
 * 外部API エラー
 */
export class ExternalApiError extends AppError {
  constructor(message: string, statusCode: number = 502, context?: Record<string, any>) {
    super(message, ErrorCategory.EXTERNAL_API, statusCode, true, context);
  }
}

/**
 * データベースエラー
 */
export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, ErrorCategory.DATABASE, 500, true, context);
  }
}

/**
 * 認証エラー
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', context?: Record<string, any>) {
    super(message, ErrorCategory.AUTHENTICATION, 401, true, context);
  }
}

/**
 * 認可エラー
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', context?: Record<string, any>) {
    super(message, ErrorCategory.AUTHORIZATION, 403, true, context);
  }
}

/**
 * ネットワークエラー
 */
export class NetworkError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, ErrorCategory.NETWORK, 502, true, context);
  }
}

/**
 * エラーハンドラー
 */
export class ErrorHandler {
  /**
   * エラーを適切にログ出力
   */
  static logError(error: Error, context?: Record<string, any>): void {
    if (error instanceof AppError) {
      const logContext = {
        category: error.category,
        statusCode: error.statusCode,
        isOperational: error.isOperational,
        ...error.context,
        ...context
      };

      if (error.isOperational) {
        logger.warn(error.message, logContext);
      } else {
        logger.error(error.message, error, logContext);
      }
    } else {
      logger.error(error.message, error, context);
    }
  }

  /**
   * エラーからHTTPステータスコードを決定
   */
  static getHttpStatusCode(error: Error): number {
    if (error instanceof AppError) {
      return error.statusCode;
    }

    // その他のエラーは500
    return 500;
  }

  /**
   * エラーからクライアント向けメッセージを作成
   */
  static getClientMessage(error: Error): string {
    if (error instanceof AppError && error.isOperational) {
      return error.message;
    }

    // 本番環境では詳細なエラーメッセージを隠す
    if (process.env.NODE_ENV === 'production') {
      return 'An internal server error occurred';
    }

    return error.message;
  }

  /**
   * エラーがリトライ可能かどうかを判定
   */
  static isRetryable(error: Error): boolean {
    if (error instanceof AppError) {
      switch (error.category) {
        case ErrorCategory.NETWORK:
        case ErrorCategory.EXTERNAL_API:
          return error.statusCode >= 500 || error.statusCode === 429;
        case ErrorCategory.DATABASE:
          return true;
        default:
          return false;
      }
    }

    // 不明なエラーは基本的にリトライしない
    return false;
  }

  /**
   * Cloud Tasks用のエラー分類
   */
  static classifyForCloudTasks(error: Error): 'permanent' | 'temporary' {
    if (error instanceof AppError) {
      switch (error.category) {
        case ErrorCategory.VALIDATION:
        case ErrorCategory.AUTHENTICATION:
        case ErrorCategory.AUTHORIZATION:
        case ErrorCategory.BUSINESS_LOGIC:
          return 'permanent';
        
        case ErrorCategory.NETWORK:
        case ErrorCategory.EXTERNAL_API:
        case ErrorCategory.DATABASE:
        case ErrorCategory.SYSTEM:
          return 'temporary';
        
        default:
          return 'temporary';
      }
    }

    // 不明なエラーは一時的なものとして扱う
    return 'temporary';
  }

  /**
   * エラーメトリクスの記録
   */
  static recordMetrics(error: Error): void {
    const category = error instanceof AppError ? error.category : ErrorCategory.UNKNOWN;
    const statusCode = this.getHttpStatusCode(error);
    
    // メトリクス記録の実装は環境に応じて
    logger.info('Error metrics recorded', {
      errorCategory: category,
      statusCode,
      errorName: error.name
    });
  }

  /**
   * 包括的なエラー処理
   */
  static handle(error: Error, context?: Record<string, any>): {
    statusCode: number;
    message: string;
    isRetryable: boolean;
    category: string;
  } {
    // ログ出力
    this.logError(error, context);
    
    // メトリクス記録
    this.recordMetrics(error);

    return {
      statusCode: this.getHttpStatusCode(error),
      message: this.getClientMessage(error),
      isRetryable: this.isRetryable(error),
      category: error instanceof AppError ? error.category : ErrorCategory.UNKNOWN
    };
  }

  /**
   * Promise のエラーハンドリング
   */
  static async safeExecute<T>(
    fn: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      this.logError(error as Error, context);
      return null;
    }
  }

  /**
   * 非同期関数のリトライ実行
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 1000,
    context?: Record<string, any>
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        const shouldRetry = this.isRetryable(lastError) && attempt < maxAttempts;
        
        this.logError(lastError, {
          ...context,
          attempt,
          maxAttempts,
          willRetry: shouldRetry
        });

        if (!shouldRetry) {
          throw lastError;
        }

        // 指数バックオフ
        const delay = delayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}