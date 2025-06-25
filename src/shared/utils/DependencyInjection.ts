import { PrismaClient } from '@prisma/client';
import { LineMessageClient } from '../../infra/line/LineMessageClient';
import { TaskQueueClient } from '../../infra/cloudTasks/TaskQueueClient';
import { UserRepositoryPrisma } from '../../infra/prisma/UserRepositoryPrisma';
import { TransactionRepositoryPrisma } from '../../infra/prisma/TransactionRepositoryPrisma';
import { SetBudget } from '../../usecases/SetBudget';
import { GetBudgetStatus } from '../../usecases/GetBudgetStatus';
import { AddExpense } from '../../usecases/AddExpense';
// Controllers removed in simplified architecture
import { ENV_KEYS } from '../constants/index';
import { logger } from './Logger';

/**
 * 依存性注入コンテナ
 */
export class DIContainer {
  private static instance: DIContainer;
  private dependencies: Map<string, any> = new Map();
  private singletons: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  /**
   * 依存性を登録
   */
  register<T>(key: string, factory: () => T, singleton: boolean = true): void {
    this.dependencies.set(key, { factory, singleton });
  }

  /**
   * 依存性を解決
   */
  resolve<T>(key: string): T {
    const dependency = this.dependencies.get(key);
    if (!dependency) {
      throw new Error(`Dependency not found: ${key}`);
    }

    if (dependency.singleton) {
      if (!this.singletons.has(key)) {
        this.singletons.set(key, dependency.factory());
      }
      return this.singletons.get(key);
    }

    return dependency.factory();
  }

  /**
   * 依存性が登録されているかチェック
   */
  has(key: string): boolean {
    return this.dependencies.has(key);
  }

  /**
   * すべての依存性をクリア（テスト用）
   */
  clear(): void {
    this.dependencies.clear();
    this.singletons.clear();
  }

  /**
   * 設定を初期化
   */
  initialize(): void {
    logger.info('Initializing dependency injection container');

    // インフラ層の依存性
    this.register('prisma', () => {
      const prisma = new PrismaClient();
      logger.info('PrismaClient initialized');
      return prisma;
    });

    this.register('lineClient', () => {
      const accessToken = process.env.CHANNEL_ACCESS_TOKEN || process.env[ENV_KEYS.LINE_CHANNEL_ACCESS_TOKEN];
      const channelSecret = process.env.CHANNEL_SECRET || process.env[ENV_KEYS.LINE_CHANNEL_SECRET];
      
      if (!accessToken || !channelSecret) {
        throw new Error('LINE credentials not found in environment variables');
      }

      const client = new LineMessageClient(accessToken, channelSecret);
      logger.info('LineMessageClient initialized');
      return client;
    });

    this.register('taskQueue', () => {
      const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || process.env[ENV_KEYS.GOOGLE_CLOUD_PROJECT_ID];
      const location = process.env.GOOGLE_CLOUD_LOCATION || process.env[ENV_KEYS.GOOGLE_CLOUD_LOCATION];
      const queueName = process.env.CLOUD_TASKS_QUEUE_NAME || process.env[ENV_KEYS.GOOGLE_CLOUD_QUEUE_NAME];

      if (!projectId || !location || !queueName) {
        throw new Error('Google Cloud credentials not found in environment variables');
      }

      const client = new TaskQueueClient(projectId, location, queueName);
      logger.info('TaskQueueClient initialized');
      return client;
    });

    // リポジトリ層の依存性
    this.register('userRepository', () => {
      const prisma = this.resolve<PrismaClient>('prisma');
      return new UserRepositoryPrisma(prisma);
    });

    this.register('transactionRepository', () => {
      const prisma = this.resolve<PrismaClient>('prisma');
      return new TransactionRepositoryPrisma(prisma);
    });

    // ユースケース層の依存性
    this.register('setBudgetUseCase', () => {
      const userRepository = this.resolve<UserRepositoryPrisma>('userRepository');
      return new SetBudget(userRepository);
    });

    this.register('getBudgetStatusUseCase', () => {
      const userRepository = this.resolve<UserRepositoryPrisma>('userRepository');
      const transactionRepository = this.resolve<TransactionRepositoryPrisma>('transactionRepository');
      return new GetBudgetStatus(userRepository, transactionRepository);
    });

    this.register('addExpenseUseCase', () => {
      const transactionRepository = this.resolve<TransactionRepositoryPrisma>('transactionRepository');
      return new AddExpense(transactionRepository);
    });

    // コントローラー層は削除（簡略化のため）

    logger.info('Dependency injection container initialized successfully');
  }

  /**
   * アプリケーション終了時のクリーンアップ
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up dependencies');

    // Prismaクライアントの切断
    if (this.singletons.has('prisma')) {
      const prisma = this.singletons.get('prisma') as PrismaClient;
      await prisma.$disconnect();
      logger.info('PrismaClient disconnected');
    }

    this.singletons.clear();
    logger.info('Dependencies cleaned up');
  }
}

/**
 * DIコンテナのシングルトンインスタンス
 */
export const container = DIContainer.getInstance();

/**
 * ファクトリー関数用のヘルパー
 */
export class ServiceFactory {

  /**
   * 予算設定ユースケースを作成
   */
  static createSetBudgetUseCase(): SetBudget {
    return container.resolve<SetBudget>('setBudgetUseCase');
  }

  /**
   * 予算状況取得ユースケースを作成
   */
  static createGetBudgetStatusUseCase(): GetBudgetStatus {
    return container.resolve<GetBudgetStatus>('getBudgetStatusUseCase');
  }

  /**
   * 支出追加ユースケースを作成
   */
  static createAddExpenseUseCase(): AddExpense {
    return container.resolve<AddExpense>('addExpenseUseCase');
  }

  /**
   * LINE メッセージクライアントを作成
   */
  static createLineMessageClient(): LineMessageClient {
    return container.resolve<LineMessageClient>('lineClient');
  }

  /**
   * タスクキュークライアントを作成
   */
  static createTaskQueueClient(): TaskQueueClient {
    return container.resolve<TaskQueueClient>('taskQueue');
  }
}

/**
 * テスト用のモック登録ヘルパー
 */
export class TestDIHelper {
  /**
   * モックを登録
   */
  static registerMock<T>(key: string, mock: T): void {
    container.register(key, () => mock, true);
  }

  /**
   * テスト後のクリーンアップ
   */
  static cleanup(): void {
    container.clear();
  }

  /**
   * テスト用のコンテナ初期化（モック使用）
   */
  static initializeForTest(): void {
    // モック版の依存性を登録
    container.register('prisma', () => ({
      user: { findUnique: () => Promise.resolve(null), create: () => Promise.resolve({}), update: () => Promise.resolve({}) },
      transaction: { findMany: () => Promise.resolve([]), create: () => Promise.resolve({}), update: () => Promise.resolve({}), delete: () => Promise.resolve({}) },
      $disconnect: () => Promise.resolve()
    }));

    container.register('lineClient', () => ({
      sendTextMessage: () => Promise.resolve({}),
      sendBudgetStatusMessage: () => Promise.resolve({}),
      replyMessage: () => Promise.resolve({}),
      validateSignature: () => true
    }));

    container.register('taskQueue', () => ({
      enqueueReceiptProcessingTask: () => Promise.resolve(),
      enqueueBudgetAlertTask: () => Promise.resolve()
    }));

    // リポジトリとユースケースも同様にモック化
    // 実際のテストではより詳細なモックが必要
  }
}