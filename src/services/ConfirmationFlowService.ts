import { ParsedAmount } from './currencyService';
import { tokenManager } from './TokenManager';
import { getMessageClient } from './MessageClient';

/**
 * 保留中取引の情報
 */
export interface PendingTransactionData {
  userId: string;
  parsedAmounts: ParsedAmount[];
  storeName: string | null;
  timestamp: number;
}

/**
 * 確認フローサービス
 * レシート確認、支出確認などの共通フローを管理
 */
export class ConfirmationFlowService {
  private budgetBot: any; // BudgetBotの参照（循環依存を避けるため any）

  constructor(budgetBot: any) {
    this.budgetBot = budgetBot;
  }

  /**
   * レシート確認フローの完全な処理
   * トークン生成 → 保留中取引保存 → 確認カード送信（フォールバック付き）
   */
  async createAndSendReceiptConfirmation(
    userId: string,
    replyToken: string | undefined,
    mainAmount: ParsedAmount,
    conversionResult: { convertedAmount: number; rate?: number },
    storeName?: string
  ): Promise<void> {
    try {
      // 1. トークン生成
      const token = await tokenManager.generateExpenseToken(userId);
      console.log(`🔐 Generated expense token: ${token}`);

      // 2. 保留中取引として保存
      const pendingData: PendingTransactionData = {
        userId,
        parsedAmounts: [mainAmount],
        storeName: storeName || null,
        timestamp: Date.now()
      };
      
      await this.budgetBot.savePendingTransaction(userId, pendingData);
      console.log(`💾 Pending transaction saved for user: ${userId}`);

      // 3. 確認カード作成
      const confirmationCard = this.budgetBot.createReceiptConfirmationCard(
        conversionResult.convertedAmount,
        mainAmount.currency.code !== 'JPY' ? mainAmount.amount : undefined,
        mainAmount.currency.code !== 'JPY' ? mainAmount.currency.code : undefined,
        mainAmount.currency.code !== 'JPY' ? conversionResult.rate : undefined,
        storeName,
        token
      );

      // 4. フォールバック付きでメッセージ送信
      await this.sendConfirmationWithFallback(
        userId,
        replyToken,
        '💰 支出確認',
        confirmationCard,
        storeName,
        conversionResult.convertedAmount
      );

    } catch (error) {
      console.error('❌ Failed to create receipt confirmation:', error);
      throw error;
    }
  }

  /**
   * 手動入力確認フローの処理
   */
  async createAndSendManualConfirmation(
    userId: string,
    replyToken: string,
    amount: number,
    description: string
  ): Promise<void> {
    try {
      // 1. トークン生成
      const token = await tokenManager.generateExpenseToken(userId);

      // 2. ParsedAmountオブジェクト作成（手動入力の場合）
      const manualAmount: ParsedAmount = {
        amount: amount,
        currency: { code: 'JPY', symbol: '¥', name: '日本円' },
        originalText: `${amount}円`,
        convertedAmount: amount // JPYなので変換不要
      };

      // 3. 保留中取引として保存
      const pendingData: PendingTransactionData = {
        userId,
        parsedAmounts: [manualAmount],
        storeName: null,
        timestamp: Date.now()
      };

      await this.budgetBot.savePendingTransaction(userId, pendingData);

      // 4. 確認カード作成（手動入力用）
      const confirmationCard = this.budgetBot.createReceiptConfirmationCard(
        amount,
        undefined,
        undefined,
        undefined,
        description,
        token
      );

      // 5. メッセージ送信
      const messageClient = getMessageClient();
      await messageClient.replyFlexMessage(replyToken, '💰 支出確認', confirmationCard, userId);

    } catch (error) {
      console.error('❌ Failed to create manual confirmation:', error);
      throw error;
    }
  }

  /**
   * 確認メッセージ送信（フォールバック付き）
   * Reply → Push Flex → Push Text の順でフォールバック
   */
  private async sendConfirmationWithFallback(
    userId: string,
    replyToken: string | undefined,
    title: string,
    confirmationCard: any,
    storeName?: string,
    convertedAmount?: number
  ): Promise<void> {
    const messageClient = getMessageClient();

    try {
      // 1. Reply Flex Message を試行
      if (replyToken) {
        console.log(`📤 Sending confirmation flex message via reply...`);
        await messageClient.replyFlexMessage(replyToken, title, confirmationCard, userId);
        console.log(`✅ Confirmation sent via reply message successfully`);
        return;
      }
    } catch (replyError: any) {
      console.error(`❌ Reply flex message failed:`, replyError);
      
      // 2. Push Flex Message にフォールバック
      try {
        console.log(`🔄 Falling back to push flex message...`);
        await messageClient.pushFlexMessage(userId, title, confirmationCard);
        console.log(`✅ Confirmation sent via push flex message (fallback)`);
        return;
      } catch (pushError: any) {
        console.error(`❌ Push flex message failed:`, pushError);
      }
    }

    // 3. Push Text Message にフォールバック（最終手段）
    try {
      console.log(`🔄 Falling back to push text message...`);
      const fallbackText = this.createFallbackText(storeName, convertedAmount);
      await messageClient.pushMessage(userId, fallbackText);
      console.log(`✅ Confirmation sent via push text message (final fallback)`);
    } catch (textError: any) {
      console.error(`❌ Push text message failed:`, textError);
      throw new Error('All message sending methods failed');
    }
  }

  /**
   * フォールバック用のテキストメッセージ作成
   */
  private createFallbackText(storeName?: string, amount?: number): string {
    let text = '💰 支出を確認してください\n\n';
    
    if (amount) {
      text += `金額: ¥${amount.toLocaleString()}\n`;
    }
    
    if (storeName) {
      text += `店舗: ${storeName}\n`;
    }
    
    text += '\n「はい」または「いいえ」で回答してください。';
    
    return text;
  }

  /**
   * 確認応答の処理
   */
  async handleConfirmationResponse(
    userId: string,
    replyToken: string,
    confirmed: boolean
  ): Promise<void> {
    const pending = this.budgetBot.getPendingTransaction(userId);
    
    if (!pending) {
      const messageClient = getMessageClient();
      await messageClient.replyMessage(replyToken, '⚠️ 確認待ちの取引がありません。', userId);
      return;
    }

    // 保留中の取引を削除
    this.budgetBot.removePendingTransaction(userId);

    if (confirmed) {
      // 支出として記録
      const mainAmount = pending.parsedAmounts[0];
      const jpyAmount = mainAmount.convertedAmount || mainAmount.amount;
      const description = pending.storeName || 'レシート';
      
      await this.budgetBot.addExpense(replyToken, userId, jpyAmount, description);
    } else {
      // キャンセル
      const messageClient = getMessageClient();
      await messageClient.replyMessage(replyToken, '❌ 支出の記録をキャンセルしました。', userId);
    }
  }

  /**
   * デバッグ用：保留中の確認フローの状態を表示
   */
  logConfirmationState(userId: string): void {
    const pending = this.budgetBot.getPendingTransaction?.(userId);
    
    if (pending) {
      console.log(`🔍 Pending confirmation for user ${userId}:`, {
        amounts: pending.parsedAmounts.length,
        storeName: pending.storeName,
        timestamp: new Date(pending.timestamp).toISOString()
      });
    } else {
      console.log(`🔍 No pending confirmation for user ${userId}`);
    }
  }
}