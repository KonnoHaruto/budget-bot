import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;

export class DatabaseService {
  // Exchange Rate management
  async saveExchangeRate(fromCurrency: string, toCurrency: string = 'JPY', rate: number) {
    return await prisma.exchangeRate.upsert({
      where: {
        fromCurrency_toCurrency: {
          fromCurrency,
          toCurrency
        }
      },
      update: {
        rate,
        fetchedAt: new Date()
      },
      create: {
        fromCurrency,
        toCurrency,
        rate,
        fetchedAt: new Date()
      }
    });
  }

  async getExchangeRate(fromCurrency: string, toCurrency: string = 'JPY') {
    return await prisma.exchangeRate.findUnique({
      where: {
        fromCurrency_toCurrency: {
          fromCurrency,
          toCurrency
        }
      }
    });
  }

  async getAllExchangeRates() {
    return await prisma.exchangeRate.findMany({
      orderBy: { fetchedAt: 'desc' }
    });
  }

  async getLatestRateUpdate() {
    const latestRate = await prisma.exchangeRate.findFirst({
      orderBy: { fetchedAt: 'desc' }
    });
    return latestRate?.fetchedAt || null;
  }
  async getUser(lineUserId: string) {
    return await prisma.user.findUnique({
      where: { lineUserId },
      include: { transactions: true }
    });
  }

  async createUser(lineUserId: string, monthlyBudget: number = 0) {
    return await prisma.user.create({
      data: {
        lineUserId,
        monthlyBudget
      },
      include: { transactions: true }
    });
  }

  async updateBudget(lineUserId: string, monthlyBudget: number) {
    return await prisma.user.update({
      where: { lineUserId },
      data: { monthlyBudget }
    });
  }

  async addTransaction(lineUserId: string, amount: number, description: string, imageUrl?: string) {
    const user = await this.getUser(lineUserId);
    if (!user) {
      throw new Error('User not found');
    }

    const [transaction] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: user.id,
          amount,
          description,
          imageUrl
        }
      }),
      prisma.user.update({
        where: { lineUserId },
        data: {
          currentSpent: {
            increment: amount
          }
        }
      })
    ]);

    return transaction;
  }

  async resetMonthlyBudget(lineUserId: string) {
    const user = await this.getUser(lineUserId);
    if (!user) {
      throw new Error('User not found');
    }

    // トランザクションで取引データを削除し、currentSpentをリセット
    await prisma.$transaction([
      prisma.transaction.deleteMany({
        where: { userId: user.id }
      }),
      prisma.user.update({
        where: { lineUserId },
        data: { currentSpent: 0 }
      })
    ]);

    return { success: true };
  }

  async editTransaction(lineUserId: string, transactionId: number, newAmount: number) {
    const user = await this.getUser(lineUserId);
    if (!user) {
      throw new Error('User not found');
    }

    // 既存の取引を取得
    const existingTransaction = await prisma.transaction.findFirst({
      where: { 
        id: transactionId,
        userId: user.id 
      }
    });

    if (!existingTransaction) {
      throw new Error('Transaction not found');
    }

    const amountDifference = newAmount - existingTransaction.amount;
    const oldAmount = existingTransaction.amount;

    // トランザクションで取引を更新し、ユーザーの累計を調整
    const [updatedTransaction] = await prisma.$transaction([
      prisma.transaction.update({
        where: { id: transactionId },
        data: { amount: newAmount }
      }),
      prisma.user.update({
        where: { lineUserId },
        data: {
          currentSpent: {
            increment: amountDifference
          }
        }
      })
    ]);

    return {
      ...updatedTransaction,
      oldAmount,
      newAmount
    };
  }

  async deleteTransaction(lineUserId: string, transactionId: number) {
    const user = await this.getUser(lineUserId);
    if (!user) {
      throw new Error('User not found');
    }

    // 既存の取引を取得
    const existingTransaction = await prisma.transaction.findFirst({
      where: { 
        id: transactionId,
        userId: user.id 
      }
    });

    if (!existingTransaction) {
      throw new Error('Transaction not found');
    }

    // トランザクションで取引を削除し、ユーザーの累計を調整
    await prisma.$transaction([
      prisma.transaction.delete({
        where: { id: transactionId }
      }),
      prisma.user.update({
        where: { lineUserId },
        data: {
          currentSpent: {
            decrement: existingTransaction.amount
          }
        }
      })
    ]);

    return { success: true, deletedAmount: existingTransaction.amount };
  }

  async getRecentTransactions(lineUserId: string, limit: number = 10) {
    const user = await this.getUser(lineUserId);
    if (!user) return [];

    return await prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getTodaySpent(lineUserId: string) {
    const user = await this.getUser(lineUserId);
    if (!user) return 0;

    // 今日の開始時刻（00:00:00）
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 今日の終了時刻（23:59:59.999）
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todayTransactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        createdAt: {
          gte: today,
          lte: endOfToday
        }
      }
    });

    return todayTransactions.reduce((total, transaction) => total + transaction.amount, 0);
  }

  async getUserStats(lineUserId: string) {
    const user = await this.getUser(lineUserId);
    if (!user) return null;

    const remainingBudget = user.monthlyBudget - user.currentSpent;
    const budgetUsagePercentage = user.monthlyBudget > 0 
      ? (user.currentSpent / user.monthlyBudget) * 100 
      : 0;

    return {
      ...user,
      remainingBudget,
      budgetUsagePercentage
    };
  }

  async getAllUsers(): Promise<{ lineUserId: string; monthlyBudget: number; currentSpent: number; }[]> {
    return await prisma.user.findMany({
      select: {
        lineUserId: true,
        monthlyBudget: true,
        currentSpent: true
      }
    });
  }
}

export const databaseService = new DatabaseService();