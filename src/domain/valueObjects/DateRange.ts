/**
 * 日付範囲を表す値オブジェクト
 */
export class DateRange {
  private readonly _startDate: Date;
  private readonly _endDate: Date;

  constructor(startDate: Date, endDate: Date) {
    if (startDate > endDate) {
      throw new Error('Start date cannot be after end date');
    }
    
    this._startDate = new Date(startDate);
    this._endDate = new Date(endDate);
  }

  get startDate(): Date {
    return new Date(this._startDate);
  }

  get endDate(): Date {
    return new Date(this._endDate);
  }

  /**
   * 指定した日付が範囲内かチェック
   */
  contains(date: Date): boolean {
    return date >= this._startDate && date <= this._endDate;
  }

  /**
   * 日数を取得
   */
  getDays(): number {
    const diffTime = this._endDate.getTime() - this._startDate.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 for inclusive range
  }

  /**
   * 他の範囲と重複しているかチェック
   */
  overlaps(other: DateRange): boolean {
    return this._startDate <= other._endDate && this._endDate >= other._startDate;
  }

  /**
   * 範囲が等しいかチェック
   */
  equals(other: DateRange): boolean {
    return this._startDate.getTime() === other._startDate.getTime() &&
           this._endDate.getTime() === other._endDate.getTime();
  }

  /**
   * 範囲を拡張
   */
  extend(date: Date): DateRange {
    const newStart = date < this._startDate ? date : this._startDate;
    const newEnd = date > this._endDate ? date : this._endDate;
    return new DateRange(newStart, newEnd);
  }

  /**
   * 文字列表現
   */
  toString(): string {
    return `${this._startDate.toISOString().split('T')[0]} - ${this._endDate.toISOString().split('T')[0]}`;
  }

  /**
   * ファクトリーメソッド群
   */
  static currentMonth(): DateRange {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return new DateRange(start, end);
  }

  static currentWeek(): DateRange {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return new DateRange(start, end);
  }

  static today(): DateRange {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return new DateRange(start, end);
  }

  static fromMonth(year: number, month: number): DateRange {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return new DateRange(start, end);
  }

  static fromDays(startDate: Date, days: number): DateRange {
    const end = new Date(startDate);
    end.setDate(startDate.getDate() + days - 1);
    return new DateRange(startDate, end);
  }
}