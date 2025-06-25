import { CloudTasksClient } from '@google-cloud/tasks';

/**
 * Cloud Tasks クライアント
 */
export class TaskQueueClient {
  private client: CloudTasksClient;
  private projectId: string;
  private location: string;
  private queueName: string;

  constructor(projectId: string, location: string, queueName: string) {
    this.client = new CloudTasksClient();
    this.projectId = projectId;
    this.location = location;
    this.queueName = queueName;
  }

  /**
   * レシート処理タスクをキューに追加
   */
  async enqueueReceiptProcessingTask(payload: {
    messageId: string;
    userId: string;
    imageUrl: string;
    replyToken?: string;
  }): Promise<string> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${process.env.CLOUD_FUNCTION_URL}/process-receipt`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
      },
      scheduleTime: {
        seconds: Math.floor(Date.now() / 1000) + 10, // 10秒後に実行
      },
    };

    const [response] = await this.client.createTask({ parent, task });
    console.log(`📤 Receipt processing task enqueued: ${response.name}`);
    
    return response.name || '';
  }

  /**
   * 予算アラートタスクをキューに追加
   */
  async enqueueBudgetAlertTask(payload: {
    userId: string;
    alertType: 'warning' | 'danger' | 'over';
    message: string;
  }): Promise<string> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${process.env.CLOUD_FUNCTION_URL}/send-budget-alert`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
      },
    };

    const [response] = await this.client.createTask({ parent, task });
    console.log(`📤 Budget alert task enqueued: ${response.name}`);
    
    return response.name || '';
  }

  /**
   * 通貨レート更新タスクをキューに追加
   */
  async enqueueCurrencyUpdateTask(): Promise<string> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${process.env.CLOUD_FUNCTION_URL}/update-currency-rates`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({})),
      },
    };

    const [response] = await this.client.createTask({ parent, task });
    console.log(`📤 Currency update task enqueued: ${response.name}`);
    
    return response.name || '';
  }

  /**
   * 定期レポートタスクをキューに追加
   */
  async enqueueReportTask(payload: {
    userId: string;
    reportType: 'daily' | 'weekly' | 'monthly';
  }): Promise<string> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${process.env.CLOUD_FUNCTION_URL}/send-report`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
      },
    };

    const [response] = await this.client.createTask({ parent, task });
    console.log(`📤 Report task enqueued: ${response.name}`);
    
    return response.name || '';
  }

  /**
   * 遅延実行タスクをキューに追加
   */
  async enqueueDelayedTask(
    url: string,
    payload: any,
    delaySeconds: number = 0
  ): Promise<string> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
      },
      scheduleTime: {
        seconds: Math.floor(Date.now() / 1000) + delaySeconds,
      },
    };

    const [response] = await this.client.createTask({ parent, task });
    console.log(`📤 Delayed task enqueued: ${response.name} (delay: ${delaySeconds}s)`);
    
    return response.name || '';
  }

  /**
   * タスクを削除
   */
  async deleteTask(taskName: string): Promise<void> {
    try {
      await this.client.deleteTask({ name: taskName });
      console.log(`🗑️ Task deleted: ${taskName}`);
    } catch (error) {
      console.error(`Failed to delete task ${taskName}:`, error);
    }
  }

  /**
   * キューの統計情報を取得
   */
  async getQueueStats(): Promise<{
    pendingTasks: number;
    runningTasks: number;
  }> {
    try {
      const queuePath = this.client.queuePath(this.projectId, this.location, this.queueName);
      const [queue] = await this.client.getQueue({ name: queuePath });
      
      return {
        pendingTasks: (queue as any).stats?.tasksCount || 0,
        runningTasks: (queue as any).stats?.oldestEstimatedArrivalTime ? 1 : 0
      };
    } catch (error) {
      console.error('Failed to get queue stats:', error);
      return { pendingTasks: 0, runningTasks: 0 };
    }
  }

  /**
   * キューをパージ（全タスク削除）
   */
  async purgeQueue(): Promise<void> {
    try {
      const queuePath = this.client.queuePath(this.projectId, this.location, this.queueName);
      await this.client.purgeQueue({ name: queuePath });
      console.log(`🧹 Queue purged: ${this.queueName}`);
    } catch (error) {
      console.error('Failed to purge queue:', error);
      throw error;
    }
  }
}