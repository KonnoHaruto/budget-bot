import { PrismaClient } from '@prisma/client';
import { User } from '../../domain/entities/User';
import { UserRepository } from '../../usecases/SetBudget';
import { Money } from '../../domain/valueObjects/Money';

/**
 * Prismaを使用したUserRepositoryの実装
 */
export class UserRepositoryPrisma implements UserRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * IDでユーザーを検索
   */
  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return null;
    }

    return User.fromData({
      id: user.id,
      monthlyBudget: user.monthlyBudget,
      currency: user.currency || 'JPY',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  }

  /**
   * ユーザーを保存（更新）
   */
  async save(user: User): Promise<User> {
    const data = {
      monthlyBudget: user.monthlyBudget?.amount || 0,
      currency: user.monthlyBudget?.currency || 'JPY',
      updatedAt: new Date()
    };

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data
    });

    return User.fromData({
      id: updated.id,
      monthlyBudget: updated.monthlyBudget,
      currency: updated.currency || 'JPY',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    });
  }

  /**
   * 新規ユーザーを作成
   */
  async create(user: User): Promise<User> {
    const data = {
      id: user.id,
      lineUserId: user.id, // Use id as lineUserId for simplified architecture
      monthlyBudget: user.monthlyBudget?.amount || 0,
      currency: user.monthlyBudget?.currency || 'JPY',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    const created = await this.prisma.user.create({
      data
    });

    return User.fromData({
      id: created.id,
      monthlyBudget: created.monthlyBudget,
      currency: created.currency || 'JPY',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    });
  }

  /**
   * ユーザーを削除
   */
  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id }
    });
  }

  /**
   * 全ユーザーを取得
   */
  async findAll(): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return users.map(u => User.fromData({
      id: u.id,
      monthlyBudget: u.monthlyBudget,
      currency: u.currency || 'JPY',
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));
  }

  /**
   * 予算が設定されているユーザーを取得
   */
  async findUsersWithBudget(): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: {
        monthlyBudget: {
          gt: 0
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return users.map(u => User.fromData({
      id: u.id,
      monthlyBudget: u.monthlyBudget,
      currency: u.currency || 'JPY',
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));
  }

  /**
   * ユーザーが存在するかチェック
   */
  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { id }
    });
    return count > 0;
  }

  /**
   * 指定期間内にアクティブだったユーザーを取得
   */
  async findActiveUsers(since: Date): Promise<User[]> {
    // 指定期間内に取引があったユーザーを取得
    const usersWithTransactions = await this.prisma.user.findMany({
      where: {
        transactions: {
          some: {
            createdAt: {
              gte: since
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    return usersWithTransactions.map(u => User.fromData({
      id: u.id,
      monthlyBudget: u.monthlyBudget,
      currency: u.currency || 'JPY',
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));
  }

  /**
   * ユーザー統計を取得
   */
  async getStatistics(): Promise<{
    totalUsers: number;
    usersWithBudget: number;
    activeUsers: number;
    averageBudget: number;
    currency: string;
  }> {
    const totalUsers = await this.prisma.user.count();
    const usersWithBudget = await this.prisma.user.count({
      where: {
        monthlyBudget: {
          gt: 0
        }
      }
    });

    // 過去30日以内に取引があったユーザー
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const activeUsers = await this.prisma.user.count({
      where: {
        transactions: {
          some: {
            createdAt: {
              gte: thirtyDaysAgo
            }
          }
        }
      }
    });

    const budgetStats = await this.prisma.user.aggregate({
      where: {
        monthlyBudget: {
          gt: 0
        }
      },
      _avg: {
        monthlyBudget: true
      }
    });

    return {
      totalUsers,
      usersWithBudget,
      activeUsers,
      averageBudget: budgetStats._avg?.monthlyBudget || 0,
      currency: 'JPY'
    };
  }
}