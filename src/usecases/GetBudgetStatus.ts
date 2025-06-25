import { User } from '../domain/entities/User';
import { Transaction } from '../domain/entities/Transaction';
import { Money } from '../domain/valueObjects/Money';
import { DateRange } from '../domain/valueObjects/DateRange';

/**
 * 予算状況取得ユースケース
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
}

export interface TransactionRepository {
  findByUserIdAndMonth(userId: string, year: number, month: number): Promise<Transaction[]>;
  findByUserIdAndDateRange(userId: string, dateRange: DateRange): Promise<Transaction[]>;
}

export interface BudgetStatus {
  user: User;
  budget: Money | null;
  totalExpense: Money;
  remainingBudget: Money;
  usagePercentage: number;
  warningLevel: 'safe' | 'warning' | 'danger' | 'over';
  daysRemaining: number;
  dailyAverage: Money;
  recommendedDailySpending: Money;
  isOverBudget: boolean;
  transactions: Transaction[];
  summary: {
    transactionCount: number;
    averageTransactionAmount: Money;
    highestExpense: Transaction | null;
    recentTransactions: Transaction[];
  };
}

export class GetBudgetStatus {
  constructor(
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository
  ) {}

  /**
   * 現在の予算状況を取得
   */
  async execute(userId: string, year?: number, month?: number): Promise<BudgetStatus> {
    // 入力値検証
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }

    // ユーザー取得
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // 対象月の設定
    const targetDate = new Date();
    const targetYear = year || targetDate.getFullYear();
    const targetMonth = month || (targetDate.getMonth() + 1);

    // 指定月の取引を取得
    const transactions = await this.transactionRepository.findByUserIdAndMonth(
      userId, 
      targetYear, 
      targetMonth
    );

    // 支出合計を計算
    const totalExpense = this.calculateTotalExpense(transactions);

    // 予算状況を計算
    const budgetStatus = this.calculateBudgetStatus(
      user,
      totalExpense,
      transactions,
      targetYear,
      targetMonth
    );

    console.log(`📊 Budget status calculated for user ${userId}: ${budgetStatus.usagePercentage.toFixed(1)}%`);
    return budgetStatus;
  }

  /**
   * 期間指定での予算状況取得
   */
  async getStatusForDateRange(userId: string, dateRange: DateRange): Promise<BudgetStatus> {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const transactions = await this.transactionRepository.findByUserIdAndDateRange(userId, dateRange);
    const totalExpense = this.calculateTotalExpense(transactions);

    // 期間の月数で予算を按分
    const days = dateRange.getDays();
    const monthlyBudget = user.monthlyBudget;
    const periodBudget = monthlyBudget 
      ? new Money(monthlyBudget.amount * (days / 30), monthlyBudget.currency)
      : null;

    // 仮想的なユーザーオブジェクトを作成して計算
    const virtualUser = User.fromData({
      id: user.id,
      monthlyBudget: periodBudget?.amount || null,
      currency: periodBudget?.currency,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });

    return this.calculateBudgetStatus(
      virtualUser,
      totalExpense,
      transactions,
      dateRange.startDate.getFullYear(),
      dateRange.startDate.getMonth() + 1
    );
  }

  /**
   * 支出合計を計算
   */
  private calculateTotalExpense(transactions: Transaction[]): Money {
    if (transactions.length === 0) {
      return Money.zero();
    }

    // 最初の取引の通貨を基準とする
    const currency = transactions[0].amount.currency;
    let total = Money.zero(currency);

    for (const transaction of transactions) {
      if (transaction.amount.currency !== currency) {
        // 通貨が混在している場合は警告
        console.warn(`Mixed currencies detected: ${currency} and ${transaction.amount.currency}`);
        continue;
      }
      total = total.add(transaction.amount);
    }

    return total;
  }

  /**
   * 予算状況を計算
   */
  private calculateBudgetStatus(
    user: User,
    totalExpense: Money,
    transactions: Transaction[],
    year: number,
    month: number
  ): BudgetStatus {
    const budget = user.monthlyBudget;
    const currency = totalExpense.currency;

    // 残り予算を計算
    const remainingBudget = budget 
      ? user.calculateRemainingBudget(totalExpense)
      : Money.zero(currency);

    // 使用率を計算
    const usagePercentage = budget 
      ? user.calculateBudgetUsage(totalExpense)
      : 0;

    // 警告レベルを取得
    const warningLevel = user.getBudgetWarningLevel(totalExpense);

    // 月の残り日数を計算
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === month;
    const daysRemaining = isCurrentMonth 
      ? this.calculateRemainingDaysInMonth(now)
      : 0;

    // 1日平均支出を計算
    const currentDay = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate();
    const dailyAverage = currentDay > 0 
      ? new Money(totalExpense.amount / currentDay, currency)
      : Money.zero(currency);

    // 推奨1日支出を計算
    const recommendedDailySpending = budget && daysRemaining > 0
      ? new Money(remainingBudget.amount / daysRemaining, currency)
      : Money.zero(currency);

    // サマリー情報を作成
    const summary = this.createSummary(transactions, currency);

    return {
      user,
      budget,
      totalExpense,
      remainingBudget,
      usagePercentage,
      warningLevel,
      daysRemaining,
      dailyAverage,
      recommendedDailySpending,
      isOverBudget: user.isOverBudget(totalExpense),
      transactions,
      summary
    };
  }

  /**
   * 月の残り日数を計算
   */
  private calculateRemainingDaysInMonth(date: Date): number {
    const year = date.getFullYear();
    const month = date.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const currentDay = date.getDate();
    return lastDay - currentDay;
  }

  /**
   * サマリー情報を作成
   */
  private createSummary(transactions: Transaction[], currency: string): BudgetStatus['summary'] {
    if (transactions.length === 0) {
      return {
        transactionCount: 0,
        averageTransactionAmount: Money.zero(currency),
        highestExpense: null,
        recentTransactions: []
      };
    }

    // 平均取引金額を計算
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount.amount, 0);
    const averageTransactionAmount = new Money(totalAmount / transactions.length, currency);

    // 最高支出を取得
    const highestExpense = transactions.reduce((highest, current) => 
      current.amount.isGreaterThan(highest.amount) ? current : highest
    );

    // 最新の取引を取得（最大5件）
    const recentTransactions = [...transactions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5);

    return {
      transactionCount: transactions.length,
      averageTransactionAmount,
      highestExpense,
      recentTransactions
    };
  }

  /**
   * 予算アラートが必要かチェック
   */
  async shouldSendAlert(userId: string): Promise<{
    shouldAlert: boolean;
    alertType: 'warning' | 'danger' | 'over' | null;
    message: string;
  }> {
    const status = await this.execute(userId);
    
    const alertThresholds = {
      warning: 70,  // 70%超過で警告
      danger: 90,   // 90%超過で危険警告
      over: 100     // 100%超過で超過アラート
    };

    let shouldAlert = false;
    let alertType: 'warning' | 'danger' | 'over' | null = null;
    let message = '';

    if (status.usagePercentage > alertThresholds.over) {
      shouldAlert = true;
      alertType = 'over';
      message = `予算を${(status.usagePercentage - 100).toFixed(1)}%超過しています`;
    } else if (status.usagePercentage > alertThresholds.danger) {
      shouldAlert = true;
      alertType = 'danger';
      message = `予算の${status.usagePercentage.toFixed(1)}%を使用しています（危険レベル）`;
    } else if (status.usagePercentage > alertThresholds.warning) {
      shouldAlert = true;
      alertType = 'warning';
      message = `予算の${status.usagePercentage.toFixed(1)}%を使用しています`;
    }

    return {
      shouldAlert,
      alertType,
      message
    };
  }
}