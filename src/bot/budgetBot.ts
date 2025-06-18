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
      await this.replyMessage(
        replyToken,
        `✅ 月間予算を ${amount.toLocaleString()}円に設定しました！`
      );
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

      const progressBar = this.createProgressBar(stats.budgetUsagePercentage);
      const statusEmoji = stats.budgetUsagePercentage > 100 ? '🚨' : 
                         stats.budgetUsagePercentage > 80 ? '⚠️' : '✅';

      const message = `${statusEmoji} 予算状況\n\n` +
        `💰 月間予算: ${stats.monthlyBudget.toLocaleString()}円\n` +
        `💸 使用済み: ${stats.currentSpent.toLocaleString()}円\n` +
        `💵 残り予算: ${stats.remainingBudget.toLocaleString()}円\n\n` +
        `${progressBar} ${stats.budgetUsagePercentage.toFixed(1)}%`;

      await this.replyMessage(replyToken, message);
    } catch (error) {
      console.error('Budget status error:', error);
      await this.replyMessage(replyToken, '❌ 予算状況の取得中にエラーが発生しました。');
    }
  }

  private async handleTransactionHistory(replyToken: string, userId: string): Promise<void> {
    try {
      const transactions = await databaseService.getRecentTransactions(userId, 5);
      
      if (transactions.length === 0) {
        await this.replyMessage(replyToken, '📝 まだ支出の履歴がありません。');
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

      await this.replyMessage(replyToken, message);
    } catch (error) {
      console.error('Transaction history error:', error);
      await this.replyMessage(replyToken, '❌ 履歴の取得中にエラーが発生しました。');
    }
  }

  private async handleBudgetReset(replyToken: string, userId: string): Promise<void> {
    try {
      await databaseService.resetMonthlyBudget(userId);
      await this.replyMessage(
        replyToken,
        '🔄 月間予算をリセットしました！\n使用済み金額が0円になりました。'
      );
    } catch (error) {
      console.error('Budget reset error:', error);
      await this.replyMessage(replyToken, '❌ 予算リセット中にエラーが発生しました。');
    }
  }

  private async handleHelp(replyToken: string): Promise<void> {
    const helpMessage = `📖 予算管理BOTの使い方\n\n` +
      `💰 予算設定:\n"予算設定 50000" で月間予算を設定\n\n` +
      `📊 予算確認:\n"予算確認" で現在の状況を表示\n\n` +
      `📷 支出記録:\nレシートの写真を送信すると自動で金額を読み取り\n\n` +
      `✏️ 手動入力:\n"1500" のように金額を入力\n\n` +
      `📝 履歴確認:\n"履歴" で最近の支出を表示\n\n` +
      `🔄 リセット:\n"リセット" で月間予算をリセット\n\n` +
      `❓ ヘルプ:\n"ヘルプ" でこのメッセージを表示`;

    await this.replyMessage(replyToken, helpMessage);
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
        `📝 内容: ${description}\n\n` +
        `💰 残り予算: ${stats.remainingBudget.toLocaleString()}円\n` +
        `📊 使用率: ${stats.budgetUsagePercentage.toFixed(1)}%`;

      await this.replyMessage(replyToken, message);
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

  private async processReceiptAmounts(userId: string, amounts: ParsedAmount[], storeName: string | null): Promise<void> {
    try {
      // 最大の金額を選択（通常は合計金額）
      const mainAmount = amounts[0];
      
      // 日本円に変換
      const conversionResult = await CurrencyService.convertToJPY(
        mainAmount.amount, 
        mainAmount.currency.code
      );
      
      // 変換後の金額を追加
      mainAmount.convertedAmount = conversionResult.convertedAmount;
      
      // 確認メッセージを作成
      let confirmMessage = '📋 以下の内容で支出を記録しますか？\n\n';
      
      if (mainAmount.currency.code === 'JPY') {
        confirmMessage += `💰 金額: ${mainAmount.amount.toLocaleString()}円\n`;
      } else {
        confirmMessage += `💰 元の金額: ${mainAmount.amount.toLocaleString()} ${mainAmount.currency.code}\n`;
        confirmMessage += `💱 日本円: ${conversionResult.convertedAmount.toLocaleString()}円\n`;
        confirmMessage += `📊 レート: 1 ${mainAmount.currency.code} = ${conversionResult.rate.toFixed(4)} JPY\n`;
        confirmMessage += `${conversionResult.isRealTime ? '🔄 リアルタイムレート' : '⚠️ 固定レート'}\n`;
      }
      
      if (storeName) {
        confirmMessage += `🏪 店舗: ${storeName}\n`;
      }
      
      confirmMessage += '\n✅ 記録する場合は「はい」\n❌ キャンセルする場合は「いいえ」\nと返信してください。';
      
      // 保留中取引として保存
      this.pendingTransactions.set(userId, {
        userId,
        parsedAmounts: [mainAmount],
        storeName,
        timestamp: Date.now()
      });
      
      await this.pushMessage(userId, confirmMessage);
      
    } catch (error) {
      console.error('Process receipt amounts error:', error);
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
        `📝 内容: ${description}\n\n` +
        `💰 残り予算: ${stats.remainingBudget.toLocaleString()}円\n` +
        `📊 使用率: ${stats.budgetUsagePercentage.toFixed(1)}%`;

      await this.pushMessage(userId, message);
    } catch (error) {
      console.error('Add expense with push error:', error);
      await this.pushMessage(userId, '❌ 支出の記録中にエラーが発生しました。');
    }
  }
}