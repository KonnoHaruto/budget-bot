import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;

export class DatabaseService {
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
    return await prisma.user.update({
      where: { lineUserId },
      data: { currentSpent: 0 }
    });
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
}

export const databaseService = new DatabaseService();