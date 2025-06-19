import * as line from '@line/bot-sdk';
import { databaseService } from '../database/prisma';
import { ocrService } from '../services/ocrService';
import { CurrencyService, ParsedAmount } from '../services/currencyService';
import { PrismaClient } from '@prisma/client';

type Transaction = NonNullable<Awaited<ReturnType<PrismaClient['transaction']['findFirst']>>>;

interface PendingTransaction {
  userId: string;
  parsedAmounts: ParsedAmount[];
  storeName: string | null;
  timestamp: number;
}

export class BudgetBot {
  private client: line.messagingApi.MessagingApiClient;
  private blobClient: line.messagingApi.MessagingApiBlobClient;
  private pendingTransactions: Map<string, PendingTransaction> = new Map();

  constructor() {
    const config = {
      channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
      channelSecret: process.env.CHANNEL_SECRET!
    };
    this.client = new line.messagingApi.MessagingApiClient(config);
    this.blobClient = new line.messagingApi.MessagingApiBlobClient(config);
  }

  async handleMessage(event: line.MessageEvent): Promise<void> {
    const { replyToken, source } = event;
    const userId = source.userId;

    if (!userId) return;

    // Ensure user exists in database
    let user = await databaseService.getUser(userId);
    if (!user) {
      user = await databaseService.createUser(userId);
    }

    switch (event.message.type) {
      case 'text':
        await this.handleTextMessage(replyToken, userId, event.message.text);
        break;
      case 'image':
        await this.handleImageMessage(replyToken, userId, event.message.id);
        break;
      default:
        await this.replyMessage(replyToken, 'テキストメッセージまたは画像を送信してください。');
    }
  }

  async handlePostback(event: line.PostbackEvent): Promise<void> {
    const { replyToken, source, postback } = event;
    const userId = source.userId;

    if (!userId) return;

    const data = postback.data;
    
    if (data.startsWith('confirm_')) {
      const confirmed = data === 'confirm_yes';
      await this.handleConfirmation(replyToken, userId, confirmed);
    } else if (data.startsWith('menu_')) {
      await this.handleMenuAction(replyToken, userId, data);
    }
  }

  private async handleTextMessage(replyToken: string, userId: string, text: string): Promise<void> {
    const command = text.toLowerCase().trim();

    // 確認応答のチェック
    if (command === 'はい' || command === 'yes' || command === 'ok' || command === '確定') {
      await this.handleConfirmation(replyToken, userId, true);
      return;
    } else if (command === 'いいえ' || command === 'no' || command === 'キャンセル') {
      await this.handleConfirmation(replyToken, userId, false);
      return;
    }

    if (command.startsWith('予算設定') || command.startsWith('budget set')) {
      await this.handleBudgetSet(replyToken, userId, text);
    } else if (command === '予算設定') {
      // クイックリプライ用の予算設定メニューを表示
      await this.showBudgetSetMenu(replyToken);
    } else if (command === '予算確認' || command === 'budget' || command === 'status') {
      await this.handleBudgetStatus(replyToken, userId);
    } else if (command === '履歴' || command === 'history') {
      await this.handleTransactionHistory(replyToken, userId);
    } else if (command === 'リセット' || command === 'reset') {
      await this.handleBudgetReset(replyToken, userId);
    } else if (command === 'ヘルプ' || command === 'help') {
      await this.handleHelp(replyToken);
    } else {
      // Try to parse as manual expense entry
      const amount = this.parseAmount(text);
      if (amount > 0) {
        await this.addExpense(replyToken, userId, amount, `手動入力: ${text}`);
      } else {
        await this.handleHelp(replyToken);
      }
    }
  }

