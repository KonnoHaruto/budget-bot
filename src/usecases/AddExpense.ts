import { Transaction } from '../domain/entities/Transaction';
import { Money } from '../domain/valueObjects/Money';

/**
 * 支出追加ユースケース
 */
export interface TransactionRepository {
  save(transaction: Omit<Transaction, 'id'>): Promise<Transaction>;
  findByUserId(userId: string): Promise<Transaction[]>;
  findByUserIdAndMonth(userId: string, year: number, month: number): Promise<Transaction[]>;
  update(id: number, updates: Partial<Pick<Transaction, 'amount' | 'description' | 'imageUrl'>>): Promise<Transaction>;
  delete(id: number): Promise<void>;
}

export class AddExpense {
  constructor(
    private transactionRepository: TransactionRepository
  ) {}

  /**
   * 支出を追加
   */
  async execute(input: {
    userId: string;
    amount: number;
    currency?: string;
    description: string;
    imageUrl?: string;
  }): Promise<Transaction> {
    // 入力値検証
    if (!input.userId || input.userId.trim().length === 0) {
      throw new Error('User ID is required');
    }
    
    if (input.amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    if (!input.description || input.description.trim().length === 0) {
      throw new Error('Description is required');
    }

    // ドメインオブジェクト作成
    const money = new Money(input.amount, input.currency || 'JPY');
    const transaction = Transaction.create(
      input.userId,
      money,
      input.description.trim(),
      input.imageUrl
    );

    // 永続化
    const savedTransaction = await this.transactionRepository.save(transaction);
    
    console.log(`✅ Expense added: ${savedTransaction.toString()}`);
    return savedTransaction;
  }

  /**
   * 支出を更新
   */
  async updateExpense(input: {
    transactionId: number;
    amount?: number;
    currency?: string;
    description?: string;
    imageUrl?: string;
  }): Promise<Transaction> {
    if (input.transactionId <= 0) {
      throw new Error('Invalid transaction ID');
    }

    const updates: any = {};

    if (input.amount !== undefined) {
      if (input.amount <= 0) {
        throw new Error('Amount must be positive');
      }
      updates.amount = new Money(input.amount, input.currency || 'JPY');
    }

    if (input.description !== undefined) {
      if (!input.description || input.description.trim().length === 0) {
        throw new Error('Description cannot be empty');
      }
      updates.description = input.description.trim();
    }

    if (input.imageUrl !== undefined) {
      updates.imageUrl = input.imageUrl;
    }

    const updatedTransaction = await this.transactionRepository.update(input.transactionId, updates);
    
    console.log(`✅ Expense updated: ${updatedTransaction.toString()}`);
    return updatedTransaction;
  }

  /**
   * 支出を削除
   */
  async deleteExpense(transactionId: number): Promise<void> {
    if (transactionId <= 0) {
      throw new Error('Invalid transaction ID');
    }

    await this.transactionRepository.delete(transactionId);
    console.log(`✅ Expense deleted: ID ${transactionId}`);
  }

  /**
   * ユーザーの全支出を取得
   */
  async getUserExpenses(userId: string): Promise<Transaction[]> {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }

    return await this.transactionRepository.findByUserId(userId);
  }

  /**
   * 指定月の支出を取得
   */
  async getMonthlyExpenses(userId: string, year: number, month: number): Promise<Transaction[]> {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }
    
    if (year < 1900 || year > 2100) {
      throw new Error('Invalid year');
    }
    
    if (month < 1 || month > 12) {
      throw new Error('Invalid month');
    }

    return await this.transactionRepository.findByUserIdAndMonth(userId, year, month);
  }

  /**
   * 月間支出合計を計算
   */
  async calculateMonthlyTotal(userId: string, year: number, month: number): Promise<Money> {
    const transactions = await this.getMonthlyExpenses(userId, year, month);
    
    if (transactions.length === 0) {
      return Money.zero();
    }

    // すべての取引が同じ通貨であることを前提
    const currency = transactions[0].amount.currency;
    let total = Money.zero(currency);

    for (const transaction of transactions) {
      if (transaction.amount.currency !== currency) {
        throw new Error('Mixed currencies in transactions - conversion required');
      }
      total = total.add(transaction.amount);
    }

    return total;
  }

  /**
   * 今月の支出合計を計算
   */
  async calculateCurrentMonthTotal(userId: string): Promise<Money> {
    const now = new Date();
    return this.calculateMonthlyTotal(userId, now.getFullYear(), now.getMonth() + 1);
  }
}