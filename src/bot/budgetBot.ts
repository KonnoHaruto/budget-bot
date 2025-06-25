import { WebhookEvent, MessageEvent, PostbackEvent, FollowEvent, UnfollowEvent, Client } from '@line/bot-sdk';
import { ServiceFactory } from '../shared/utils/DependencyInjection';
import { LineMessageClient } from '../infra/line/LineMessageClient';
import { TaskQueueClient } from '../infra/cloudTasks/TaskQueueClient';
import { SetBudget } from '../usecases/SetBudget';
import { GetBudgetStatus } from '../usecases/GetBudgetStatus';
import { AddExpense } from '../usecases/AddExpense';
import { logger } from '../shared/utils/Logger';
import { ErrorHandler } from '../shared/utils/ErrorHandler';
import { Validator } from '../shared/utils/Validator';
import { FlexMessageTemplates } from '../interface/views/FlexMessageTemplates';

/**
 * 新しいクリーンアーキテクチャベースのBudgetBot
 */
export class BudgetBot {
  private lineClient: LineMessageClient;
  private taskQueue: TaskQueueClient;
  private setBudgetUseCase: SetBudget;
  private getBudgetStatusUseCase: GetBudgetStatus;
  private addExpenseUseCase: AddExpense;

  constructor() {
    this.lineClient = ServiceFactory.createLineMessageClient();
    this.taskQueue = ServiceFactory.createTaskQueueClient();
    this.setBudgetUseCase = ServiceFactory.createSetBudgetUseCase();
    this.getBudgetStatusUseCase = ServiceFactory.createGetBudgetStatusUseCase();
    this.addExpenseUseCase = ServiceFactory.createAddExpenseUseCase();
  }

  /**
   * リッチメニューの初期化
   */
  async initializeRichMenu(): Promise<void> {
    try {
      // リッチメニューの初期化処理
      logger.info('Rich menu initialization skipped in V2 (implement if needed)');
    } catch (error) {
      logger.error('Failed to initialize rich menu', error as Error);
    }
  }

  /**
   * メッセージイベント処理
   */
  async handleMessageEvent(event: MessageEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId) {
      logger.warn('Message event without userId', { event });
      return;
    }

