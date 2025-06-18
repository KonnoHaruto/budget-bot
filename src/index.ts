import express from 'express';
import * as line from '@line/bot-sdk';
import multer from 'multer';
import 'dotenv/config';
import { databaseService } from './database/prisma';
import { ocrService } from './services/ocrService';
import { BudgetBot } from './bot/budgetBot';

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.CHANNEL_SECRET!
};

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const budgetBot = new BudgetBot();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), (req: express.Request, res: express.Response) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(500).end();
    });
});

// イベント処理
async function handleEvent(event: line.WebhookEvent): Promise<void> {
  if (event.type !== 'message') {
    return;
  }

  try {
    await budgetBot.handleMessage(event);
  } catch (error) {
    console.error('Event handling error:', error);
  }
}

const client = new line.messagingApi.MessagingApiClient(config);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Budget Bot server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});