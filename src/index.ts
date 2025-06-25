import express from 'express';
import * as line from '@line/bot-sdk';
import 'dotenv/config';
import { BudgetBot } from './bot/budgetBot';
import { TaskHandler } from './handlers/taskHandler';
import { container } from './shared/utils/DependencyInjection';
import { logger } from './shared/utils/Logger';
import { ErrorHandler } from './shared/utils/ErrorHandler';

/**
 * 新しいクリーンアーキテクチャベースのサーバー実装
 */

// 依存性注入コンテナを初期化
container.initialize();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.CHANNEL_SECRET!
};

const app = express();
const budgetBot = new BudgetBot();
const taskHandler = new TaskHandler();

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
  logger.info('Health check accessed');
  res.json({ 
    status: 'OK', 
    version: '2.0',
    timestamp: new Date().toISOString() 
  });
});

// Cloud Tasks エンドポイント
app.use('/tasks', express.json());

// レシート処理タスク
app.post('/tasks/receipt-processing', async (req, res) => {
  logger.info('Receipt processing task received', { body: req.body });
  await taskHandler.handleReceiptProcessing(req, res);
});

// 予算アラートタスク
app.post('/tasks/budget-alert', async (req, res) => {
  logger.info('Budget alert task received', { body: req.body });
  await taskHandler.handleBudgetAlert(req, res);
});

// 通貨レート更新タスク
app.post('/tasks/currency-update', async (req, res) => {
  logger.info('Currency update task received');
  await taskHandler.handleCurrencyUpdate(req, res);
});

// レポート送信タスク
app.post('/tasks/report', async (req, res) => {
  logger.info('Report task received', { body: req.body });
  await taskHandler.handleReportTask(req, res);
});

// タスクハンドラーのヘルスチェック
app.get('/tasks/health', async (req, res) => {
  await taskHandler.handleHealthCheck(req, res);
});

// LINE Webhook エンドポイント
app.post('/webhook', line.middleware(config), async (req: express.Request, res: express.Response) => {
  const stopTimer = logger.timer('webhook-processing');
  
  try {
    logger.info('Webhook received', {
      timestamp: new Date().toISOString(),
      eventCount: req.body.events?.length || 0
    });

    // 各イベントを並行処理
    const eventPromises = req.body.events.map((event: line.WebhookEvent) => 
      handleEvent(event).catch(error => {
        logger.error('Event processing failed', error, { eventType: event.type });
        return null; // 個別のイベント失敗がWebhook全体を失敗させないように
      })
    );

    await Promise.all(eventPromises);

    res.status(200).json({ success: true, processedEvents: req.body.events.length });
    logger.info('Webhook processed successfully', { eventCount: req.body.events.length });

  } catch (error) {
    const errorInfo = ErrorHandler.handle(error as Error);
    res.status(errorInfo.statusCode).json({ error: errorInfo.message });
  } finally {
    stopTimer();
  }
});

/**
 * イベント処理
 */
async function handleEvent(event: line.WebhookEvent): Promise<void> {
  const eventTimer = logger.timer(`${event.type}-event`);
  
  try {
    logger.info('Processing event', {
      type: event.type,
      timestamp: event.timestamp,
      source: event.source
    });

    switch (event.type) {
      case 'message':
        await budgetBot.handleMessageEvent(event);
        break;
      case 'postback':
        await budgetBot.handlePostbackEvent(event);
        break;
      case 'follow':
        await budgetBot.handleFollowEvent(event);
        break;
      case 'unfollow':
        await budgetBot.handleUnfollowEvent(event);
        break;
      default:
        logger.info('Unsupported event type', { eventType: event.type });
    }

    logger.info('Event processed successfully', { eventType: event.type });

  } catch (error) {
    logger.error('Event processing error', error as Error, { 
      eventType: event.type,
      eventSource: event.source 
    });
    throw error; // 上位でキャッチされる
  } finally {
    eventTimer();
  }
}

// API エンドポイントは簡略化のため削除

// グローバルエラーハンドラー
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errorInfo = ErrorHandler.handle(error);
  res.status(errorInfo.statusCode).json({ error: errorInfo.message });
});

// プロセス終了時のクリーンアップ
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await container.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await container.cleanup();
  process.exit(0);
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info('Budget Bot V2 server started', {
    port: PORT,
    version: '2.0',
    environment: process.env.NODE_ENV || 'development'
  });
  
  logger.info('Health check available', { url: `http://localhost:${PORT}/health` });
  logger.info('API documentation available', { url: `http://localhost:${PORT}/api` });
});

export { app };