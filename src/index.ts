import express from 'express';
import * as line from '@line/bot-sdk';
import multer from 'multer';
import 'dotenv/config';
import { databaseService } from './database/prisma';
import { ocrService } from './services/ocrService';
import { BudgetBot } from './bot/budgetBot';
import { SchedulerService } from './services/schedulerService';
import TaskHandler from './handlers/taskHandler';

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.CHANNEL_SECRET!
};

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const budgetBot = new BudgetBot();
const schedulerService = new SchedulerService(budgetBot);
const taskHandler = new TaskHandler(budgetBot);

// Health checkエンドポイント
app.get('/health', (req, res) => {
  console.log('🔍 Health check accessed at:', new Date().toISOString());
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Cloud Tasks エンドポイント
app.use('/tasks', express.json());

// レシート処理タスク
app.post('/tasks/receipt-processing', async (req, res) => {
  console.log('📝 Received receipt processing task:', req.body);
  await taskHandler.handleReceiptProcessing(req, res);
});

// 通貨変換処理タスク
app.post('/tasks/currency-conversion', async (req, res) => {
  console.log('💱 Received currency conversion task:', req.body);
  await taskHandler.handleCurrencyConversion(req, res);
});

// 汎用タスクハンドラー
app.post('/tasks/:taskType', async (req, res) => {
  console.log(`🔄 Received ${req.params.taskType} task:`, req.body);
  await taskHandler.handleGenericTask(req, res);
});

// タスクハンドラーのヘルスチェック
app.get('/tasks/health', async (req, res) => {
  await taskHandler.handleHealthCheck(req, res);
});

// テスト用週間レポート送信エンドポイント（リリース時には忘れずに削除）
app.post('/test-weekly-report', express.json(), (req: express.Request, res: express.Response) => {
  const { userId } = req.body;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  
  schedulerService.sendTestWeeklyReport(userId)
    .then(() => {
      res.json({ success: true, message: `Test weekly report sent to user: ${userId}` });
    })
    .catch((error) => {
      console.error('Test weekly report error:', error);
      res.status(500).json({ error: 'Failed to send test weekly report' });
    });
});

// Cronスケジューラーの状態確認エンドポイント
app.get('/scheduler/status', (req, res) => {
  const status = schedulerService.getSchedulerStatus();
  res.json({
    scheduler: 'cron-based',
    status,
    timestamp: new Date().toISOString(),
    timezone: 'UTC',
    schedules: {
      weeklyReport: 'Every Sunday at 21:00 UTC (Monday 6:00 JST)',
      exchangeRates: [
        'Daily at 21:00 UTC (6:00 JST next day)',
        'Daily at 03:00 UTC (12:00 JST)',
        'Daily at 09:00 UTC (18:00 JST)'
      ]
    }
  });
});

// 手動でcronジョブをトリガーするエンドポイント（テスト用）
app.post('/scheduler/trigger', express.json(), async (req, res) => {
  const { type } = req.body;
  
  try {
    switch (type) {
      case 'exchange-rate':
        await schedulerService.triggerExchangeRateUpdate();
        res.json({ success: true, message: 'Exchange rate update triggered manually' });
        break;
      case 'weekly-report':
        await schedulerService.triggerWeeklyReports();
        res.json({ success: true, message: 'Weekly reports triggered manually' });
        break;
      default:
        res.status(400).json({ error: 'Invalid type. Use "exchange-rate" or "weekly-report"' });
    }
  } catch (error) {
    console.error('Manual trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger scheduler' });
  }
});

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), (req: express.Request, res: express.Response) => {
  console.log('🎯 Webhook received:', {
    timestamp: new Date().toISOString(),
    events: req.body.events?.length || 0,
    body: JSON.stringify(req.body, null, 2)
  });
  
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => {
      console.log('✅ Webhook processed successfully:', result.length, 'events');
      res.json(result);
    })
    .catch((err) => {
      console.error('❌ Webhook Error:', err);
      res.status(500).end();
    });
});

// イベント処理
async function handleEvent(event: line.WebhookEvent): Promise<void> {
  console.log('📨 Processing event:', {
    type: event.type,
    timestamp: event.timestamp,
    source: event.source
  });

  if (event.type === 'message') {
    try {
      await budgetBot.handleMessage(event);
      console.log('✅ Message handled successfully');
    } catch (error) {
      console.error('❌ Event handling error:', error);
    }
  } else if (event.type === 'postback') {
    try {
      await budgetBot.handlePostback(event);
      console.log('✅ Postback handled successfully');
    } catch (error) {
      console.error('❌ Postback handling error:', error);
    }
  } else if (event.type === 'follow') {
    try {
      await budgetBot.handleFollow(event);
      console.log('✅ Follow event handled successfully');
    } catch (error) {
      console.error('❌ Follow event handling error:', error);
    }
  } else if (event.type === 'unfollow') {
    try {
      await budgetBot.handleUnfollow(event);
      console.log('✅ Unfollow event handled successfully');
    } catch (error) {
      console.error('❌ Unfollow event handling error:', error);
    }
  } else {
    console.log('⏩ Skipping event type:', event.type);
  }
}

const client = new line.messagingApi.MessagingApiClient(config);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Budget Bot server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  
  // リッチメニューを初期化
  await budgetBot.initializeRichMenu();
  
  // スケジューラーを開始
  schedulerService.start();
});