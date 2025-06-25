import { Money } from '../valueObjects/Money';

/**
 * 取引エンティティ
 */
export class Transaction {
  private _id: number;
  private _userId: string;
  private _amount: Money;
  private _description: string;
  private _imageUrl: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;

  constructor(
    id: number,
    userId: string,
    amount: Money,
    description: string,
    imageUrl: string | null = null,
    createdAt?: Date,
    updatedAt?: Date
  ) {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }
    if (!description || description.trim().length === 0) {
      throw new Error('Description is required');
    }

    this._id = id;
    this._userId = userId.trim();
    this._amount = amount;
    this._description = description.trim();
    this._imageUrl = imageUrl;
    this._createdAt = createdAt || new Date();
    this._updatedAt = updatedAt || new Date();
  }

  // Getters
  get id(): number {
    return this._id;
  }

  get userId(): string {
    return this._userId;
  }

  get amount(): Money {
    return this._amount;
  }

  get description(): string {
    return this._description;
  }

  get imageUrl(): string | null {
    return this._imageUrl;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  /**
   * 金額を更新
   */
  updateAmount(newAmount: Money): void {
    this._amount = newAmount;
    this._updatedAt = new Date();
  }

  /**
   * 説明を更新
   */
  updateDescription(newDescription: string): void {
    if (!newDescription || newDescription.trim().length === 0) {
      throw new Error('Description cannot be empty');
    }
    this._description = newDescription.trim();
    this._updatedAt = new Date();
  }

  /**
   * 画像URLを更新
   */
  updateImageUrl(newImageUrl: string | null): void {
    this._imageUrl = newImageUrl;
    this._updatedAt = new Date();
  }

  /**
   * 同じ月の取引かチェック
   */
  isInSameMonth(date: Date): boolean {
    return this._createdAt.getFullYear() === date.getFullYear() &&
           this._createdAt.getMonth() === date.getMonth();
  }

  /**
   * 指定日時より新しい取引かチェック
   */
  isNewerThan(date: Date): boolean {
    return this._createdAt > date;
  }

  /**
   * 取引が今日のものかチェック
   */
  isToday(): boolean {
    const today = new Date();
    return this.isInSameDay(today);
  }

  /**
   * 指定日と同じ日の取引かチェック
   */
  isInSameDay(date: Date): boolean {
    return this._createdAt.getFullYear() === date.getFullYear() &&
           this._createdAt.getMonth() === date.getMonth() &&
           this._createdAt.getDate() === date.getDate();
  }

  /**
   * 取引の等価性チェック
   */
  equals(other: Transaction): boolean {
    return this._id === other._id;
  }

  /**
   * JSON形式に変換
   */
  toJSON(): {
    id: number;
    userId: string;
    amount: { amount: number; currency: string };
    description: string;
    imageUrl: string | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: this._id,
      userId: this._userId,
      amount: this._amount.toJSON(),
      description: this._description,
      imageUrl: this._imageUrl,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString()
    };
  }

  /**
   * 表示用文字列
   */
  toString(): string {
    return `Transaction(${this._id}): ${this._amount.toString()} - ${this._description}`;
  }

  /**
   * ファクトリーメソッド - 新規取引作成
   */
  static create(
    userId: string,
    amount: Money,
    description: string,
    imageUrl?: string
  ): Omit<Transaction, 'id'> {
    return new Transaction(0, userId, amount, description, imageUrl) as any;
  }

  /**
   * ファクトリーメソッド - 既存データから復元
   */
  static fromData(data: {
    id: number;
    userId: string;
    amount: number;
    currency?: string;
    description: string;
    imageUrl?: string | null;
    createdAt: Date | string;
    updatedAt?: Date | string;
  }): Transaction {
    const amount = new Money(data.amount, data.currency || 'JPY');
    const createdAt = typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt;
    const updatedAt = data.updatedAt 
      ? (typeof data.updatedAt === 'string' ? new Date(data.updatedAt) : data.updatedAt)
      : createdAt;

    return new Transaction(
      data.id,
      data.userId,
      amount,
      data.description,
      data.imageUrl || null,
      createdAt,
      updatedAt
    );
  }
}