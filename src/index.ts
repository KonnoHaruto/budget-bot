import express from 'express';
import * as line from '@line/bot-sdk';
import multer from 'multer';
import 'dotenv/config';
import { databaseService } from './database/prisma';
import { ocrService } from './services/ocrService';
import { BudgetBot } from './bot/budgetBot';
import { SchedulerService } from './services/schedulerService';

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.CHANNEL_SECRET!
};

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const budgetBot = new BudgetBot();
const schedulerService = new SchedulerService(budgetBot);

// Health checkエンドポイント
app.get('/health', (req, res) => {
  console.log('🔍 Health check accessed at:', new Date().toISOString());
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
  } else {
    console.log('⏩ Skipping event type:', event.type);
  }
}

const client = new line.messagingApi.MessagingApiClient(config);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Budget Bot server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  
  // スケジューラーを開始
  schedulerService.start();
});