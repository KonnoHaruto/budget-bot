import { PrismaClient } from '@prisma/client';
import { Transaction } from '../../domain/entities/Transaction';
import { TransactionRepository } from '../../usecases/AddExpense';
import { DateRange } from '../../domain/valueObjects/DateRange';

/**
 * Prismaを使用したTransactionRepositoryの実装
 */
export class TransactionRepositoryPrisma implements TransactionRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 取引を保存
   */
  async save(transaction: Omit<Transaction, 'id'>): Promise<Transaction> {
    const data = {
      userId: transaction.userId,
      amount: transaction.amount.amount,
      currency: transaction.amount.currency,
      description: transaction.description,
      imageUrl: transaction.imageUrl,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt
    };

    const saved = await this.prisma.transaction.create({
      data
    });

    return Transaction.fromData({
      id: saved.id,
      userId: saved.userId,
      amount: saved.amount,
      currency: saved.currency || 'JPY',
      description: saved.description || '',
      imageUrl: saved.imageUrl,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt
    });
  }

  /**
   * ユーザーIDで取引を検索
   */
  async findByUserId(userId: string): Promise<Transaction[]> {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    return transactions.map(t => Transaction.fromData({
      id: t.id,
      userId: t.userId,
      amount: t.amount,
      currency: t.currency || 'JPY',
      description: t.description || '',
      imageUrl: t.imageUrl,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
  }

  /**
   * 指定月の取引を検索
   */
  async findByUserIdAndMonth(userId: string, year: number, month: number): Promise<Transaction[]> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return transactions.map(t => Transaction.fromData({
      id: t.id,
      userId: t.userId,
      amount: t.amount,
      currency: t.currency || 'JPY',
      description: t.description || '',
      imageUrl: t.imageUrl,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
  }

  /**
   * 期間指定で取引を検索
   */
  async findByUserIdAndDateRange(userId: string, dateRange: DateRange): Promise<Transaction[]> {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        createdAt: {
          gte: dateRange.startDate,
          lte: dateRange.endDate
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return transactions.map(t => Transaction.fromData({
      id: t.id,
      userId: t.userId,
      amount: t.amount,
      currency: t.currency || 'JPY',
      description: t.description || '',
      imageUrl: t.imageUrl,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
  }

  /**
   * 取引を更新
   */
  async update(id: number, updates: Partial<Pick<Transaction, 'amount' | 'description' | 'imageUrl'>>): Promise<Transaction> {
    const updateData: any = {
      updatedAt: new Date()
    };

    if (updates.amount) {
      updateData.amount = updates.amount.amount;
      updateData.currency = updates.amount.currency;
    }

    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }

    if (updates.imageUrl !== undefined) {
      updateData.imageUrl = updates.imageUrl;
    }

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: updateData
    });

    return Transaction.fromData({
      id: updated.id,
      userId: updated.userId,
      amount: updated.amount,
      currency: updated.currency || 'JPY',
      description: updated.description || '',
      imageUrl: updated.imageUrl,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    });
  }

  /**
   * 取引を削除
   */
  async delete(id: number): Promise<void> {
    await this.prisma.transaction.delete({
      where: { id }
    });
  }

  /**
   * IDで取引を検索
   */
  async findById(id: number): Promise<Transaction | null> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id }
    });

    if (!transaction) {
      return null;
    }

    return Transaction.fromData({
      id: transaction.id,
      userId: transaction.userId,
      amount: transaction.amount,
      currency: transaction.currency || 'JPY',
      description: transaction.description || '',
      imageUrl: transaction.imageUrl,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt
    });
  }

  /**
   * ユーザーの取引統計を取得
   */
  async getStatistics(userId: string, year?: number, month?: number): Promise<{
    totalCount: number;
    totalAmount: number;
    averageAmount: number;
    currency: string;
  }> {
    const whereClause: any = { userId };

    if (year && month) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      whereClause.createdAt = {
        gte: startDate,
        lte: endDate
      };
    }

    const result = await this.prisma.transaction.aggregate({
      where: whereClause,
      _count: { id: true },
      _sum: { amount: true },
      _avg: { amount: true }
    });

    const currency = await this.prisma.transaction.findFirst({
      where: whereClause,
      select: { currency: true }
    });

    return {
      totalCount: result._count.id || 0,
      totalAmount: result._sum.amount || 0,
      averageAmount: result._avg.amount || 0,
      currency: currency?.currency || 'JPY'
    };
  }
}