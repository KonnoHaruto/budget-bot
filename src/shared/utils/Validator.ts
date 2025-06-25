import { ValidationError } from './ErrorHandler';

/**
 * バリデーションルール
 */
export interface ValidationRule<T = any> {
  validate: (value: T) => boolean;
  message: string;
}

/**
 * 汎用バリデーター
 */
export class Validator {
  /**
   * 必須チェック
   */
  static required<T>(value: T, fieldName: string): void {
    if (value === null || value === undefined || 
        (typeof value === 'string' && value.trim().length === 0)) {
      throw new ValidationError(`${fieldName} is required`);
    }
  }

  /**
   * 文字列の長さチェック
   */
  static stringLength(
    value: string, 
    fieldName: string, 
    min?: number, 
    max?: number
  ): void {
    if (typeof value !== 'string') {
      throw new ValidationError(`${fieldName} must be a string`);
    }

    if (min !== undefined && value.length < min) {
      throw new ValidationError(`${fieldName} must be at least ${min} characters`);
    }

    if (max !== undefined && value.length > max) {
      throw new ValidationError(`${fieldName} must be no more than ${max} characters`);
    }
  }

  /**
   * 数値の範囲チェック
   */
  static numberRange(
    value: number,
    fieldName: string,
    min?: number,
    max?: number
  ): void {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(`${fieldName} must be a valid number`);
    }

    if (min !== undefined && value < min) {
      throw new ValidationError(`${fieldName} must be at least ${min}`);
    }

