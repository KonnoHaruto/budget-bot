import * as line from '@line/bot-sdk';
import { databaseService } from '../database/prisma';
import { ocrService } from '../services/ocrService';
import { CurrencyService, ParsedAmount } from '../services/currencyService';
import { PrismaClient } from '@prisma/client';

type Transaction = {
  id: number;
  userId: string;
  amount: number;
  description: string | null;
  imageUrl: string | null;
  createdAt: Date;
};

interface PendingTransaction {
  userId: string;
  parsedAmounts: ParsedAmount[];
  storeName: string | null;
  timestamp: number;
}

interface PendingEdit {
  userId: string;
  transactionId: number;
  timestamp: number;
}

interface PendingDelete {
  userId: string;
  transactionId: number;
  timestamp: number;
}

export class BudgetBot {
  private client: line.messagingApi.MessagingApiClient;
  private blobClient: line.messagingApi.MessagingApiBlobClient;
  private pendingTransactions: Map<string, PendingTransaction> = new Map();
  private pendingEdits: Map<string, PendingEdit> = new Map();
  private pendingDeletes: Map<string, PendingDelete> = new Map();

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
      if (data.startsWith('confirm_reset_')) {
        const confirmed = data === 'confirm_reset_yes';
        await this.handleResetConfirmation(replyToken, userId, confirmed);
      } else {
        const confirmed = data === 'confirm_yes';
        await this.handleConfirmation(replyToken, userId, confirmed);
      }
    } else if (data.startsWith('menu_')) {
      await this.handleMenuAction(replyToken, userId, data);
    } else if (data.startsWith('edit_transaction_')) {
      const transactionId = data.replace('edit_transaction_', '');
      await this.handleTransactionEdit(replyToken, userId, transactionId);
    } else if (data.startsWith('delete_transaction_')) {
      const transactionId = data.replace('delete_transaction_', '');
      await this.handleTransactionDelete(replyToken, userId, transactionId);
    } else if (data.startsWith('confirm_delete_')) {
      if (data === 'confirm_delete_cancel') {
        await this.replyMessage(replyToken, '❌ 削除をキャンセルしました。');
      } else {
        const transactionId = data.replace('confirm_delete_', '');
        await this.handleTransactionDeleteConfirm(replyToken, userId, transactionId);
      }
    }
  }

  private async handleTextMessage(replyToken: string, userId: string, text: string): Promise<void> {
    const command = text.toLowerCase().trim();

    // 削除待機状態のチェック
    const pendingDelete = this.pendingDeletes.get(userId);
    if (pendingDelete) {
      if (command === 'はい' || command === 'yes' || command === '削除' || command === 'ok') {
        await this.handleDirectDeleteConfirm(replyToken, userId, pendingDelete.transactionId);
        this.pendingDeletes.delete(userId);
        return;
      } else if (command === 'いいえ' || command === 'no' || command === 'キャンセル' || command === 'cancel') {
        await this.replyMessage(replyToken, '❌ 削除をキャンセルしました。');
        this.pendingDeletes.delete(userId);
        return;
      } else {
        await this.replyMessage(replyToken, '❌ "はい" または "いいえ" で答えてください。');
        return;
      }
    }

    // 編集待機状態のチェック
    const pendingEdit = this.pendingEdits.get(userId);
    if (pendingEdit) {
      const amount = this.parseAmount(text);
      if (amount > 0) {
        await this.handleDirectEditAmount(replyToken, userId, pendingEdit.transactionId, amount);
        this.pendingEdits.delete(userId);
        return;
      } else {
        await this.replyMessage(replyToken, '❌ 正しい金額を入力してください。例: "2500"');
        return;
      }
    }

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
    } else if (text.startsWith('edit ')) {
      // 取引編集コマンド: "edit transactionId newAmount"
      await this.handleEditCommand(replyToken, userId, text);
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
        const flexContent = await this.createBudgetProgressCard(stats, userId);
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
      const flexContent = await this.createBudgetProgressCard(stats, userId);
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
      const transactions = await databaseService.getRecentTransactions(userId, 10);
      
      if (transactions.length === 0) {
        const message = '📝 まだ支出の履歴がありません。';
        const quickReplyItems = [
          { label: '💰 予算設定', text: '予算設定' },
          { label: '📊 予算確認', text: '予算確認' }
        ];
        await this.replyMessageWithQuickReply(replyToken, message, quickReplyItems);
        return;
      }

      // Flex Messageで取引一覧を表示
      const flexContent = this.createTransactionListCard(transactions);
      await this.replyFlexMessage(replyToken, '取引履歴', flexContent);

      const quickReplyItems = [
        { label: '📊 予算確認', text: '予算確認' },
        { label: '💰 予算設定', text: '予算設定' },
        { label: '🔄 リセット', text: 'リセット' }
      ];

      await this.pushMessageWithQuickReply(userId, '取引の編集・削除は各項目をタップしてください', quickReplyItems);
    } catch (error) {
      console.error('Transaction history error:', error);
      await this.replyMessage(replyToken, '❌ 履歴の取得中にエラーが発生しました。');
    }
  }

  private createTransactionListCard(transactions: Transaction[]): any {
    const bubbles = transactions.map((transaction: Transaction) => {
      const date = new Date(transaction.createdAt).toLocaleDateString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return {
        type: 'bubble',
        size: 'micro',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `¥${transaction.amount.toLocaleString()}`,
              weight: 'bold',
              color: '#ffffff',
              size: 'md'
            },
            {
              type: 'text',
              text: date,
              color: '#ffffff',
              size: 'xs'
            }
          ],
          backgroundColor: '#17c950',
          paddingTop: 'md',
          paddingBottom: 'md',
          paddingStart: 'md',
          paddingEnd: 'md'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: transaction.description || '説明なし',
              wrap: true,
              color: '#666666',
              size: 'sm'
            }
          ],
          paddingTop: 'md',
          paddingBottom: 'sm',
          paddingStart: 'md',
          paddingEnd: 'md'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'postback',
                label: '✏️ 編集',
                data: `edit_transaction_${transaction.id}`
              }
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'postback',
                label: '🗑️ 削除',
                data: `delete_transaction_${transaction.id}`
              }
            }
          ],
          spacing: 'sm',
          paddingTop: 'sm',
          paddingBottom: 'md',
          paddingStart: 'md',
          paddingEnd: 'md'
        }
      };
    });

    return {
      type: 'carousel',
      contents: bubbles
    };
  }

  private async handleBudgetReset(replyToken: string, userId: string): Promise<void> {
    // リセット警告メッセージを表示
    const warningMessage = '⚠️ 重要な警告\n\n' +
      'すべての取引データが完全に削除されます。\n' +
      'この操作は取り消すことができません。\n\n' +
      '本当にリセットしますか？';

    const actions = [
      { label: '✅ リセット実行', data: 'confirm_reset_yes' },
      { label: '❌ キャンセル', data: 'confirm_reset_no' }
    ];

    await this.pushButtonsMessage(userId, 'データリセット確認', warningMessage, actions);
    await this.replyMessage(replyToken, '上記の確認メッセージをご確認ください。');
  }

  private async handleResetConfirmation(replyToken: string, userId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) {
      await this.replyMessage(replyToken, '❌ リセットをキャンセルしました。');
      return;
    }

    try {
      await databaseService.resetMonthlyBudget(userId);
      const message = '🔄 月間予算をリセットしました！\n' +
        'すべての取引データと使用済み金額が削除されました。';
      
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
      const flexContent = await this.createBudgetProgressCard(stats, userId);
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

  private async getBudgetPeriodStats(monthlyBudget: number, currentSpent: number, userId: string): Promise<{
    daily: { budget: number; spent: number; percentage: number; remaining: number; todaySpent: number };
    weekly: { budget: number; spent: number; percentage: number; remaining: number };
    monthly: { budget: number; spent: number; percentage: number; remaining: number };
  }> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    // 今月の日数を取得
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // 今日の支出を取得
    const todaySpent = await databaseService.getTodaySpent(userId);
    
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
    
    // 日毎予算計算（改善版）
    const dailyBudget = monthlyBudget / daysInMonth; // 1日あたりの予算
    const dailyRemaining = dailyBudget - todaySpent; // 今日の残り予算
    const dailyPercentage = dailyBudget > 0 ? (todaySpent / dailyBudget) * 100 : 0;
    
    // 週毎予算計算
    const weeklyBudget = (monthlyBudget / daysInMonth) * daysInCurrentWeek;
    const weeklyPercentage = (currentSpent / weeklyBudget) * 100;
    const weeklyRemaining = weeklyBudget - currentSpent;
    
    // 月毎予算計算
    const monthlyPercentage = (currentSpent / monthlyBudget) * 100;
    const monthlyRemaining = monthlyBudget - currentSpent;
    
    return {
      daily: {
        budget: Math.round(dailyBudget),
        spent: Math.round(todaySpent),
        todaySpent: Math.round(todaySpent),
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

  private createProgressIndicator(percentage: number): string {
    const totalDots = 10;
    const filledDots = Math.min(Math.round((percentage / 100) * totalDots), totalDots);
    const emptyDots = totalDots - filledDots;
    
    return '●'.repeat(filledDots) + '○'.repeat(emptyDots);
  }

  private async createBudgetProgressCard(stats: any, userId: string): Promise<any> {
    const periodStats = await this.getBudgetPeriodStats(stats.monthlyBudget, stats.currentSpent, userId);
    
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
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: 'Daily',
                weight: 'bold',
                color: '#ffffff',
                size: 'md',
                align: 'center'
              },
              {
                type: 'text',
                text: `¥${Math.max(0, periodStats.daily.remaining).toLocaleString()}`,
                weight: 'bold',
                color: '#ffffff',
                size: 'xl',
                align: 'center'
              },
              {
                type: 'text',
                text: '残り',
                color: '#ffffff',
                size: 'xs',
                align: 'center'
              }
            ],
            backgroundColor: dailyStatus.color,
            paddingTop: 'lg',
            paddingBottom: 'lg',
            paddingStart: 'md',
            paddingEnd: 'md'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: this.createProgressIndicator(periodStats.daily.percentage),
                size: 'lg',
                color: '#666666',
                align: 'center',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                spacing: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '今日の支出',
                    color: '#aaaaaa',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: `¥${periodStats.daily.todaySpent.toLocaleString()}`,
                    color: '#666666',
                    size: 'md',
                    weight: 'bold'
                  },
                  {
                    type: 'text',
                    text: '1日あたりの予算',
                    color: '#aaaaaa',
                    size: 'sm',
                    margin: 'md'
                  },
                  {
                    type: 'text',
                    text: `¥${periodStats.daily.budget.toLocaleString()}`,
                    color: '#666666',
                    size: 'md',
                    weight: 'bold'
                  }
                ]
              }
            ],
            paddingTop: 'lg',
            paddingBottom: 'lg',
            paddingStart: 'lg',
            paddingEnd: 'lg'
          }
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: 'Weekly',
                weight: 'bold',
                color: '#ffffff',
                size: 'md',
                align: 'center'
              },
              {
                type: 'text',
                text: `¥${Math.max(0, periodStats.weekly.remaining).toLocaleString()}`,
                weight: 'bold',
                color: '#ffffff',
                size: 'xl',
                align: 'center'
              },
              {
                type: 'text',
                text: '残り',
                color: '#ffffff',
                size: 'xs',
                align: 'center'
              }
            ],
            backgroundColor: weeklyStatus.color,
            paddingTop: 'lg',
            paddingBottom: 'lg',
            paddingStart: 'md',
            paddingEnd: 'md'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: this.createProgressIndicator(periodStats.weekly.percentage),
                size: 'lg',
                color: '#666666',
                align: 'center',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                spacing: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '今週の支出',
                    color: '#aaaaaa',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: `¥${periodStats.weekly.spent.toLocaleString()}`,
                    color: '#666666',
                    size: 'md',
                    weight: 'bold'
                  },
                  {
                    type: 'text',
                    text: '今週の予算',
                    color: '#aaaaaa',
                    size: 'sm',
                    margin: 'md'
                  },
                  {
                    type: 'text',
                    text: `¥${periodStats.weekly.budget.toLocaleString()}`,
                    color: '#666666',
                    size: 'md',
                    weight: 'bold'
                  }
                ]
              }
            ],
            paddingTop: 'lg',
            paddingBottom: 'lg',
            paddingStart: 'lg',
            paddingEnd: 'lg'
          }
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: 'Monthly',
                weight: 'bold',
                color: '#ffffff',
                size: 'md',
                align: 'center'
              },
              {
                type: 'text',
                text: `¥${Math.max(0, periodStats.monthly.remaining).toLocaleString()}`,
                weight: 'bold',
                color: '#ffffff',
                size: 'xl',
                align: 'center'
              },
              {
                type: 'text',
                text: '残り',
                color: '#ffffff',
                size: 'xs',
                align: 'center'
              }
            ],
            backgroundColor: monthlyStatus.color,
            paddingTop: 'lg',
            paddingBottom: 'lg',
            paddingStart: 'md',
            paddingEnd: 'md'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: this.createProgressIndicator(periodStats.monthly.percentage),
                size: 'lg',
                color: '#666666',
                align: 'center',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                spacing: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '今月の支出',
                    color: '#aaaaaa',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: `¥${periodStats.monthly.spent.toLocaleString()}`,
                    color: '#666666',
                    size: 'md',
                    weight: 'bold'
                  },
                  {
                    type: 'text',
                    text: '月間予算',
                    color: '#aaaaaa',
                    size: 'sm',
                    margin: 'md'
                  },
                  {
                    type: 'text',
                    text: `¥${periodStats.monthly.budget.toLocaleString()}`,
                    color: '#666666',
                    size: 'md',
                    weight: 'bold'
                  }
                ]
              }
            ],
            paddingTop: 'lg',
            paddingBottom: 'lg',
            paddingStart: 'lg',
            paddingEnd: 'lg'
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
      const flexContent = await this.createBudgetProgressCard(stats, userId);
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

  private async handleTransactionEdit(replyToken: string, userId: string, transactionId: string): Promise<void> {
    try {
      // 取引情報を取得して表示
      const transactions = await databaseService.getRecentTransactions(userId, 50);
      const transactionIdNum = parseInt(transactionId);
      const transaction = transactions.find((t: Transaction) => t.id === transactionIdNum);
      
      if (!transaction) {
        await this.replyMessage(replyToken, '❌ 取引が見つかりません。');
        return;
      }

      // 編集待機状態を設定
      this.pendingEdits.set(userId, {
        userId,
        transactionId: transactionIdNum,
        timestamp: Date.now()
      });

      const message = `✏️ 取引の編集\n\n` +
        `現在の金額: ${transaction.amount.toLocaleString()}円\n` +
        `内容: ${transaction.description}\n\n` +
        `新しい金額を入力してください。\n` +
        `例: "2500"`;

      await this.replyMessage(replyToken, message);
    } catch (error) {
      console.error('Transaction edit error:', error);
      await this.replyMessage(replyToken, '❌ 取引編集の準備中にエラーが発生しました。');
    }
  }

  private async handleTransactionDelete(replyToken: string, userId: string, transactionId: string): Promise<void> {
    try {
      // 取引情報を取得して確認メッセージを表示
      const transactions = await databaseService.getRecentTransactions(userId, 50);
      const transactionIdNum = parseInt(transactionId);
      const transaction = transactions.find((t: Transaction) => t.id === transactionIdNum);
      
      if (!transaction) {
        await this.replyMessage(replyToken, '❌ 取引が見つかりません。');
        return;
      }

      // 削除待機状態を設定
      this.pendingDeletes.set(userId, {
        userId,
        transactionId: transactionIdNum,
        timestamp: Date.now()
      });

      const confirmMessage = `🗑️ 取引の削除確認\n\n` +
        `金額: ${transaction.amount.toLocaleString()}円\n` +
        `内容: ${transaction.description}\n` +
        `日時: ${new Date(transaction.createdAt).toLocaleString('ja-JP')}\n\n` +
        `この取引を削除しますか？\n` +
        `"はい" または "いいえ" で答えてください。`;

      await this.replyMessage(replyToken, confirmMessage);
    } catch (error) {
      console.error('Transaction delete error:', error);
      await this.replyMessage(replyToken, '❌ 取引削除の準備中にエラーが発生しました。');
    }
  }

  private async handleDirectEditAmount(replyToken: string, userId: string, transactionId: number, newAmount: number): Promise<void> {
    try {
      const updatedTransaction = await databaseService.editTransaction(userId, transactionId, newAmount);
      
      const message = `✅ 取引を編集しました\n\n` +
        `新しい金額: ${newAmount.toLocaleString()}円\n` +
        `内容: ${updatedTransaction.description}`;

      await this.replyMessage(replyToken, message);

      // 更新された予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
      }
    } catch (error) {
      console.error('Direct edit error:', error);
      if (error instanceof Error && error.message === 'Transaction not found') {
        await this.replyMessage(replyToken, '❌ 指定された取引が見つかりません。');
      } else {
        await this.replyMessage(replyToken, '❌ 取引の編集中にエラーが発生しました。');
      }
    }
  }

  private async handleDirectDeleteConfirm(replyToken: string, userId: string, transactionId: number): Promise<void> {
    try {
      const result = await databaseService.deleteTransaction(userId, transactionId);
      
      const message = `✅ 取引を削除しました\n\n` +
        `削除された金額: ${result.deletedAmount.toLocaleString()}円`;

      await this.replyMessage(replyToken, message);

      // 更新された予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
      }
    } catch (error) {
      console.error('Direct delete error:', error);
      if (error instanceof Error && error.message === 'Transaction not found') {
        await this.replyMessage(replyToken, '❌ 指定された取引が見つかりません。');
      } else {
        await this.replyMessage(replyToken, '❌ 取引の削除中にエラーが発生しました。');
      }
    }
  }

  private async handleEditCommand(replyToken: string, userId: string, text: string): Promise<void> {
    try {
      // "edit transactionId newAmount" の形式をパース
      const parts = text.split(' ');
      if (parts.length !== 3) {
        await this.replyMessage(replyToken, '❌ 編集コマンドの形式が正しくありません。\n例: "edit 123 2500"');
        return;
      }

      const transactionId = parseInt(parts[1]);
      const newAmount = parseInt(parts[2]);
      
      if (isNaN(transactionId) || isNaN(newAmount) || newAmount <= 0) {
        await this.replyMessage(replyToken, '❌ 有効なIDと金額を入力してください。');
        return;
      }

      const updatedTransaction = await databaseService.editTransaction(userId, transactionId, newAmount);
      
      const message = `✅ 取引を編集しました\n\n` +
        `新しい金額: ${newAmount.toLocaleString()}円\n` +
        `内容: ${updatedTransaction.description}`;

      await this.replyMessage(replyToken, message);

      // 更新された予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
      }
    } catch (error) {
      console.error('Edit command error:', error);
      if (error instanceof Error && error.message === 'Transaction not found') {
        await this.replyMessage(replyToken, '❌ 指定された取引が見つかりません。');
      } else {
        await this.replyMessage(replyToken, '❌ 取引の編集中にエラーが発生しました。');
      }
    }
  }

  private async handleTransactionDeleteConfirm(replyToken: string, userId: string, transactionId: string): Promise<void> {
    try {
      const transactionIdNum = parseInt(transactionId);
      if (isNaN(transactionIdNum)) {
        await this.replyMessage(replyToken, '❌ 無効な取引IDです。');
        return;
      }

      const result = await databaseService.deleteTransaction(userId, transactionIdNum);
      
      const message = `✅ 取引を削除しました\n\n` +
        `削除された金額: ${result.deletedAmount.toLocaleString()}円`;

      await this.replyMessage(replyToken, message);

      // 更新された予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
      }
    } catch (error) {
      console.error('Delete confirm error:', error);
      if (error instanceof Error && error.message === 'Transaction not found') {
        await this.replyMessage(replyToken, '❌ 指定された取引が見つかりません。');
      } else {
        await this.replyMessage(replyToken, '❌ 取引の削除中にエラーが発生しました。');
      }
    }
  }
}