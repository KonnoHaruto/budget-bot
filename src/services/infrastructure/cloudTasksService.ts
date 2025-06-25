import { CloudTasksClient } from '@google-cloud/tasks';
import { google } from '@google-cloud/tasks/build/protos/protos';

export interface ReceiptProcessingTask {
  userId: string;
  messageId: string;
  replyToken?: string;
}

export interface CurrencyConversionTask {
  userId: string;
  amounts: any[];
  storeName?: string;
}

export class CloudTasksService {
  private client: CloudTasksClient;
  private projectId: string;
  private location: string;
  private queueName: string;
  private serviceUrl: string;

  constructor() {
    this.client = new CloudTasksClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'your-project-id';
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'asia-northeast1';
    this.queueName = process.env.CLOUD_TASKS_QUEUE_NAME || 'receipt-processing-queue';
    this.serviceUrl = process.env.SERVICE_URL || 'https://your-service-url.com';

    console.log('🔧 Cloud Tasks Service initialized:', {
      projectId: this.projectId,
      location: this.location,
      queueName: this.queueName,
      serviceUrl: this.serviceUrl
    });
  }

  /**
   * レシート処理タスクをキューに追加
   */
  async enqueueReceiptProcessing(task: ReceiptProcessingTask): Promise<void> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const payload = {
      type: 'receipt_processing',
      data: task
    };

    const request: google.cloud.tasks.v2.ICreateTaskRequest = {
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${this.serviceUrl}/tasks/receipt-processing`,
          headers: {
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        scheduleTime: {
          seconds: Math.floor(Date.now() / 1000) + 2, // 2秒後に実行
        },
      },
    };

    try {
      const [response] = await this.client.createTask(request);
      console.log(`📝 Receipt processing task created: ${response.name}`);
      console.log(`👤 User: ${task.userId}, Message: ${task.messageId}`);
    } catch (error) {
      console.error('❌ Failed to create receipt processing task:', error);
      throw error;
    }
  }

  /**
   * 通貨変換処理タスクをキューに追加
   */
  async enqueueCurrencyConversion(task: CurrencyConversionTask): Promise<void> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const payload = {
      type: 'currency_conversion',
      data: task
    };

    const request: google.cloud.tasks.v2.ICreateTaskRequest = {
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${this.serviceUrl}/tasks/currency-conversion`,
          headers: {
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        scheduleTime: {
          seconds: Math.floor(Date.now() / 1000) + 1, // 1秒後に実行
        },
      },
    };

    try {
      const [response] = await this.client.createTask(request);
      console.log(`💱 Currency conversion task created: ${response.name}`);
      console.log(`👤 User: ${task.userId}, Amounts: ${task.amounts.length}`);
    } catch (error) {
      console.error('❌ Failed to create currency conversion task:', error);
      throw error;
    }
  }

  /**
   * 汎用タスクをキューに追加
   */
  async enqueueGenericTask(taskType: string, taskData: any, delaySeconds: number = 0): Promise<void> {
    const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
    
    const payload = {
      type: taskType,
      data: taskData
    };

    const request: google.cloud.tasks.v2.ICreateTaskRequest = {
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${this.serviceUrl}/tasks/${taskType}`,
          headers: {
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        scheduleTime: {
          seconds: Math.floor(Date.now() / 1000) + delaySeconds,
        },
      },
    };

    try {
      const [response] = await this.client.createTask(request);
      console.log(`🔄 Generic task created: ${response.name}`);
      console.log(`📋 Type: ${taskType}, Delay: ${delaySeconds}s`);
    } catch (error) {
      console.error(`❌ Failed to create ${taskType} task:`, error);
      throw error;
    }
  }

  /**
   * キューの情報を取得
   */
  async getQueueInfo(): Promise<any> {
    try {
      const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
      const [queue] = await this.client.getQueue({ name: parent });
      return queue;
    } catch (error) {
      console.error('❌ Failed to get queue info:', error);
      throw error;
    }
  }

  /**
   * 実行中のタスク数を取得
   */
  async getPendingTasksCount(): Promise<number> {
    try {
      const parent = this.client.queuePath(this.projectId, this.location, this.queueName);
      const [tasks] = await this.client.listTasks({ parent });
      return tasks.length;
    } catch (error) {
      console.error('❌ Failed to get pending tasks count:', error);
      return 0;
    }
  }
}

export const cloudTasksService = new CloudTasksService();