    try {
      if (event.message.type === 'image') {
        await this.handleImageMessage(event, userId);
      } else if (event.message.type === 'text') {
        await this.handleTextMessage(event, userId);
      }
    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId, messageType: event.message.type });
      
      await this.lineClient.replyMessage(
        event.replyToken,
        'エラーが発生しました。しばらく時間をおいてから再度お試しください。'
      );
    }
  }

  /**
   * 画像メッセージ処理（レシート）
   */
  private async handleImageMessage(event: MessageEvent, userId: string): Promise<void> {
    logger.info('Processing image message', { userId, messageId: event.message.id });

    try {
      // Cloud Tasksにレシート処理タスクをエンキュー
      await this.taskQueue.enqueueReceiptProcessingTask({
        messageId: event.message.id,
        userId,
        imageUrl: `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
        replyToken: event.replyToken
      });

      // 処理中メッセージを送信
      await this.lineClient.replyMessage(
        event.replyToken,
        '📸 レシートを解析中です。少々お待ちください...'
      );

    } catch (error) {
      logger.error('Failed to enqueue receipt processing task', error as Error, { userId });
      await this.lineClient.replyMessage(
        event.replyToken,
        'レシートの処理でエラーが発生しました。'
      );
    }
  }

  /**
   * テキストメッセージ処理
   */
  private async handleTextMessage(event: MessageEvent, userId: string): Promise<void> {
    const text = (event.message as any).text?.trim();
    if (!text) return;

    logger.info('Processing text message', { userId, text });

    try {
      // コマンド解析と処理
      if (text.startsWith('予算設定')) {
        await this.handleBudgetSetting(event, userId, text);
      } else if (text === '予算状況' || text === '残高') {
        await this.handleBudgetStatus(event, userId);
      } else if (text === '履歴' || text === '取引履歴') {
        await this.handleTransactionHistory(event, userId);
      } else if (text.startsWith('支出')) {
        await this.handleManualExpense(event, userId, text);
      } else if (text === 'ヘルプ' || text === 'help') {
        await this.handleHelp(event);
      } else if (text === 'はい' || text === 'いいえ') {
        await this.handleConfirmation(event, userId, text);
      } else {
        await this.handleUnknownCommand(event);
      }
    } catch (error) {
      logger.error('Error handling text message', error as Error, { userId, text });
      await this.lineClient.replyMessage(
        event.replyToken,
        'コマンドの処理でエラーが発生しました。'
      );
    }
  }

  /**
   * 予算設定処理
   */
  private async handleBudgetSetting(event: MessageEvent, userId: string, text: string): Promise<void> {
    const match = text.match(/予算設定\s+(\d+)/);
    
    if (!match) {
      await this.lineClient.replyMessage(
        event.replyToken,
        '予算設定の形式：「予算設定 50000」のように金額を指定してください。'
      );
      return;
    }

    const amount = parseInt(match[1]);
    
    try {
      // バリデーション
      const validatedInput = Validator.budgetInput({
        userId,
        amount,
        currency: 'JPY'
      });

      // 予算設定実行
      const user = await this.setBudgetUseCase.execute(validatedInput);

      await this.lineClient.replyMessage(
        event.replyToken,
        `✅ 月間予算を${user.monthlyBudget?.toString()}に設定しました！`
      );

      logger.info('Budget set successfully', { userId, amount });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId, amount });
      await this.lineClient.replyMessage(
        event.replyToken,
        errorInfo.message
      );
    }
  }

  /**
   * 予算状況表示
   */
  private async handleBudgetStatus(event: MessageEvent, userId: string): Promise<void> {
    try {
      const budgetStatus = await this.getBudgetStatusUseCase.execute(userId);
      
      // Flex Messageで予算状況を送信
      const flexMessage = FlexMessageTemplates.createBudgetStatusCard(budgetStatus);
      await this.lineClient.sendFlexMessage(event.source.userId!, flexMessage);

      logger.info('Budget status sent', { userId, usagePercentage: budgetStatus.usagePercentage });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId });
      await this.lineClient.replyMessage(
        event.replyToken,
        errorInfo.message
      );
    }
  }

  /**
   * 取引履歴表示
   */
  private async handleTransactionHistory(event: MessageEvent, userId: string): Promise<void> {
    try {
      const transactions = await this.addExpenseUseCase.getUserExpenses(userId);
      
      // Flex Messageで取引履歴を送信
      const flexMessage = FlexMessageTemplates.createTransactionHistoryCarousel(transactions);
      await this.lineClient.sendFlexMessage(event.source.userId!, flexMessage);

      logger.info('Transaction history sent', { userId, transactionCount: transactions.length });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId });
      await this.lineClient.replyMessage(
        event.replyToken,
        errorInfo.message
      );
    }
  }

  /**
   * 手動支出入力処理
   */
  private async handleManualExpense(event: MessageEvent, userId: string, text: string): Promise<void> {
    const match = text.match(/支出\s+(\d+)\s+(.+)/);
    
    if (!match) {
      await this.lineClient.replyMessage(
        event.replyToken,
        '支出入力の形式：「支出 1000 ランチ」のように金額と内容を指定してください。'
      );
      return;
    }

    const amount = parseInt(match[1]);
    const description = match[2];

    try {
      // バリデーション
      const validatedInput = Validator.expenseInput({
        userId,
        amount,
        description,
        currency: 'JPY'
      });

      // 支出追加実行
      const transaction = await this.addExpenseUseCase.execute(validatedInput);

      // 予算アラートをチェック
      const alertInfo = await this.getBudgetStatusUseCase.shouldSendAlert(userId);
      if (alertInfo.shouldAlert && alertInfo.alertType) {
        await this.taskQueue.enqueueBudgetAlertTask({
          userId,
          alertType: alertInfo.alertType,
          message: alertInfo.message
        });
      }

      await this.lineClient.replyMessage(
        event.replyToken,
        `✅ 支出を追加しました：${transaction.toString()}`
      );

      logger.info('Manual expense added', { userId, amount, description });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId, amount, description });
      await this.lineClient.replyMessage(
        event.replyToken,
        errorInfo.message
      );
    }
  }

  /**
   * ヘルプ表示
   */
  private async handleHelp(event: MessageEvent): Promise<void> {
    const helpText = `
🤖 LINE家計簿ボットの使い方

📊 基本コマンド：
• 予算設定 [金額] - 月間予算を設定
• 予算状況 or 残高 - 現在の予算状況を表示
• 履歴 or 取引履歴 - 取引履歴を表示
• 支出 [金額] [内容] - 手動で支出を追加

📸 レシート機能：
• レシートの写真を送信すると自動で金額を読み取り

💡 その他：
• ヘルプ - このメッセージを表示
    `;

    await this.lineClient.replyMessage(event.replyToken, helpText);
  }

  /**
   * 確認応答処理
   */
  private async handleConfirmation(event: MessageEvent, userId: string, text: string): Promise<void> {
    // 簡略化のため基本的な応答のみ
    if (text === 'はい') {
      await this.lineClient.replyMessage(
        event.replyToken,
        '✅ 承認されました。'
      );
    } else {
      await this.lineClient.replyMessage(
        event.replyToken,
        '❌ キャンセルされました。'
      );
    }
  }

  /**
   * 不明なコマンド処理
   */
  private async handleUnknownCommand(event: MessageEvent): Promise<void> {
    await this.lineClient.replyMessage(
      event.replyToken,
      '申し訳ございませんが、そのコマンドは認識できません。「ヘルプ」と入力してコマンド一覧をご確認ください。'
    );
  }

  /**
   * フォローイベント処理
   */
  async handleFollowEvent(event: FollowEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId) return;

    const welcomeMessage = `
🎉 LINE家計簿ボットへようこそ！

このボットでできること：
📸 レシートの写真で自動支出記録
💰 月間予算の設定と管理
📊 支出状況のリアルタイム確認
📝 取引履歴の確認

まずは「予算設定 50000」のように月間予算を設定してみてください！

「ヘルプ」でいつでもコマンド一覧を確認できます。
    `;

    try {
      await this.lineClient.sendTextMessage(userId, welcomeMessage);
      logger.info('Welcome message sent', { userId });
    } catch (error) {
      logger.error('Failed to send welcome message', error as Error, { userId });
    }
  }

  /**
   * アンフォローイベント処理
   */
  async handleUnfollowEvent(event: UnfollowEvent): Promise<void> {
    const userId = event.source.userId;
    if (userId) {
      logger.info('User unfollowed', { userId });
      // 必要に応じてユーザーデータのクリーンアップ
    }
  }

  /**
   * ポストバックイベント処理
   */
  async handlePostbackEvent(event: PostbackEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId) return;

    const data = event.postback.data;
    logger.info('Postback event received', { userId, data });

    try {
      // ポストバックデータに応じた処理
      if (data.startsWith('budget_')) {
        await this.handleBudgetPostback(event, userId, data);
      } else if (data.startsWith('transaction_')) {
        await this.handleTransactionPostback(event, userId, data);
      }
    } catch (error) {
      logger.error('Error handling postback', error as Error, { userId, data });
    }
  }

  /**
   * 予算関連ポストバック処理
   */
  private async handleBudgetPostback(event: PostbackEvent, userId: string, data: string): Promise<void> {
    // 予算関連のポストバック処理実装
    await this.lineClient.replyMessage(
      event.replyToken,
      '予算関連の操作を処理中です...'
    );
  }

  /**
   * 取引関連ポストバック処理
   */
  private async handleTransactionPostback(event: PostbackEvent, userId: string, data: string): Promise<void> {
    // 取引関連のポストバック処理実装
    await this.lineClient.replyMessage(
      event.replyToken,
      '取引関連の操作を処理中です...'
    );
  }
}