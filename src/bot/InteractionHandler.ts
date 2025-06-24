import * as line from '@line/bot-sdk';
import { BudgetBot } from './budgetBot';
import { BUDGET_QUICK_REPLY_MIN } from '../config';

export class InteractionHandler {
  private budgetBot: BudgetBot;

  constructor(budgetBot: BudgetBot) {
    this.budgetBot = budgetBot;
  }

  /**
   * LINE Webhookイベントを処理
   */
  async handle(event: line.WebhookEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'message':
          await this.handleMessage(event);
          break;
        case 'postback':
          await this.handlePostback(event);
          break;
        case 'follow':
          await this.handleFollow(event);
          break;
        case 'unfollow':
          await this.handleUnfollow(event);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Error handling interaction:', error);
    }
  }

  /**
   * メッセージイベントを処理
   */
  async handleMessage(event: line.MessageEvent): Promise<void> {
    const { replyToken, source } = event;
    const userId = source.userId;

    if (!userId) return;

    // Ensure user exists in database
    await this.budgetBot.ensureUserExists(userId);

    switch (event.message.type) {
      case 'text':
        await this.handleTextMessage(replyToken, userId, event.message.text);
        break;
      case 'image':
        await this.handleImageMessage(replyToken, userId, event.message.id);
        break;
      default:
        await this.budgetBot.replyMessage(replyToken, 'テキストメッセージまたは画像を送信してください。', userId);
    }
  }

  /**
   * ポストバックイベントを処理
   */
  async handlePostback(event: line.PostbackEvent): Promise<void> {
    const { replyToken, source, postback } = event;
    const userId = source.userId;

    if (!userId) return;

    const data = postback.data;
    
    if (data.startsWith('confirm_delete_')) {
      const token = data.replace('confirm_delete_', '');
      await this.budgetBot.handleTransactionDeleteConfirm(replyToken, userId, token);
    } else if (data.startsWith('cancel_delete_')) {
      const token = data.replace('cancel_delete_', '');
      await this.budgetBot.handleDeleteCancel(replyToken, token);
    } else if (data.startsWith('confirm_edit_')) {
      const token = data.replace('confirm_edit_', '');
      await this.budgetBot.handleEditConfirm(replyToken, userId, token);
    } else if (data.startsWith('cancel_edit_')) {
      const token = data.replace('cancel_edit_', '');
      await this.budgetBot.handleEditCancel(replyToken, token);
    } else if (data.startsWith('confirm_reset_')) {
      const token = data.replace('confirm_reset_', '');
      await this.budgetBot.handleResetConfirm(replyToken, userId, token);
    } else if (data.startsWith('cancel_reset_')) {
      const token = data.replace('cancel_reset_', '');
      await this.budgetBot.handleResetCancel(replyToken, token);
    } else if (data.startsWith('confirm_expense_')) {
      const token = data.replace('confirm_expense_', '');
      await this.budgetBot.handleExpenseConfirm(replyToken, userId, token);
    } else if (data.startsWith('cancel_expense_')) {
      const token = data.replace('cancel_expense_', '');
      await this.budgetBot.handleExpenseCancel(replyToken, token);
    } else if (data.startsWith('menu_')) {
      await this.budgetBot.handleMenuAction(replyToken, userId, data);
    } else if (data.startsWith('edit_transaction_')) {
      const transactionId = data.replace('edit_transaction_', '');
      await this.budgetBot.handleTransactionEdit(replyToken, userId, transactionId);
    } else if (data.startsWith('delete_transaction_')) {
      const transactionId = data.replace('delete_transaction_', '');
      await this.budgetBot.handleTransactionDelete(replyToken, userId, transactionId);
    } else if (data === 'receipt_edit') {
      await this.budgetBot.handleReceiptEdit(replyToken, userId);
    } else if (data === 'cancel_edit' || data === 'cancel_delete') {
      await this.budgetBot.replyMessage(replyToken, '❌ 操作をキャンセルしました。', userId);
    }
  }

  /**
   * フォローイベントを処理
   */
  async handleFollow(event: line.FollowEvent): Promise<void> {
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    
    if (!userId) {
      console.log('⚠️ Follow event received but no userId found');
      return;
    }

    console.log(`👤 New user followed: ${userId}`);
    
    try {
      // ユーザーをデータベースに登録
      await this.budgetBot.ensureUserExists(userId);
      console.log(`✅ User ${userId} registered in database`);

      // ウェルカムメッセージを送信（Reply Messageとして）
      console.log(`📧 Calling sendWelcomeMessage for user: ${userId} with replyToken: ${replyToken}`);
      await this.budgetBot.sendWelcomeMessage(userId, replyToken);
      console.log(`✅ handleFollow completed for user: ${userId}`);
      
    } catch (error) {
      console.error(`❌ Error in handleFollow for user ${userId}:`, error);
    }
  }

  /**
   * アンフォローイベントを処理
   */
  async handleUnfollow(event: line.UnfollowEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId) return;

    console.log(`👋 User unfollowed: ${userId}`);
    // アンフォロー時の処理（必要に応じて）
  }

  /**
   * テキストメッセージを処理
   */
  private async handleTextMessage(replyToken: string, userId: string, text: string): Promise<void> {
    const command = text.toLowerCase().trim();

    // 編集待機状態のチェック
    const pendingEdit = this.budgetBot.getPendingEdit(userId);
    if (pendingEdit) {
      const amount = this.budgetBot.parseAmount(text);
      if (amount > 0) {
        await this.budgetBot.handleDirectEditAmount(replyToken, userId, pendingEdit.transactionId, amount);
        this.budgetBot.removePendingEdit(userId);
        return;
      } else {
        await this.budgetBot.replyMessage(replyToken, '❌ 正しい金額を入力してください。例: "2500"', userId);
        return;
      }
    }

    // 確認応答のチェック
    if (command === 'はい' || command === 'yes' || command === 'ok' || command === '確定') {
      await this.budgetBot.handleConfirmation(replyToken, userId, true);
      return;
    } else if (command === 'いいえ' || command === 'no' || command === 'キャンセル') {
      await this.budgetBot.handleConfirmation(replyToken, userId, false);
      return;
    }

    // リッチメニューからのメッセージ処理
    if (command === '予算設定') {
      await this.budgetBot.handleBudgetSetInstruction(replyToken, userId);
    } else if (command === '今日の残高') {
      await this.budgetBot.handleTodayBalance(replyToken, userId);
    } else if (command === '履歴') {
      await this.budgetBot.handleHistory(replyToken, userId);
    } else if (command === 'レポート') {
      await this.budgetBot.handleReport(replyToken, userId);
    } else if (command === 'ヘルプ') {
      await this.budgetBot.handleHelp(replyToken);
    } else if (command.startsWith('予算設定') || command.startsWith('budget set')) {
      await this.budgetBot.handleBudgetSet(replyToken, userId, text);
    } else if (command === '予算確認' || command === 'budget' || command === 'status') {
      await this.budgetBot.handleBudgetStatus(replyToken, userId);
    } else if (command === 'リセット' || command === 'reset') {
      await this.budgetBot.handleBudgetReset(replyToken, userId);
    } else if (text.startsWith('edit ')) {
      // 取引編集コマンド: "edit transactionId newAmount"
      await this.budgetBot.handleEditCommand(replyToken, userId, text);
    } else {
      // Check if user is in budget setting mode
      const pendingBudget = this.budgetBot.getPendingBudgetSet(userId);
      if (pendingBudget && this.budgetBot.isPendingBudgetValid(pendingBudget)) {
        const amount = this.budgetBot.parseAmount(text);
        if (amount > 0) {
          // Process as budget setting
          this.budgetBot.removePendingBudgetSet(userId);
          await this.budgetBot.handleBudgetSet(replyToken, userId, amount.toString());
          return;
        } else {
          await this.budgetBot.replyMessage(replyToken, '❌ 有効な金額を入力してください。数字のみで入力してください。\n例: ' + BUDGET_QUICK_REPLY_MIN);
          return;
        }
      }
      
      // Try to parse as manual expense entry
      const amount = this.budgetBot.parseAmount(text);
      if (amount > 0) {
        await this.budgetBot.handleManualExpenseConfirmation(replyToken, userId, amount, `手動入力: ${text}`);
      } else {
        await this.budgetBot.handleHelp(replyToken);
      }
    }
  }

  /**
   * 画像メッセージを処理
   */
  private async handleImageMessage(replyToken: string, userId: string, messageId: string): Promise<void> {
    try {
      // Send processing started message immediately
      await this.budgetBot.replyMessage(replyToken, '処理を開始しました。', userId);
      console.log(`🚀 Processing started message sent for user: ${userId}`);

      // ハイブリッド処理: webhook内で時間制限付き処理を試行
      const success = await this.budgetBot.tryProcessReceiptWithTimeout(userId, messageId, replyToken);
      
      if (!success) {
        // 時間制限内に完了しなかった場合、Cloud Tasksにフォールバック
        console.log(`⏰ Processing timeout, falling back to Cloud Tasks for user: ${userId}`);
        await this.budgetBot.enqueueReceiptProcessing({
          userId,
          messageId,
          replyToken
        });
        console.log(`📝 Receipt processing task enqueued for user: ${userId}, messageId: ${messageId}`);
      }

    } catch (error) {
      console.error(`❌ Image processing error for user ${userId}:`, error);
      
      let errorMessage = '❌ 処理の開始に失敗しました。手動で金額を入力してください。\n例: "1500" または "1500円"';
      
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          errorMessage = '⏰ 処理がタイムアウトしました。バックグラウンドで再試行しています...';
        } else if (error.message.includes('network')) {
          errorMessage = '🌐 ネットワークエラーが発生しました。しばらく待ってから再試行してください。';
        }
      }
      
      await this.budgetBot.replyMessage(replyToken, errorMessage, userId);
    }
  }
}