    if (max !== undefined && value > max) {
      throw new ValidationError(`${fieldName} must be no more than ${max}`);
    }
  }

  /**
   * 正の数チェック
   */
  static positiveNumber(value: number, fieldName: string): void {
    this.numberRange(value, fieldName, 0.01);
  }

  /**
   * 整数チェック
   */
  static integer(value: number, fieldName: string): void {
    if (!Number.isInteger(value)) {
      throw new ValidationError(`${fieldName} must be an integer`);
    }
  }

  /**
   * 通貨コードチェック
   */
  static currencyCode(value: string, fieldName: string = 'currency'): void {
    const validCurrencies = ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'KRW'];
    
    if (!validCurrencies.includes(value.toUpperCase())) {
      throw new ValidationError(
        `${fieldName} must be one of: ${validCurrencies.join(', ')}`
      );
    }
  }

  /**
   * 日付チェック
   */
  static date(value: any, fieldName: string): Date {
    let date: Date;

    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string') {
      date = new Date(value);
    } else {
      throw new ValidationError(`${fieldName} must be a valid date`);
    }

    if (isNaN(date.getTime())) {
      throw new ValidationError(`${fieldName} must be a valid date`);
    }

    return date;
  }

  /**
   * 年月チェック
   */
  static yearMonth(year: any, month: any): { year: number; month: number } {
    const yearNum = Number(year);
    const monthNum = Number(month);

    this.numberRange(yearNum, 'year', 1900, 2100);
    this.integer(yearNum, 'year');
    
    this.numberRange(monthNum, 'month', 1, 12);
    this.integer(monthNum, 'month');

    return { year: yearNum, month: monthNum };
  }

  /**
   * URLチェック
   */
  static url(value: string, fieldName: string = 'URL'): void {
    try {
      new URL(value);
    } catch {
      throw new ValidationError(`${fieldName} must be a valid URL`);
    }
  }

  /**
   * LINE User IDチェック
   */
  static lineUserId(value: string, fieldName: string = 'userId'): void {
    this.required(value, fieldName);
    this.stringLength(value, fieldName, 1, 100);
    
    // LINE User IDは通常Uで始まる
    if (!value.startsWith('U')) {
      throw new ValidationError(`${fieldName} must be a valid LINE User ID`);
    }
  }

  /**
   * 金額チェック
   */
  static amount(value: any, fieldName: string = 'amount'): number {
    const amount = Number(value);
    
    this.positiveNumber(amount, fieldName);
    this.numberRange(amount, fieldName, 0.01, 10000000); // 1円〜1000万円
    
    return amount;
  }

  /**
   * 説明文チェック
   */
  static description(value: string, fieldName: string = 'description'): string {
    this.required(value, fieldName);
    this.stringLength(value, fieldName, 1, 100);
    
    return value.trim();
  }

  /**
   * カスタムルールでのバリデーション
   */
  static custom<T>(
    value: T,
    fieldName: string,
    rules: ValidationRule<T>[]
  ): void {
    for (const rule of rules) {
      if (!rule.validate(value)) {
        throw new ValidationError(`${fieldName}: ${rule.message}`);
      }
    }
  }

  /**
   * オブジェクトの複数フィールドをバリデーション
   */
  static validateObject<T extends Record<string, any>>(
    obj: T,
    schema: Record<keyof T, (value: any) => any>
  ): T {
    const validated: any = {};

    for (const [key, validator] of Object.entries(schema)) {
      try {
        validated[key] = validator(obj[key]);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ValidationError(`${String(key)}: ${error.message}`);
        }
        throw error;
      }
    }

    return validated;
  }

  /**
   * 予算設定のバリデーション
   */
  static budgetInput(input: {
    userId: string;
    amount: any;
    currency?: string;
  }): {
    userId: string;
    amount: number;
    currency: string;
  } {
    const validated = this.validateObject(input, {
      userId: (value) => {
        this.lineUserId(value);
        return value;
      },
      amount: (value) => this.amount(value),
      currency: (value) => {
        const currency = value || 'JPY';
        this.currencyCode(currency);
        return currency.toUpperCase();
      }
    });
    
    return {
      userId: validated.userId,
      amount: validated.amount,
      currency: validated.currency
    } as { userId: string; amount: number; currency: string; };
  }

  /**
   * 支出追加のバリデーション
   */
  static expenseInput(input: {
    userId: string;
    amount: any;
    description: string;
    currency?: string;
    imageUrl?: string;
  }): {
    userId: string;
    amount: number;
    description: string;
    currency: string;
    imageUrl?: string;
  } {
    const validated = this.validateObject(input, {
      userId: (value) => {
        this.lineUserId(value);
        return value;
      },
      amount: (value) => this.amount(value),
      description: (value) => this.description(value),
      currency: (value) => {
        const currency = value || 'JPY';
        this.currencyCode(currency);
        return currency.toUpperCase();
      },
      imageUrl: (value) => {
        if (value && typeof value === 'string') {
          this.url(value, 'imageUrl');
        }
        return value;
      }
    });
    
    return {
      userId: validated.userId,
      amount: validated.amount,
      description: validated.description,
      currency: validated.currency,
      imageUrl: validated.imageUrl
    } as { userId: string; amount: number; description: string; currency: string; imageUrl?: string; };
  }

  /**
   * 取引更新のバリデーション
   */
  static transactionUpdateInput(input: {
    transactionId: any;
    amount?: any;
    description?: string;
    currency?: string;
    imageUrl?: string;
  }): {
    transactionId: number;
    amount?: number;
    description?: string;
    currency?: string;
    imageUrl?: string;
  } {
    const validated: any = {};

    // transactionIDは必須
    validated.transactionId = Number(input.transactionId);
    this.integer(validated.transactionId, 'transactionId');
    this.numberRange(validated.transactionId, 'transactionId', 1);

    // その他のフィールドは任意
    if (input.amount !== undefined) {
      validated.amount = this.amount(input.amount);
    }

    if (input.description !== undefined) {
      validated.description = this.description(input.description);
    }

    if (input.currency !== undefined) {
      this.currencyCode(input.currency);
      validated.currency = input.currency.toUpperCase();
    }

    if (input.imageUrl !== undefined) {
      if (input.imageUrl && typeof input.imageUrl === 'string') {
        this.url(input.imageUrl, 'imageUrl');
      }
      validated.imageUrl = input.imageUrl;
    }

    return validated;
  }

  /**
   * 予算状況取得のバリデーション
   */
  static budgetStatusQuery(query: {
    userId: string;
    year?: any;
    month?: any;
  }): {
    userId: string;
    year?: number;
    month?: number;
  } {
    const validated: any = {};

    this.lineUserId(query.userId);
    validated.userId = query.userId;

    if (query.year !== undefined || query.month !== undefined) {
      const yearMonth = this.yearMonth(
        query.year || new Date().getFullYear(),
        query.month || new Date().getMonth() + 1
      );
      validated.year = yearMonth.year;
      validated.month = yearMonth.month;
    }

    return validated;
  }
}