  private async handleImageMessage(replyToken: string, userId: string, messageId: string): Promise<void> {
    let hasReplied = false;
    
    try {
      // Get image content from LINE
      const stream = await this.blobClient.getMessageContent(messageId);
      
      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const imageBuffer = Buffer.concat(chunks);

      // Send processing message immediately to avoid token timeout
      await this.replyMessage(replyToken, '📷 レシートを処理中です...');
      hasReplied = true;

      // Extract text from image using OCR
      const extractedText = await ocrService.extractTextFromImage(imageBuffer);
      const receiptInfo = ocrService.parseReceiptInfo(extractedText);

      if (receiptInfo.amounts && receiptInfo.amounts.length > 0) {
        // 外貨の場合は為替レート確認中メッセージを送信
        const hasNonJPY = receiptInfo.amounts.some(amount => 
          CurrencyService.isNonJPYCurrency(amount.currency.code)
        );
        
        if (hasNonJPY) {
          await this.pushMessage(userId, '💱 為替レート確認中...');
        }
        
        // 為替変換を実行
        await this.processReceiptAmounts(userId, receiptInfo.amounts, receiptInfo.storeName);
      } else {
        await this.pushMessage(
          userId, 
          '⚠️ レシートから金額を読み取れませんでした。\n手動で金額を入力してください。\n例: "1500" または "1500円"'
        );
      }
    } catch (error) {
      console.error('Image processing error:', error);
      
      // Provide specific error messages
      let errorMessage = '❌ 画像の処理中にエラーが発生しました。';
      
      if (error instanceof Error) {
        if (error.message.includes('OCR service is not available')) {
          errorMessage = '⚠️ OCR機能が利用できません。\n手動で金額を入力してください。\n例: "1500" または "1500円"';
        } else if (error.message.includes('credentials')) {
          errorMessage = '⚠️ 画像認識サービスの設定が必要です。\n手動で金額を入力してください。\n例: "1500" または "1500円"';
        } else if (error.message.includes('billing')) {
          errorMessage = '⚠️ 画像認識サービスの課金設定が必要です。\n手動で金額を入力してください。\n例: "1500" または "1500円"';
        }
      }
      
      if (hasReplied) {
        await this.pushMessage(userId, errorMessage);
      } else {
        await this.replyMessage(replyToken, errorMessage);
      }
    }
  }

