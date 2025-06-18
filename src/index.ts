import express from 'express';
import * as line from '@line/bot-sdk';
import 'dotenv/config';

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.CHANNEL_SECRET!
};

const app = express();

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), (req: express.Request, res: express.Response) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// イベント処理
function handleEvent(event: line.WebhookEvent) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  // エコーボット（テスト用）
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: event.message.text
    }]
  });
}

const client = new line.messagingApi.MessagingApiClient(config);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});