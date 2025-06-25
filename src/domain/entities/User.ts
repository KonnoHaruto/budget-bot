import { Money } from '../valueObjects/Money';

/**
 * ユーザーエンティティ
 */
export class User {
  private _id: string;
  private _monthlyBudget: Money | null;
  private _createdAt: Date;
  private _updatedAt: Date;

  constructor(
    id: string,
    monthlyBudget: Money | null = null,
    createdAt?: Date,
    updatedAt?: Date
  ) {
    if (!id || id.trim().length === 0) {
      throw new Error('User ID is required');
    }

    this._id = id.trim();
    this._monthlyBudget = monthlyBudget;
    this._createdAt = createdAt || new Date();
    this._updatedAt = updatedAt || new Date();
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get monthlyBudget(): Money | null {
    return this._monthlyBudget;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  /**
   * 予算が設定されているかチェック
   */
  hasBudget(): boolean {
    return this._monthlyBudget !== null && this._monthlyBudget.isPositive();
  }

  /**
   * 月間予算を設定
   */
  setBudget(budget: Money): void {
    if (!budget.isPositive()) {
      throw new Error('Budget must be positive');
    }
    
    this._monthlyBudget = budget;
    this._updatedAt = new Date();
  }

  /**
   * 予算をクリア
   */
  clearBudget(): void {
    this._monthlyBudget = null;
    this._updatedAt = new Date();
  }

  /**
   * 予算使用率を計算
   */
  calculateBudgetUsage(totalExpense: Money): number {
    if (!this.hasBudget()) {
      return 0;
    }

    if (this._monthlyBudget!.currency !== totalExpense.currency) {
      throw new Error('Budget and expense currencies must match');
    }

    if (this._monthlyBudget!.isZero()) {
      return 0;
    }

    return (totalExpense.amount / this._monthlyBudget!.amount) * 100;
  }

  /**
   * 残り予算を計算
   */
  calculateRemainingBudget(totalExpense: Money): Money {
    if (!this.hasBudget()) {
      return Money.zero(totalExpense.currency);
    }

    if (this._monthlyBudget!.currency !== totalExpense.currency) {
      throw new Error('Budget and expense currencies must match');
    }

    const remaining = this._monthlyBudget!.subtract(totalExpense);
    return remaining.isPositive() ? remaining : Money.zero(totalExpense.currency);
  }

  /**
   * 予算オーバーかチェック
   */
  isOverBudget(totalExpense: Money): boolean {
    if (!this.hasBudget()) {
      return false;
    }

    return totalExpense.isGreaterThan(this._monthlyBudget!);
  }

  /**
   * 予算警告レベルを取得
   */
  getBudgetWarningLevel(totalExpense: Money): 'safe' | 'warning' | 'danger' | 'over' {
    if (!this.hasBudget()) {
      return 'safe';
    }

    const usageRate = this.calculateBudgetUsage(totalExpense);

    if (usageRate > 100) return 'over';
    if (usageRate > 80) return 'danger';
    if (usageRate > 50) return 'warning';
    return 'safe';
  }

  /**
   * ユーザーの等価性チェック
   */
  equals(other: User): boolean {
    return this._id === other._id;
  }

  /**
   * JSON形式に変換
   */
  toJSON(): {
    id: string;
    monthlyBudget: { amount: number; currency: string } | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: this._id,
      monthlyBudget: this._monthlyBudget ? this._monthlyBudget.toJSON() : null,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString()
    };
  }

  /**
   * 表示用文字列
   */
  toString(): string {
    const budget = this._monthlyBudget ? this._monthlyBudget.toString() : 'No budget';
    return `User(${this._id}): Budget ${budget}`;
  }

  /**
   * ファクトリーメソッド - 新規ユーザー作成
   */
  static create(id: string): User {
    return new User(id);
  }

  /**
   * ファクトリーメソッド - 予算付きユーザー作成
   */
  static createWithBudget(id: string, budget: Money): User {
    const user = new User(id);
    user.setBudget(budget);
    return user;
  }

  /**
   * ファクトリーメソッド - 既存データから復元
   */
  static fromData(data: {
    id: string;
    monthlyBudget?: number | null;
    currency?: string;
    createdAt: Date | string;
    updatedAt?: Date | string;
  }): User {
    const monthlyBudget = data.monthlyBudget 
      ? new Money(data.monthlyBudget, data.currency || 'JPY')
      : null;
    
    const createdAt = typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt;
    const updatedAt = data.updatedAt 
      ? (typeof data.updatedAt === 'string' ? new Date(data.updatedAt) : data.updatedAt)
      : createdAt;

    return new User(data.id, monthlyBudget, createdAt, updatedAt);
  }
}