  private async handleBudgetSet(replyToken: string, userId: string, text: string): Promise<void> {
    const amount = this.parseAmount(text);
    if (amount <= 0) {
      await this.replyMessage(
        replyToken,
        '❌ 有効な金額を入力してください。\n例: "予算設定 50000" または "budget set 50000"'
      );
      return;
    }

    try {
      await databaseService.updateBudget(userId, amount);
      const message = `✅ 月間予算を ${amount.toLocaleString()}円に設定しました！`;
      
      await this.replyMessage(replyToken, message);

      // 設定後に予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = this.createBudgetProgressCard(stats);
        await this.pushFlexMessage(userId, '現在の予算状況', flexContent);
        
        const quickReplyItems = [
          { label: '📝 履歴確認', text: '履歴' },
          { label: '🔄 リセット', text: 'リセット' }
        ];
        
        await this.pushMessageWithQuickReply(userId, '予算設定が完了しました！', quickReplyItems);
      }
    } catch (error) {
      console.error('Budget set error:', error);
      await this.replyMessage(replyToken, '❌ 予算設定中にエラーが発生しました。');
    }
  }

  private async handleBudgetStatus(replyToken: string, userId: string): Promise<void> {
    try {
      const stats = await databaseService.getUserStats(userId);
      if (!stats) {
        await this.replyMessage(replyToken, '❌ ユーザー情報が見つかりません。');
        return;
      }

      // Flex Messageでプログレスカードを送信
      const flexContent = this.createBudgetProgressCard(stats);
      await this.replyFlexMessage(replyToken, '予算状況', flexContent);

      // 詳細情報をクイックリプライ付きメッセージで送信
      const statusEmoji = stats.budgetUsagePercentage > 100 ? '🚨' : 
                         stats.budgetUsagePercentage > 80 ? '⚠️' : '✅';

      const detailMessage = `${statusEmoji} 詳細情報\n\n` +
        `💰 月間予算: ${stats.monthlyBudget.toLocaleString()}円\n` +
        `💸 使用済み: ${stats.currentSpent.toLocaleString()}円\n` +
        `💵 残り予算: ${stats.remainingBudget.toLocaleString()}円`;

      const quickReplyItems = [
        { label: '📝 履歴確認', text: '履歴' },
        { label: '💰 予算変更', text: '予算設定' },
        { label: '🔄 リセット', text: 'リセット' }
      ];

      await this.pushMessageWithQuickReply(userId, detailMessage, quickReplyItems);
    } catch (error) {
      console.error('Budget status error:', error);
      await this.replyMessage(replyToken, '❌ 予算状況の取得中にエラーが発生しました。');
    }
  }

  private async handleTransactionHistory(replyToken: string, userId: string): Promise<void> {
    try {
      const transactions = await databaseService.getRecentTransactions(userId, 5);
      
      if (transactions.length === 0) {
        const message = '📝 まだ支出の履歴がありません。';
        const quickReplyItems = [
          { label: '💰 予算設定', text: '予算設定' },
          { label: '📊 予算確認', text: '予算確認' }
        ];
        await this.replyMessageWithQuickReply(replyToken, message, quickReplyItems);
        return;
      }

      let message = '📝 最近の支出履歴\n\n';
      transactions.forEach((transaction: Transaction, index: number) => {
        const date = new Date(transaction.createdAt).toLocaleDateString('ja-JP', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        message += `${index + 1}. ${transaction.amount.toLocaleString()}円\n`;
        message += `   ${transaction.description || '説明なし'}\n`;
        message += `   ${date}\n\n`;
      });

      const quickReplyItems = [
        { label: '📊 予算確認', text: '予算確認' },
        { label: '💰 予算設定', text: '予算設定' },
        { label: '🔄 リセット', text: 'リセット' }
      ];

      await this.replyMessageWithQuickReply(replyToken, message, quickReplyItems);
    } catch (error) {
      console.error('Transaction history error:', error);
      await this.replyMessage(replyToken, '❌ 履歴の取得中にエラーが発生しました。');
    }
  }

  private async handleBudgetReset(replyToken: string, userId: string): Promise<void> {
    try {
      await databaseService.resetMonthlyBudget(userId);
      const message = '🔄 月間予算をリセットしました！\n使用済み金額が0円になりました。';
      
      const quickReplyItems = [
        { label: '📊 予算確認', text: '予算確認' },
        { label: '💰 予算設定', text: '予算設定' },
        { label: '📝 履歴確認', text: '履歴' }
      ];

      await this.replyMessageWithQuickReply(replyToken, message, quickReplyItems);
    } catch (error) {
      console.error('Budget reset error:', error);
      await this.replyMessage(replyToken, '❌ 予算リセット中にエラーが発生しました。');
    }
  }

  private async handleHelp(replyToken: string): Promise<void> {
    const helpMessage = `📖 予算管理BOTの使い方\n\n` +
      `💰 予算設定: クイックリプライまたは "予算設定 50000" で設定\n` +
      `📷 支出記録: レシートの写真を送信すると自動で金額を読み取り\n` +
      `✏️ 手動入力: "1500" のように金額を入力\n\n` +
      `下のクイックリプライボタンで簡単操作できます！`;

    const quickReplyItems = [
      { label: '📊 予算確認', text: '予算確認' },
      { label: '📝 履歴確認', text: '履歴' },
      { label: '💰 予算設定', text: '予算設定' },
      { label: '🔄 リセット', text: 'リセット' }
    ];

    try {
      await this.replyMessageWithQuickReply(replyToken, helpMessage, quickReplyItems);
    } catch (error) {
      console.error('Help message with quick reply error:', error);
      // フォールバック: 通常のテキストメッセージを送信
      await this.replyMessage(replyToken, helpMessage);
    }
  }

  private async showBudgetSetMenu(replyToken: string): Promise<void> {
    const budgetMessage = `💰 月間予算を設定してください\n\n` +
      `よく使われる予算額から選択するか、\n` +
      `「予算設定 50000」のように具体的な金額を入力してください。`;

    const quickReplyItems = [
      { label: '💸 30,000円', text: '予算設定 30000' },
      { label: '💸 50,000円', text: '予算設定 50000' },
      { label: '💸 70,000円', text: '予算設定 70000' },
      { label: '💸 100,000円', text: '予算設定 100000' },
      { label: '💸 150,000円', text: '予算設定 150000' },
      { label: '💸 200,000円', text: '予算設定 200000' },
      { label: '✏️ 手動入力', text: '予算設定 ' },
      { label: '🔙 メニューに戻る', text: 'ヘルプ' }
    ];

    try {
      await this.replyMessageWithQuickReply(replyToken, budgetMessage, quickReplyItems);
    } catch (error) {
      console.error('Budget set menu error:', error);
      await this.replyMessage(replyToken, budgetMessage);
    }
  }

  private async addExpense(replyToken: string, userId: string, amount: number, description: string): Promise<void> {
    try {
      await databaseService.addTransaction(userId, amount, description);
      const stats = await databaseService.getUserStats(userId);
      
      if (!stats) {
        await this.replyMessage(replyToken, '❌ ユーザー情報が見つかりません。');
        return;
      }

      const statusEmoji = stats.budgetUsagePercentage > 100 ? '🚨' : 
                         stats.budgetUsagePercentage > 80 ? '⚠️' : '✅';

      const message = `${statusEmoji} 支出を記録しました\n\n` +
        `💸 支出: ${amount.toLocaleString()}円\n` +
        `📝 内容: ${description}`;

      await this.replyMessage(replyToken, message);

      // Flex Messageで予算状況を表示
      const flexContent = this.createBudgetProgressCard(stats);
      await this.pushFlexMessage(userId, '更新された予算状況', flexContent);

      const quickReplyItems = [
        { label: '📊 予算確認', text: '予算確認' },
        { label: '📝 履歴確認', text: '履歴' },
        { label: '💰 予算設定', text: '予算設定' }
      ];

      await this.pushMessageWithQuickReply(userId, '次の操作を選択してください', quickReplyItems);
    } catch (error) {
      console.error('Add expense error:', error);
      await this.replyMessage(replyToken, '❌ 支出の記録中にエラーが発生しました。');
    }
  }

  private parseAmount(text: string): number {
    // Remove common prefixes and suffixes
    const cleanText = text.replace(/予算設定|budget set|円|¥|\$/gi, '').trim();
    
    // Extract numbers
    const match = cleanText.match(/([0-9,]+)/);
    if (match) {
      const amount = parseInt(match[1].replace(/,/g, ''), 10);
      return isNaN(amount) ? 0 : amount;
    }
    
    return 0;
  }

  private createProgressBar(percentage: number): string {
    const bars = 10;
    const filled = Math.round((percentage / 100) * bars);
    const empty = bars - filled;
    
    return '█'.repeat(Math.min(filled, bars)) + '░'.repeat(Math.max(empty, 0));
  }

  private getBudgetPeriodStats(monthlyBudget: number, currentSpent: number): {
    daily: { budget: number; spent: number; percentage: number; remaining: number };
    weekly: { budget: number; spent: number; percentage: number; remaining: number };
    monthly: { budget: number; spent: number; percentage: number; remaining: number };
  } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    // 今月の日数を取得
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const currentDay = now.getDate();
    
    // 今週の開始日（月曜日）を取得
    const weekStart = new Date(now);
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 日曜日を7とする
    weekStart.setDate(now.getDate() - (dayOfWeek - 1));
    weekStart.setHours(0, 0, 0, 0);
    
    // 今週の終了日（日曜日）を取得
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    // 今週は何日あるか（月の境界を考慮）
    const daysInCurrentWeek = Math.min(7, Math.ceil((weekEnd.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    
    // 日毎予算計算
    const dailyBudget = monthlyBudget / daysInMonth;
    const dailyExpectedSpent = dailyBudget * currentDay;
    const dailyPercentage = (currentSpent / dailyExpectedSpent) * 100;
    const dailyRemaining = dailyExpectedSpent - currentSpent;
    
    // 週毎予算計算
    const weeklyBudget = (monthlyBudget / daysInMonth) * daysInCurrentWeek;
    const weeklyPercentage = (currentSpent / weeklyBudget) * 100;
    const weeklyRemaining = weeklyBudget - currentSpent;
    
    // 月毎予算計算
    const monthlyPercentage = (currentSpent / monthlyBudget) * 100;
    const monthlyRemaining = monthlyBudget - currentSpent;
    
    return {
      daily: {
        budget: Math.round(dailyExpectedSpent),
        spent: currentSpent,
        percentage: Math.round(dailyPercentage * 10) / 10,
        remaining: Math.round(dailyRemaining)
      },
      weekly: {
        budget: Math.round(weeklyBudget),
        spent: currentSpent,
        percentage: Math.round(weeklyPercentage * 10) / 10,
        remaining: Math.round(weeklyRemaining)
      },
      monthly: {
        budget: monthlyBudget,
        spent: currentSpent,
        percentage: Math.round(monthlyPercentage * 10) / 10,
        remaining: Math.round(monthlyRemaining)
      }
    };
  }

  private createBudgetProgressCard(stats: any): any {
    const periodStats = this.getBudgetPeriodStats(stats.monthlyBudget, stats.currentSpent);
    
    // ステータスと色を決定
    const getStatusAndColor = (percentage: number) => {
      if (percentage <= 50) return { status: 'Good', color: '#06C755' };
      if (percentage <= 80) return { status: 'Warning', color: '#FF9500' };
      return { status: 'Over Budget', color: '#FF334B' };
    };

    const dailyStatus = getStatusAndColor(periodStats.daily.percentage);
    const weeklyStatus = getStatusAndColor(periodStats.weekly.percentage);
    const monthlyStatus = getStatusAndColor(periodStats.monthly.percentage);

    return {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          size: 'micro',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📅 Daily',
                weight: 'bold',
                color: '#ffffff',
                size: 'sm'
              },
              {
                type: 'text',
                text: `${periodStats.daily.percentage}%`,
                weight: 'bold',
                color: '#ffffff',
                size: 'lg'
              }
            ],
            backgroundColor: dailyStatus.color,
            paddingTop: 'md',
            paddingBottom: 'xs',
            paddingStart: 'md',
            paddingEnd: 'md'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                spacing: 'sm',
                contents: [
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: 'Used',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 1
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.daily.spent.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 2
                      }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: 'Budget',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 1
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.daily.budget.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 2
                      }
                    ]
                  }
                ]
              }
            ]
          }
        },
        {
          type: 'bubble',
          size: 'micro',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📊 Weekly',
                weight: 'bold',
                color: '#ffffff',
                size: 'sm'
              },
              {
                type: 'text',
                text: `${periodStats.weekly.percentage}%`,
                weight: 'bold',
                color: '#ffffff',
                size: 'lg'
              }
            ],
            backgroundColor: weeklyStatus.color,
            paddingTop: 'md',
            paddingBottom: 'xs',
            paddingStart: 'md',
            paddingEnd: 'md'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                spacing: 'sm',
                contents: [
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: 'Used',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 1
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.weekly.spent.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 2
                      }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: 'Budget',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 1
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.weekly.budget.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 2
                      }
                    ]
                  }
                ]
              }
            ]
          }
        },
        {
          type: 'bubble',
          size: 'micro',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📈 Monthly',
                weight: 'bold',
                color: '#ffffff',
                size: 'sm'
              },
              {
                type: 'text',
                text: `${periodStats.monthly.percentage}%`,
                weight: 'bold',
                color: '#ffffff',
                size: 'lg'
              }
            ],
            backgroundColor: monthlyStatus.color,
            paddingTop: 'md',
            paddingBottom: 'xs',
            paddingStart: 'md',
            paddingEnd: 'md'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                spacing: 'sm',
                contents: [
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: 'Used',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 1
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.monthly.spent.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 2
                      }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: 'Budget',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 1
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.monthly.budget.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 2
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      ]
    };
  }

  private async replyMessage(replyToken: string, text: string): Promise<void> {
    try {
      await this.client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text
        }]
      });
    } catch (error) {
      console.error('Reply message error:', error);
    }
  }

  private async pushMessage(userId: string, text: string): Promise<void> {
    try {
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'text',
          text
        }]
      });
    } catch (error) {
      console.error('Push message error:', error);
    }
  }

  private async replyMessageWithQuickReply(
    replyToken: string, 
    text: string, 
    quickReplyItems: { label: string; text: string }[]
  ): Promise<void> {
    try {
      await this.client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text,
          quickReply: {
            items: quickReplyItems.map(item => ({
              type: 'action',
              action: {
                type: 'message',
                label: item.label,
                text: item.text
              }
            }))
          }
        }]
      });
    } catch (error) {
      console.error('Reply message with quick reply error:', error);
    }
  }

  private async pushMessageWithQuickReply(
    userId: string, 
    text: string, 
    quickReplyItems: { label: string; text: string }[]
  ): Promise<void> {
    try {
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'text',
          text,
          quickReply: {
            items: quickReplyItems.map(item => ({
              type: 'action',
              action: {
                type: 'message',
                label: item.label,
                text: item.text
              }
            }))
          }
        }]
      });
    } catch (error) {
      console.error('Push message with quick reply error:', error);
    }
  }

  private async replyFlexMessage(replyToken: string, altText: string, flexContent: any): Promise<void> {
    try {
      await this.client.replyMessage({
        replyToken,
        messages: [{
          type: 'flex',
          altText,
          contents: flexContent
        }]
      });
    } catch (error) {
      console.error('Reply flex message error:', error);
    }
  }

  private async pushFlexMessage(userId: string, altText: string, flexContent: any): Promise<void> {
    try {
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'flex',
          altText,
          contents: flexContent
        }]
      });
    } catch (error) {
      console.error('Push flex message error:', error);
    }
  }

  private async pushButtonsMessage(
    userId: string, 
    title: string, 
    text: string, 
    actions: { label: string; data: string }[]
  ): Promise<void> {
    try {
      console.log('🔄 Sending buttons message:', {
        userId,
        title,
        text: text.substring(0, 100) + '...',
        actionsCount: actions.length
      });
      
      // LINE Buttonsテンプレートの制限事項を考慮
      const truncatedTitle = title.length > 40 ? title.substring(0, 37) + '...' : title;
      const truncatedText = text.length > 60 ? text.substring(0, 57) + '...' : text;
      
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'template',
          altText: title,
          template: {
            type: 'buttons',
            title: truncatedTitle,
            text: truncatedText,
            actions: actions.map(action => ({
              type: 'postback',
              label: action.label,
              data: action.data
            }))
          }
        }]
      });
      
      console.log('✅ Buttons message sent successfully');
    } catch (error) {
      console.error('❌ Push buttons message error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
    }
  }

  private async processReceiptAmounts(userId: string, amounts: ParsedAmount[], storeName: string | null): Promise<void> {
    try {
      console.log('🔍 Processing receipt amounts:', { userId, amountsCount: amounts.length, storeName });
      
      // 最大の金額を選択（通常は合計金額）
      const mainAmount = amounts[0];
      console.log('💰 Main amount detected:', mainAmount);
      
      // 日本円に変換
      console.log('💱 Converting to JPY...');
      const conversionResult = await CurrencyService.convertToJPY(
        mainAmount.amount, 
        mainAmount.currency.code
      );
      console.log('✅ Conversion result:', conversionResult);
      
      // 変換後の金額を追加
      mainAmount.convertedAmount = conversionResult.convertedAmount;
      
      // 詳細情報を先に送信
      let detailText = '';
      if (mainAmount.currency.code === 'JPY') {
        detailText = `💰 金額: ${mainAmount.amount.toLocaleString()}円`;
      } else {
        detailText = `💰 元の金額: ${mainAmount.amount.toLocaleString()} ${mainAmount.currency.code}\n`;
        detailText += `💱 日本円: ${conversionResult.convertedAmount.toLocaleString()}円\n`;
        detailText += `📊 レート: 1 ${mainAmount.currency.code} = ${conversionResult.rate.toFixed(4)} JPY\n`;
        detailText += `${conversionResult.isRealTime ? '🔄 リアルタイムレート' : '⚠️ 固定レート'}`;
      }
      
      if (storeName) {
        detailText += `\n🏪 店舗: ${storeName}`;
      }
      
      // 詳細情報を送信
      await this.pushMessage(userId, detailText);
      
      // 保留中取引として保存
      this.pendingTransactions.set(userId, {
        userId,
        parsedAmounts: [mainAmount],
        storeName,
        timestamp: Date.now()
      });
      console.log('💾 Pending transaction saved');
      
      // 確認用の簡潔なメッセージでButtonsテンプレートを送信
      const confirmText = '📋 この支出を記録しますか？';
      console.log('📤 About to send buttons message...');
      await this.pushButtonsMessage(userId, '支出確認', confirmText, [
        { label: '✅ 記録する', data: 'confirm_yes' },
        { label: '❌ キャンセル', data: 'confirm_no' }
      ]);
      
    } catch (error) {
      console.error('❌ Process receipt amounts error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
      }
      await this.pushMessage(userId, '❌ 為替レートの取得中にエラーが発生しました。手動で金額を入力してください。');
    }
  }

  private async handleConfirmation(replyToken: string, userId: string, confirmed: boolean): Promise<void> {
    const pending = this.pendingTransactions.get(userId);
    
    if (!pending) {
      await this.replyMessage(replyToken, '⚠️ 確認待ちの取引がありません。');
      return;
    }
    
    // 保留中の取引を削除
    this.pendingTransactions.delete(userId);
    
    if (confirmed) {
      const mainAmount = pending.parsedAmounts[0];
      const jpyAmount = mainAmount.convertedAmount || mainAmount.amount;
      
      const description = pending.storeName 
        ? `${pending.storeName} - レシート`
        : 'レシート';
      
      await this.addExpense(replyToken, userId, jpyAmount, description);
    } else {
      await this.replyMessage(replyToken, '❌ 支出の記録をキャンセルしました。');
    }
  }

  private async handleMenuAction(replyToken: string, userId: string, action: string): Promise<void> {
    switch (action) {
      case 'menu_budget_status':
        await this.handleBudgetStatus(replyToken, userId);
        break;
      case 'menu_history':
        await this.handleTransactionHistory(replyToken, userId);
        break;
      case 'menu_reset':
        await this.handleBudgetReset(replyToken, userId);
        break;
      case 'menu_help':
        await this.handleHelp(replyToken);
        break;
      default:
        await this.replyMessage(replyToken, '⚠️ 不明なアクションです。');
    }
  }

  private async addExpenseWithPush(userId: string, amount: number, description: string): Promise<void> {
    try {
      await databaseService.addTransaction(userId, amount, description);
      const stats = await databaseService.getUserStats(userId);
      
      if (!stats) {
        await this.pushMessage(userId, '❌ ユーザー情報が見つかりません。');
        return;
      }

      const statusEmoji = stats.budgetUsagePercentage > 100 ? '🚨' : 
                         stats.budgetUsagePercentage > 80 ? '⚠️' : '✅';

      const message = `${statusEmoji} 支出を記録しました\n\n` +
        `💸 支出: ${amount.toLocaleString()}円\n` +
        `📝 内容: ${description}`;

      await this.pushMessage(userId, message);

      // Flex Messageで予算状況を表示
      const flexContent = this.createBudgetProgressCard(stats);
      await this.pushFlexMessage(userId, '更新された予算状況', flexContent);

      const quickReplyItems = [
        { label: '📊 予算確認', text: '予算確認' },
        { label: '📝 履歴確認', text: '履歴' },
        { label: '💰 予算設定', text: '予算設定' }
      ];

      await this.pushMessageWithQuickReply(userId, '次の操作を選択してください', quickReplyItems);
    } catch (error) {
      console.error('Add expense with push error:', error);
      await this.pushMessage(userId, '❌ 支出の記録中にエラーが発生しました。');
    }
  }
}