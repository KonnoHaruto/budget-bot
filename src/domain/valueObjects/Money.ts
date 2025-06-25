/**
 * 金額を表す値オブジェクト
 */
export class Money {
  private readonly _amount: number;
  private readonly _currency: string;

  constructor(amount: number, currency: string = 'JPY') {
    if (amount < 0) {
      throw new Error('Amount cannot be negative');
    }
    if (!currency || currency.trim().length === 0) {
      throw new Error('Currency is required');
    }
    
    this._amount = Math.round(amount * 100) / 100; // 小数点以下2桁まで
    this._currency = currency.toUpperCase();
  }

  get amount(): number {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  /**
   * 金額を追加
   */
  add(other: Money): Money {
    if (this._currency !== other._currency) {
      throw new Error('Cannot add different currencies');
    }
    return new Money(this._amount + other._amount, this._currency);
  }

  /**
   * 金額を減算
   */
  subtract(other: Money): Money {
    if (this._currency !== other._currency) {
      throw new Error('Cannot subtract different currencies');
    }
    return new Money(this._amount - other._amount, this._currency);
  }

  /**
   * 金額を比較
   */
  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  /**
   * より大きいかチェック
   */
  isGreaterThan(other: Money): boolean {
    if (this._currency !== other._currency) {
      throw new Error('Cannot compare different currencies');
    }
    return this._amount > other._amount;
  }

  /**
   * より小さいかチェック
   */
  isLessThan(other: Money): boolean {
    if (this._currency !== other._currency) {
      throw new Error('Cannot compare different currencies');
    }
    return this._amount < other._amount;
  }

  /**
   * ゼロかチェック
   */
  isZero(): boolean {
    return this._amount === 0;
  }

  /**
   * 正の値かチェック
   */
  isPositive(): boolean {
    return this._amount > 0;
  }

  /**
   * 表示用文字列
   */
  toString(): string {
    switch (this._currency) {
      case 'JPY':
        return `¥${this._amount.toLocaleString()}`;
      case 'USD':
        return `$${this._amount.toLocaleString()}`;
      case 'EUR':
        return `€${this._amount.toLocaleString()}`;
      default:
        return `${this._amount.toLocaleString()} ${this._currency}`;
    }
  }

  /**
   * JSON形式
   */
  toJSON(): { amount: number; currency: string } {
    return {
      amount: this._amount,
      currency: this._currency
    };
  }

  /**
   * JSONから復元
   */
  static fromJSON(json: { amount: number; currency: string }): Money {
    return new Money(json.amount, json.currency);
  }

  /**
   * ファクトリーメソッド
   */
  static yen(amount: number): Money {
    return new Money(amount, 'JPY');
  }

  static usd(amount: number): Money {
    return new Money(amount, 'USD');
  }

  static euro(amount: number): Money {
    return new Money(amount, 'EUR');
  }

  static zero(currency: string = 'JPY'): Money {
    return new Money(0, currency);
  }
}