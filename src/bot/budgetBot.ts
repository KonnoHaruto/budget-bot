import * as line from '@line/bot-sdk';
import { databaseService } from '../database/prisma';
import { ocrService } from '../services/ocrService';
import { CurrencyService, ParsedAmount } from '../services/currencyService';
import { chartService, ChartData } from '../services/chartService';
import { RichMenuService } from '../services/richMenuService';
import { cloudTasksService } from '../services/cloudTasksService';
import { tokenManager } from '../services/TokenManager';
import { initializeMessageClient, getMessageClient } from '../services/MessageClient';
import { InteractionHandler } from './InteractionHandler';
import { receiptProcessingService } from '../services/ReceiptProcessingService';
import { ConfirmationFlowService } from '../services/ConfirmationFlowService';
import { 
  LIGHT_TIMEOUT_MS, 
  FULL_TIMEOUT_MS,
  BUDGET_QUICK_REPLY_MIN,
  BUDGET_QUICK_REPLY_MAX,
  BUDGET_QUICK_REPLY_STEP,
  BUDGET_INSTRUCTION_MIN,
  BUDGET_INSTRUCTION_MAX,
  BUDGET_INSTRUCTION_STEP,
  PENDING_BUDGET_TIMEOUT_MS,
  OCR_TEXT_PREVIEW_LENGTH,
  OCR_TEXT_PREVIEW_LENGTH_FULL,
  REMAINING_TIME_THRESHOLD,
  RECENT_TRANSACTIONS_LIMIT,
  CHART_TRANSACTIONS_LIMIT,
  BUDGET_WARNING_THRESHOLD,
  BUDGET_DANGER_THRESHOLD,
  PROGRESS_BAR_TOTAL_DOTS,
  PROGRESS_BAR_MAX_WIDTH,
  WEEK_DAYS,
  MILLISECONDS_PER_DAY,
  HTTP_BAD_REQUEST,
  COLORS
} from '../config';
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

interface PendingBudgetSet {
  userId: string;
  timestamp: number;
}



export class BudgetBot {
  private client: line.messagingApi.MessagingApiClient;
  private blobClient: line.messagingApi.MessagingApiBlobClient;
  private richMenuService: RichMenuService;
  private interactionHandler: InteractionHandler;
  private confirmationFlowService: ConfirmationFlowService;
  private pendingTransactions: Map<string, PendingTransaction> = new Map();
  private pendingEdits: Map<string, PendingEdit> = new Map();
  private pendingBudgetSets: Map<string, PendingBudgetSet> = new Map();

  constructor() {
    const config = {
      channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
      channelSecret: process.env.CHANNEL_SECRET!
    };
    this.client = new line.messagingApi.MessagingApiClient(config);
    this.blobClient = new line.messagingApi.MessagingApiBlobClient(config);
    this.richMenuService = new RichMenuService(this.client);
    
    // MessageClientを初期化
    initializeMessageClient(this.client);
    
    // InteractionHandlerを初期化
    this.interactionHandler = new InteractionHandler(this);
    
    // ConfirmationFlowServiceを初期化
    this.confirmationFlowService = new ConfirmationFlowService(this);
  }

  async initializeRichMenu(): Promise<void> {
    try {
      await this.richMenuService.setupRichMenu();
      console.log('🎉 Rich menu initialized successfully');
    } catch (error) {
      console.error('❌ Rich menu initialization failed:', error);
    }
  }

  // 状態管理メソッド
  public getPendingEdit(userId: string): PendingEdit | undefined {
    return this.pendingEdits.get(userId);
  }

  public removePendingEdit(userId: string): void {
    this.pendingEdits.delete(userId);
  }

  public getPendingBudgetSet(userId: string): PendingBudgetSet | undefined {
    return this.pendingBudgetSets.get(userId);
  }

  public removePendingBudgetSet(userId: string): void {
    this.pendingBudgetSets.delete(userId);
  }

  public isPendingBudgetValid(pendingBudget: PendingBudgetSet): boolean {
    return (Date.now() - pendingBudget.timestamp) < PENDING_BUDGET_TIMEOUT_MS;
  }

  public async ensureUserExists(userId: string): Promise<void> {
    let user = await databaseService.getUser(userId);
    if (!user) {
      user = await databaseService.createUser(userId);
    }
  }

  public async enqueueReceiptProcessing(params: { userId: string; messageId: string; replyToken: string }): Promise<void> {
    await cloudTasksService.enqueueReceiptProcessing(params);
  }

  public getPendingTransaction(userId: string): PendingTransaction | undefined {
    return this.pendingTransactions.get(userId);
  }

  public removePendingTransaction(userId: string): void {
    this.pendingTransactions.delete(userId);
  }


  // Cloud Tasks用のパブリックメソッド
  public getBlobClient(): line.messagingApi.MessagingApiBlobClient {
    return this.blobClient;
  }

  public async generateExpenseToken(userId: string): Promise<string> {
    return await tokenManager.generateExpenseToken(userId);
  }

  public async savePendingTransaction(userId: string, transaction: PendingTransaction): Promise<void> {
    this.pendingTransactions.set(userId, transaction);
  }

  public async createConfirmationCard(
    amount: number, 
    originalAmount?: number, 
    currency?: string, 
    rate?: number, 
    storeName?: string,
    token?: string
  ): Promise<any> {
    return this.createReceiptConfirmationCard(amount, originalAmount, currency, rate, storeName, token);
  }


  // イベント処理をInteractionHandlerに委譲
  async handleMessage(event: line.MessageEvent): Promise<void> {
    await this.interactionHandler.handleMessage(event);
  }

  async handlePostback(event: line.PostbackEvent): Promise<void> {
    await this.interactionHandler.handlePostback(event);
  }

  async handleFollow(event: line.FollowEvent): Promise<void> {
    await this.interactionHandler.handleFollow(event);
  }

  async handleUnfollow(event: line.UnfollowEvent): Promise<void> {
    await this.interactionHandler.handleUnfollow(event);
  }

  public async sendWelcomeMessage(userId: string, replyToken?: string): Promise<void> {
    try {
      console.log(`📧 Sending welcome message to user: ${userId}`);
      
      // 予算設定待機状態に設定
      this.pendingBudgetSets.set(userId, {
        userId,
        timestamp: Date.now()
      });
      console.log(`⏰ Set pending budget state for user: ${userId}`);

      // Flex Messageでウェルカムメッセージを作成
      const welcomeCard = this.createWelcomeBudgetCard();
      
      // Quick Replyオプションを作成
      const quickReplyItems = [];
      for (let amount = BUDGET_QUICK_REPLY_MIN; amount <= BUDGET_QUICK_REPLY_MAX; amount += BUDGET_QUICK_REPLY_STEP) {
        quickReplyItems.push({
          type: "action",
          action: {
            type: "message",
            label: `¥${amount.toLocaleString()}`,
            text: amount.toString()
          }
        });
      }

      const quickReply = {
        items: quickReplyItems
      };

      // Flex MessageとQuick Replyを組み合わせて送信
      const message = {
        type: "flex",
        altText: "🎉 予算管理ボットへようこそ！まずは月間予算を設定しましょう",
        contents: welcomeCard,
        quickReply: quickReply
      };

      if (replyToken) {
        // Reply Messageとして送信（無料）
        console.log(`📤 Sending welcome flex message as reply to ${userId}...`);
        const response = await this.client.replyMessage({
          replyToken,
          messages: [message as any]
        });
        console.log(`✅ Welcome reply message sent successfully:`, response);
      } else {
        // replyTokenが無い場合は送信しない（Push Message削除）
        console.log(`⚠️ No replyToken available for ${userId}, skipping welcome message to avoid push message charges`);
      }
      
      // ヒントメッセージは削除（Push Message課金を避けるため）
      // ユーザーは既にQuick Replyボタンがあるので、追加のヒントは不要
      
    } catch (error) {
      console.error(`❌ Failed to send welcome message to ${userId}:`, error);
      
      // フォールバックもReply Messageのみに限定
      try {
        if (replyToken) {
          await this.replyMessage(replyToken,
            '🎉 予算管理ボットへようこそ！\n\n' +
            'まずは月間予算を設定しましょう。\n' +
            '金額を数字で入力してください。\n\n' +
            '例: ' + BUDGET_QUICK_REPLY_MIN
          );
          console.log(`✅ Fallback welcome reply message sent to ${userId}`);
        } else {
          console.log(`⚠️ No replyToken for fallback message to ${userId}, skipping to avoid push message charges`);
        }
      } catch (fallbackError) {
        console.error(`❌ Failed to send fallback welcome message:`, fallbackError);
      }
    }
  }

  private createWelcomeBudgetCard(): any {
    return {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🎉 ようこそ！',
            weight: 'bold',
            color: '#ffffff',
            size: 'xl',
            align: 'center'
          },
          {
            type: 'text',
            text: '予算管理ボット',
            color: '#ffffff',
            size: 'md',
            align: 'center',
            margin: 'sm'
          }
        ],
        backgroundColor: '#1DB446',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'まずは月間予算を\n設定しましょう！',
            size: 'lg',
            weight: 'bold',
            align: 'center',
            color: '#333333'
          },
          {
            type: 'separator',
            margin: 'xl'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            spacing: 'md',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '💰',
                    flex: 0,
                    size: 'xl'
                  },
                  {
                    type: 'text',
                    text: '下のボタンから金額を選択',
                    flex: 1,
                    margin: 'md',
                    size: 'md',
                    color: '#666666'
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '✏️',
                    flex: 0,
                    size: 'xl'
                  },
                  {
                    type: 'text',
                    text: 'または直接金額を入力',
                    flex: 1,
                    margin: 'md',
                    size: 'md',
                    color: '#666666'
                  }
                ]
              }
            ]
          },
          {
            type: 'separator',
            margin: 'xl'
          },
          {
            type: 'text',
            text: '例: 50000 (5万円の場合)',
            size: 'sm',
            color: '#999999',
            align: 'center',
            margin: 'lg'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💡 設定後に使い方をご案内します',
            size: 'xs',
            color: '#1DB446',
            align: 'center'
          }
        ],
        paddingAll: '16px'
      }
    };
  }

  private async sendTutorialMessage(userId: string): Promise<void> {
    const tutorialCard = this.createTutorialFlexMessage();
    await this.pushFlexMessage(userId, '📚 使い方ガイド', tutorialCard);
  }

  private createTutorialFlexMessage(): any {
    return {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📚 使い方ガイド',
            weight: 'bold',
            size: 'xl',
            color: '#1DB446'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '💰',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: '支出を記録する',
                    size: 'sm',
                    color: '#555555',
                    flex: 1,
                    margin: 'sm'
                  }
                ]
              },
              {
                type: 'text',
                text: '金額を入力するか、レシート画像を送信',
                size: 'xs',
                color: '#aaaaaa',
                margin: 'sm'
              },
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '📊',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: '予算状況を確認する',
                    size: 'sm',
                    color: '#555555',
                    flex: 1,
                    margin: 'sm'
                  }
                ]
              },
              {
                type: 'text',
                text: '「予算」「残高」「状況」と入力',
                size: 'xs',
                color: '#aaaaaa',
                margin: 'sm'
              },
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '📝',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: '履歴を確認する',
                    size: 'sm',
                    color: '#555555',
                    flex: 1,
                    margin: 'sm'
                  }
                ]
              },
              {
                type: 'text',
                text: '「履歴」「取引履歴」と入力',
                size: 'xs',
                color: '#aaaaaa',
                margin: 'sm'
              },
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  {
                    type: 'text',
                    text: '🔄',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: '予算をリセットする',
                    size: 'sm',
                    color: '#555555',
                    flex: 1,
                    margin: 'sm'
                  }
                ]
              },
              {
                type: 'text',
                text: '「リセット」と入力',
                size: 'xs',
                color: '#aaaaaa',
                margin: 'sm'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'separator'
          },
          {
            type: 'text',
            text: '💡 レシート画像を送るだけで自動で金額を読み取ります！',
            size: 'xs',
            color: '#1DB446',
            margin: 'md',
            align: 'center'
          }
        ]
      }
    };
  }


  // 時間制限付きレシート処理メソッド（改善版）
  public async tryProcessReceiptWithTimeout(userId: string, messageId: string, replyToken: string): Promise<boolean> {
    const startTime = Date.now();
    
    // AbortControllerでキャンセル制御
    const abortController = new AbortController();
    
    try {
      console.log(`⏱️ Starting 2-stage receipt processing for user: ${userId}`);
      
      // ステージ1: 軽量OCR処理（1秒制限）
      console.log(`📸 Stage 1: Light OCR processing (${LIGHT_TIMEOUT_MS}ms timeout)...`);
      
      const lightResult = await Promise.race([
        this.tryLightOCRProcessing(userId, messageId, replyToken, abortController.signal),
        new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), LIGHT_TIMEOUT_MS);
        })
      ]);
      
      if (lightResult === 'success') {
        const elapsedTime = Date.now() - startTime;
        console.log(`✅ Receipt processed successfully in light mode within ${elapsedTime}ms`);
        return true;
      } else if (lightResult === 'timeout') {
        console.log(`⏰ Light OCR timed out after ${LIGHT_TIMEOUT_MS}ms, trying full processing...`);
      }
      
      // ステージ2: フル処理（残り時間での制限）
      const remainingTime = FULL_TIMEOUT_MS - (Date.now() - startTime);
      if (remainingTime <= REMAINING_TIME_THRESHOLD) {
        console.log(`⏰ Insufficient time remaining (${remainingTime}ms), falling back to Cloud Tasks`);
        return false;
      }
      
      console.log(`🔄 Stage 2: Full processing (${remainingTime}ms remaining)...`);
      
      const fullResult = await Promise.race([
        this.processReceiptInWebhook(userId, messageId, replyToken, abortController.signal),
        new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), remainingTime);
        })
      ]);
      
      if (fullResult === 'success') {
        const elapsedTime = Date.now() - startTime;
        console.log(`✅ Receipt processed successfully in full mode within ${elapsedTime}ms`);
        return true;
      } else {
        console.log(`⏰ Full processing timed out, falling back to Cloud Tasks`);
        return false;
      }
      
    } catch (error: any) {
      const elapsedTime = Date.now() - startTime;
      console.error(`❌ Receipt processing failed in webhook after ${elapsedTime}ms:`, error);
      
      // エラー時は即座にフォールバックメッセージを送信
      try {
        const fallbackMessage = '⚠️ レシート処理中にエラーが発生しました。バックグラウンドで再試行しています...';
        await this.replyMessage(replyToken, fallbackMessage);
        console.log(`📤 Sent error fallback message to user ${userId}`);
      } catch (replyError) {
        console.error(`❌ Failed to send error fallback message:`, replyError);
      }
      
      return false; // Cloud Tasksでリトライ
    } finally {
      // 必ずAbort処理を実行
      abortController.abort();
    }
  }

  // 軽量OCR処理（高速化＋キャンセル対応）
  private async tryLightOCRProcessing(userId: string, messageId: string, replyToken: string, abortSignal: AbortSignal): Promise<'success' | 'error'> {
    console.log(`🚀 Starting light OCR processing for user: ${userId}`);

    try {
      // Abort チェック
      if (abortSignal.aborted) return 'error';

      // 新しいReceiptProcessingServiceを使用
      const { receiptInfo, currencyResult } = await receiptProcessingService.processReceiptWorkflow(
        messageId,
        this.blobClient,
        'light',
        abortSignal
      );

      // ログ出力
      receiptProcessingService.logProcessingResult('light', receiptInfo, currencyResult);

      if (receiptInfo.amounts && receiptInfo.amounts.length > 0) {
        console.log(`💱 Light OCR found ${receiptInfo.amounts.length} amounts, processing...`);
        
        return await this.completeReceiptProcessing(
          userId, 
          { amounts: receiptInfo.amounts, storeName: receiptInfo.storeName, items: receiptInfo.items }, 
          replyToken, 
          abortSignal, 
          'light'
        );
      } else {
        console.log('⚠️ Light OCR: No amounts found, will try full processing');
        return 'error';
      }
      
    } catch (error: any) {
      if (abortSignal.aborted) {
        console.log('🛑 Light OCR processing aborted');
        return 'error';
      }
      
      const errorInfo = receiptProcessingService.handleProcessingError(error, 'Light OCR processing');
      console.error(`❌ Light OCR processing failed:`, error);
      return 'error';
    }
  }

  // フル処理（改善版）
  private async processReceiptInWebhook(userId: string, messageId: string, replyToken: string, abortSignal: AbortSignal): Promise<'success' | 'error'> {
    console.log(`📷 Starting full webhook receipt processing for user: ${userId}, messageId: ${messageId}`);

    try {
      // Abort チェック
      if (abortSignal.aborted) return 'error';

      // 新しいReceiptProcessingServiceを使用
      const { receiptInfo, currencyResult } = await receiptProcessingService.processReceiptWorkflow(
        messageId,
        this.blobClient,
        'full',
        abortSignal
      );

      // ログ出力
      receiptProcessingService.logProcessingResult('full', receiptInfo, currencyResult);

      if (receiptInfo.amounts && receiptInfo.amounts.length > 0) {
        console.log(`💱 Full OCR found ${receiptInfo.amounts.length} amounts, processing...`);
        
        return await this.completeReceiptProcessing(
          userId, 
          { amounts: receiptInfo.amounts, storeName: receiptInfo.storeName, items: receiptInfo.items }, 
          replyToken, 
          abortSignal, 
          'full'
        );
      } else {
        console.log('⚠️ Full OCR: No amounts found in receipt');
        if (!abortSignal.aborted) {
          const messageClient = getMessageClient();
          const noAmountMessage = '⚠️ レシートから金額を読み取れませんでした。\n手動で金額を入力してください。\n例: "1500" または "1500円"';
          await messageClient.replyMessage(replyToken, noAmountMessage, userId);
        }
        return 'error';
      }
      
    } catch (error: any) {
      if (abortSignal.aborted) {
        console.log('🛑 Full OCR processing aborted');
        return 'error';
      }
      
      // エラーハンドリング統一
      const errorInfo = receiptProcessingService.handleProcessingError(error, 'Full OCR processing');
      
      if (!abortSignal.aborted && errorInfo.isTimeout) {
        const messageClient = getMessageClient();
        await messageClient.replyMessage(replyToken, errorInfo.message, userId);
      }
      
      console.error(`❌ Full OCR processing failed:`, error);
      return 'error';
    }
  }

  // レシート処理の完了部分（共通化）
  private async completeReceiptProcessing(
    userId: string, 
    receiptInfo: any, 
    replyToken: string, 
    abortSignal: AbortSignal,
    mode: 'light' | 'full'
  ): Promise<'success' | 'error'> {
    try {
      if (abortSignal.aborted) return 'error';

      // 最大金額を選択
      const mainAmount = receiptInfo.amounts.sort((a: any, b: any) => b.amount - a.amount)[0];
      console.log(`💰 ${mode} processing - Main amount detected:`, mainAmount);
      
      // 日本円に変換
      if (abortSignal.aborted) return 'error';
      console.log(`💱 ${mode} processing - Converting to JPY...`);
      const conversionResult = await CurrencyService.convertToJPY(
        mainAmount.amount, 
        mainAmount.currency.code
      );
      
      if (abortSignal.aborted) return 'error';
      console.log(`✅ ${mode} processing - Conversion result:`, conversionResult);
      
      // 変換後の金額を追加
      mainAmount.convertedAmount = conversionResult.convertedAmount;
      
      // ワンタイムトークン生成
      const token = await this.generateExpenseToken(userId);

      // 保留中取引として保存
      await this.savePendingTransaction(userId, {
        userId,
        parsedAmounts: [mainAmount],
        storeName: receiptInfo.storeName || null,
        timestamp: Date.now()
      });
      console.log(`💾 ${mode} processing - Pending transaction saved in webhook`);
      
      if (abortSignal.aborted) return 'error';
      
      // Flex Messageで確認画面を送信（エラーハンドリング改善）
      const confirmationCard = await this.createConfirmationCard(
        conversionResult.convertedAmount,
        mainAmount.currency.code !== 'JPY' ? mainAmount.amount : undefined,
        mainAmount.currency.code !== 'JPY' ? mainAmount.currency.code : undefined,
        mainAmount.currency.code !== 'JPY' ? conversionResult.rate : undefined,
        receiptInfo.storeName || undefined,
        token
      );
      
      if (abortSignal.aborted) return 'error';
      
      console.log(`📤 ${mode} processing - Sending confirmation flex message via reply...`);
      
      try {
        await this.replyFlexMessage(replyToken, '💰 支出確認', confirmationCard);
        console.log(`✅ ${mode} processing - Confirmation sent via reply message successfully`);
        return 'success';
      } catch (replyError: any) {
        console.error(`❌ ${mode} processing - Reply flex message failed:`, replyError);
        
        // replyTokenが無効な場合のフォールバック
        if (replyError.status === HTTP_BAD_REQUEST && replyError.body?.includes('Invalid reply token')) {
          console.log(`🔄 ${mode} processing - Falling back to push message due to invalid reply token`);
          try {
            await this.pushFlexMessage(userId, '💰 支出確認', confirmationCard);
            console.log(`✅ ${mode} processing - Confirmation sent via push message (fallback)`);
            return 'success';
          } catch (pushError: any) {
            console.error(`❌ ${mode} processing - Push flex message also failed:`, pushError);
            
            // 最終フォールバック: テキストメッセージ
            const fallbackText = `💰 支出確認\n\n店舗: ${receiptInfo.storeName || '不明'}\n金額: ¥${conversionResult.convertedAmount.toLocaleString()}\n\n追加しますか？\n「はい」または「いいえ」で回答してください。`;
            await this.pushMessage(userId, fallbackText);
            console.log(`✅ ${mode} processing - Sent fallback text message`);
            return 'success';
          }
        } else {
          throw replyError;
        }
      }
      
    } catch (error: any) {
      if (abortSignal.aborted) {
        console.log(`🛑 ${mode} processing - Receipt completion aborted`);
        return 'error';
      }
      console.error(`❌ ${mode} processing - Receipt completion failed:`, error);
      return 'error';
    }
  }

  public async handleBudgetSet(replyToken: string, userId: string, text: string): Promise<void> {
    const amount = this.parseAmount(text);
    if (amount <= 0) {
      await this.replyMessage(
        replyToken,
        '❌ 有効な金額を入力してください。\n例: "予算設定 ' + BUDGET_QUICK_REPLY_MIN + '" または "budget set ' + BUDGET_QUICK_REPLY_MIN + '"'
      );
      return;
    }

    try {
      // 初回設定かチェック
      const existingUser = await databaseService.getUserStats(userId);
      const isFirstTime = !existingUser || existingUser.monthlyBudget === 0;

      await databaseService.updateBudget(userId, amount);
      const message = `✅ 月間予算を ${amount.toLocaleString()}円に設定しました！`;
      
      await this.replyMessage(replyToken, message);

      // 設定後に予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '現在の予算状況', flexContent);
        
        // 予算設定完了メッセージはReply Messageで既に送信済み
        // 追加のPush Messageは削除（課金対象のため）
        // チュートリアルはヘルプコマンドで確認可能
      }
    } catch (error) {
      console.error('Budget set error:', error);
      await this.replyMessage(replyToken, '❌ 予算設定中にエラーが発生しました。');
    }
  }

  public async handleBudgetStatus(replyToken: string, userId: string): Promise<void> {
    try {
      // ローディングアニメーション表示
      await this.showLoadingAnimation(userId);
      
      const stats = await databaseService.getUserStats(userId);
      if (!stats) {
        await this.replyMessage(replyToken, '❌ ユーザー情報が見つかりません。');
        return;
      }

      // 進捗カードを送信
      const flexContent = await this.createBudgetProgressCard(stats, userId);
      await this.replyFlexMessage(replyToken, '📊 予算進捗状況', flexContent);
    } catch (error) {
      console.error('Budget status error:', error);
      await this.replyMessage(replyToken, '❌ 予算状況の取得中にエラーが発生しました。');
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

  public async handleBudgetReset(replyToken: string, userId: string): Promise<void> {
    const token = tokenManager.generateResetToken(userId);

    // リセット警告メッセージを表示
    const warningMessage = '⚠️ 重要な警告\n\n' +
      'すべての取引データが完全に削除されます。\n' +
      'この操作は取り消すことができません。\n\n' +
      '本当にリセットしますか？';

    const actions = [
      { label: '✅ リセット実行', data: `confirm_reset_${token}` },
      { label: '❌ キャンセル', data: `cancel_reset_${token}` }
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
      
      await this.replyMessage(replyToken, message);
    } catch (error) {
      console.error('Budget reset error:', error);
      await this.replyMessage(replyToken, '❌ 予算リセット中にエラーが発生しました。');
    }
  }

  public async handleHistory(replyToken: string, userId: string): Promise<void> {
    try {
      // ローディングアニメーションを表示
      await this.showLoadingAnimation(userId);
      
      const transactions = await databaseService.getRecentTransactions(userId, 10);
      
      if (transactions.length === 0) {
        await this.replyMessage(replyToken, '📝 まだ支出の履歴がありません。');
        return;
      }

      // Flex Messageで取引一覧を表示
      const flexContent = this.createTransactionListCard(transactions);
      await this.replyFlexMessage(replyToken, '📋 取引履歴', flexContent);
    } catch (error) {
      console.error('Transaction history error:', error);
      await this.replyMessage(replyToken, '❌ 履歴の取得中にエラーが発生しました。');
    }
  }

  public async handleHelp(replyToken: string): Promise<void> {
    const helpCard = {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "予算管理ボットの使い方",
            weight: "bold",
            size: "xl",
            color: "#ffffff",
            align: "center"
          }
        ],
        backgroundColor: "#2196F3",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "各機能の説明",
            weight: "bold",
            size: "md",
            color: "#333333",
            margin: "md"
          },
          {
            type: "separator",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "残高",
                    weight: "bold",
                    size: "sm",
                    color: "#2196F3",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: "月の予算を設定するだけで、今日使える額、一週間で使える額、一ヶ月で使える残りの額に分けて表示",
                    size: "sm",
                    color: "#666666",
                    flex: 7,
                    wrap: true
                  }
                ],
                margin: "lg"
              },
              {
                type: "separator",
                margin: "md"
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "予算設定",
                    weight: "bold",
                    size: "sm",
                    color: "#2196F3",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: "月額予算を設定・変更",
                    size: "sm",
                    color: "#666666",
                    flex: 7,
                    wrap: true
                  }
                ],
                margin: "md"
              },
              {
                type: "separator",
                margin: "md"
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "レポート",
                    weight: "bold",
                    size: "sm",
                    color: "#2196F3",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: "週や月ごとの支出分析",
                    size: "sm",
                    color: "#666666",
                    flex: 7,
                    wrap: true
                  }
                ],
                margin: "md"
              }
            ],
            margin: "lg"
          },
          {
            type: "separator",
            margin: "xl"
          },
          {
            type: "text",
            text: "使用方法",
            weight: "bold",
            size: "md",
            color: "#333333",
            margin: "xl"
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "1. 💰 支出の記録",
                weight: "bold",
                size: "sm",
                color: "#333333",
                margin: "lg"
              },
              {
                type: "text",
                text: "金額のみを入力して支出を記録できます（例: 2500）",
                size: "sm",
                color: "#666666",
                wrap: true,
                margin: "sm"
              },
              {
                type: "text",
                text: "2. 📷 レシート認識",
                weight: "bold",
                size: "sm",
                color: "#333333",
                margin: "md"
              },
              {
                type: "text",
                text: "レシートの写真を送信すると自動で金額を読み取ります",
                size: "sm",
                color: "#666666",
                wrap: true,
                margin: "sm"
              },
              {
                type: "text",
                text: "3. 📱 リッチメニュー",
                weight: "bold",
                size: "sm",
                color: "#333333",
                margin: "md"
              },
              {
                type: "text",
                text: "下部のメニューから各機能にアクセスできます",
                size: "sm",
                color: "#666666",
                wrap: true,
                margin: "sm"
              }
            ]
          }
        ],
        paddingAll: "20px"
      }
    };

    await this.replyFlexMessage(replyToken, "ヘルプ", helpCard);
  }


  public async handleTodayBalance(replyToken: string, userId: string): Promise<void> {
    try {
      // ローディングアニメーションを表示
      await this.showLoadingAnimation(userId);
      
      const stats = await databaseService.getUserStats(userId);
      if (!stats) {
        await this.replyMessage(replyToken, '❌ ユーザー情報が見つかりません。まず予算を設定してください。');
        return;
      }

      // 予算確認と同じカードを表示（旧レポート機能）
      const flexContent = await this.createBudgetProgressCard(stats, userId);
      await this.replyFlexMessage(replyToken, '📊 今日の残高', flexContent);
    } catch (error) {
      console.error('Today balance error:', error);
      await this.replyMessage(replyToken, '❌ 残高の取得中にエラーが発生しました。');
    }
  }

  public async handleReport(replyToken: string, userId: string): Promise<void> {
    const message = `📈 レポート機能\n\n` +
      `週間・月間の詳細なレポート機能は\n` +
      `現在開発中です。\n\n` +
      `📊 現在利用可能な機能:\n` +
      `• 今日の残高（進捗グラフ表示）\n` +
      `• 取引履歴の確認\n` +
      `• 予算設定・変更\n\n` +
      `💡 もうしばらくお待ちください！`;

    await this.replyMessage(replyToken, message);
  }

  public async handleBudgetSetInstruction(replyToken: string, userId?: string): Promise<void> {
    // 予算設定待機状態を設定
    if (userId) {
      this.pendingBudgetSets.set(userId, {
        userId,
        timestamp: Date.now()
      });
    }
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();
    
    const budgetInputCard = {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "💰 予算設定",
            weight: "bold",
            color: "#ffffff",
            size: "lg",
            align: "center"
          }
        ],
        backgroundColor: "#2196F3",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `${currentYear}年${currentMonth}月の予算`,
            weight: "bold",
            size: "md",
            color: "#333333",
            align: "center",
            margin: "md"
          },
          {
            type: "text",
            text: `${currentMonth}月${lastDayOfMonth}日まで`,
            size: "sm",
            color: "#666666",
            align: "center",
            margin: "sm"
          },
          {
            type: "separator",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "💡 金額のみを入力してください",
                size: "sm",
                color: "#999999",
                align: "center",
                margin: "lg"
              },
              {
                type: "text",
                text: "例: 50000",
                size: "sm",
                color: "#2196F3",
                align: "center",
                weight: "bold",
                margin: "sm"
              }
            ],
            backgroundColor: "#f8f9fa",
            cornerRadius: "8px",
            paddingAll: "16px",
            margin: "lg"
          }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "下のメッセージ入力欄に金額を入力してください",
            size: "xs",
            color: "#999999",
            align: "center",
            wrap: true
          }
        ],
        paddingAll: "16px"
      }
    };

    // クイックリプライオプションを作成
    const quickReplyItems = [];
    for (let amount = BUDGET_INSTRUCTION_MIN; amount <= BUDGET_INSTRUCTION_MAX; amount += BUDGET_INSTRUCTION_STEP) {
      quickReplyItems.push({
        type: "action",
        action: {
          type: "message",
          label: `¥${amount.toLocaleString()}`,
          text: amount.toString()
        }
      });
    }

    const quickReply = {
      items: quickReplyItems
    };

    // Flex MessageとQuick Replyを組み合わせて送信
    const message = {
      type: "flex",
      altText: "予算設定",
      contents: budgetInputCard,
      quickReply: quickReply
    };

    await this.client.replyMessage({
      replyToken,
      messages: [message as any]
    });
  }


  public async addExpense(replyToken: string, userId: string, amount: number, description: string): Promise<void> {
    try {
      await databaseService.addTransaction(userId, amount, description);
      const stats = await databaseService.getUserStats(userId);
      
      if (!stats) {
        await this.replyMessage(replyToken, '❌ ユーザー情報が見つかりません。');
        return;
      }

      const statusEmoji = stats.budgetUsagePercentage > BUDGET_DANGER_THRESHOLD ? '🚨' : 
                         stats.budgetUsagePercentage > BUDGET_WARNING_THRESHOLD ? '⚠️' : '✅';

      const message = `${statusEmoji} 支出を記録しました\n\n` +
        `💸 支出: ${amount.toLocaleString()}円\n` +
        `📝 内容: ${description}`;

      await this.replyMessage(replyToken, message);

      // Flex Messageで予算状況を表示
      const flexContent = await this.createBudgetProgressCard(stats, userId);
      await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
    } catch (error) {
      console.error('Add expense error:', error);
      await this.replyMessage(replyToken, '❌ 支出の記録中にエラーが発生しました。');
    }
  }

  public parseAmount(text: string): number {
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
    const daysInCurrentWeek = Math.min(WEEK_DAYS, Math.ceil((weekEnd.getTime() - weekStart.getTime()) / MILLISECONDS_PER_DAY) + 1);
    
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
    const filledDots = Math.min(Math.round((percentage / 100) * PROGRESS_BAR_TOTAL_DOTS), PROGRESS_BAR_TOTAL_DOTS);
    const emptyDots = PROGRESS_BAR_TOTAL_DOTS - filledDots;
    
    return '●'.repeat(filledDots) + '○'.repeat(emptyDots);
  }

  private createProgressBar(percentage: number, color: string): any {
    const filledWidth = Math.max(1, Math.min(Math.round(percentage), PROGRESS_BAR_MAX_WIDTH));
    const remainingWidth = Math.max(1, PROGRESS_BAR_MAX_WIDTH - filledWidth);
    
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        ...(filledWidth > 0 ? [{
          type: 'box',
          layout: 'vertical',
          contents: [],
          backgroundColor: color,
          cornerRadius: '10px',
          flex: filledWidth
        }] : []),
        ...(remainingWidth > 0 ? [{
          type: 'box',
          layout: 'vertical',
          contents: [],
          backgroundColor: '#E8E8E8',
          cornerRadius: '10px',
          flex: remainingWidth
        }] : [])
      ],
      height: '8px',
      margin: 'md'
    };
  }

  private createReceiptConfirmationCard(
    amount: number, 
    originalAmount?: number, 
    currency?: string, 
    rate?: number, 
    storeName?: string,
    token?: string
  ): any {
    const displayAmount = originalAmount || amount;
    const displayCurrency = currency || 'JPY';
    const isForeignCurrency = currency && currency !== 'JPY';
    
    // ボディーのコンテンツを構築
    const bodyContents: any[] = [];
    
    if (isForeignCurrency) {
      // 外貨の場合：日本円換算額とレートを表示
      bodyContents.push(
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: '日本円',
              color: '#aaaaaa',
              size: 'sm',
              flex: 2
            },
            {
              type: 'text',
              text: `¥${amount.toLocaleString()}`,
              wrap: true,
              color: '#06C755',
              size: 'md',
              flex: 3,
              weight: 'bold'
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
              text: 'レート',
              color: '#aaaaaa',
              size: 'sm',
              flex: 2
            },
            {
              type: 'text',
              text: rate ? `1 ${currency} = ${rate.toFixed(4)} JPY` : '取得中...',
              wrap: true,
              color: '#666666',
              size: 'sm',
              flex: 3
            }
          ]
        }
      );
    }
    
    if (storeName) {
      bodyContents.push({
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: '店舗名',
            color: '#aaaaaa',
            size: 'sm',
            flex: 2
          },
          {
            type: 'text',
            text: storeName,
            wrap: true,
            color: '#666666',
            size: 'sm',
            flex: 3,
            weight: 'bold'
          }
        ]
      });
    }
    
    // 日本円の場合で店舗名がない場合の説明テキスト
    if (!isForeignCurrency && !storeName) {
      bodyContents.push({
        type: 'text',
        text: 'この支出を記録しますか？',
        color: '#666666',
        size: 'sm',
        align: 'center'
      });
    }

    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💰 支出確認',
            weight: 'bold',
            color: '#ffffff',
            size: 'lg',
            align: 'center'
          },
          {
            type: 'text',
            text: `${originalAmount ? originalAmount.toLocaleString() : amount.toLocaleString()} ${displayCurrency}`,
            weight: 'bold',
            color: '#ffffff',
            size: 'xl',
            align: 'center'
          },
          {
            type: 'text',
            text: originalAmount ? '元の金額' : '金額',
            color: '#ffffff',
            size: 'xs',
            align: 'center'
          }
        ],
        backgroundColor: '#06C755',
        paddingAll: 'lg'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: 'lg'
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: '#06C755',
            action: {
              type: 'postback',
              label: '記録する',
              data: token ? `confirm_expense_${token}` : 'confirm_yes'
            }
          },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'button',
                style: 'secondary',
                height: 'sm',
                flex: 1,
                action: {
                  type: 'postback',
                  label: '✏️ 編集',
                  data: 'receipt_edit'
                }
              },
              {
                type: 'button',
                style: 'secondary',
                height: 'sm',
                flex: 1,
                action: {
                  type: 'postback',
                  label: '❌ キャンセル',
                  data: token ? `cancel_expense_${token}` : 'confirm_no'
                }
              }
            ]
          }
        ],
        paddingAll: 'lg'
      }
    };
  }

  private createTransactionEditInfoCard(transaction: Transaction): any {
    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '✏️ 取引編集',
            weight: 'bold',
            color: '#333333',
            size: 'lg',
            align: 'center'
          },
          {
            type: 'text',
            text: `¥${transaction.amount.toLocaleString()}`,
            weight: 'bold',
            color: '#06C755',
            size: 'xl',
            align: 'center'
          },
          {
            type: 'text',
            text: '現在の金額',
            color: '#666666',
            size: 'xs',
            align: 'center'
          }
        ],
        backgroundColor: '#ffffff',
        paddingAll: 'lg'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '内容',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: transaction.description || '（説明なし）',
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 3,
                weight: 'bold'
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
                text: '日時',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: new Date(transaction.createdAt).toLocaleString('ja-JP'),
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 3
              }
            ],
            margin: 'sm'
          },
          {
            type: 'separator',
            margin: 'lg'
          },
          {
            type: 'text',
            text: '新しい金額を入力してください',
            color: '#06C755',
            size: 'md',
            align: 'center',
            weight: 'bold',
            margin: 'lg'
          },
          {
            type: 'text',
            text: '例: "2500"',
            color: '#999999',
            size: 'sm',
            align: 'center',
            margin: 'sm'
          }
        ],
        paddingAll: 'lg'
      }
    };
  }

  private createTransactionDeleteCard(transaction: Transaction, token: string): any {
    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🗑️ 取引削除確認',
            weight: 'bold',
            color: '#ffffff',
            size: 'lg',
            align: 'center'
          },
          {
            type: 'text',
            text: `¥${transaction.amount.toLocaleString()}`,
            weight: 'bold',
            color: '#ffffff',
            size: 'xl',
            align: 'center'
          },
          {
            type: 'text',
            text: '削除する金額',
            color: '#ffffff',
            size: 'xs',
            align: 'center'
          }
        ],
        backgroundColor: '#FF334B',
        paddingAll: 'lg'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '内容',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: transaction.description || '（説明なし）',
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 3,
                weight: 'bold'
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
                text: '日時',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: new Date(transaction.createdAt).toLocaleString('ja-JP'),
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 3
              }
            ],
            margin: 'sm'
          },
          {
            type: 'text',
            text: 'この取引を削除しますか？',
            color: '#666666',
            size: 'sm',
            align: 'center',
            margin: 'lg'
          }
        ],
        paddingAll: 'lg'
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: '#FF334B',
            action: {
              type: 'postback',
              label: '🗑️ 削除する',
              data: `confirm_delete_${token}`
            }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '❌ キャンセル',
              data: `cancel_delete_${token}`
            }
          }
        ],
        paddingAll: 'lg'
      }
    };
  }

  private createEditConfirmationCard(transaction: Transaction, newAmount: number, token: string): any {
    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '✏️ 編集内容確認',
            weight: 'bold',
            color: '#333333',
            size: 'lg',
            align: 'center'
          },
          {
            type: 'text',
            text: 'この内容でよろしいですか？',
            color: '#666666',
            size: 'sm',
            align: 'center'
          }
        ],
        backgroundColor: '#ffffff',
        paddingAll: 'lg'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '新しい金額',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: `¥${newAmount.toLocaleString()}`,
                wrap: true,
                color: '#06C755',
                size: 'lg',
                flex: 3,
                weight: 'bold'
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
                text: '元の金額',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: `¥${transaction.amount.toLocaleString()}`,
                wrap: true,
                color: '#999999',
                size: 'sm',
                flex: 3,
                decoration: 'line-through'
              }
            ],
            margin: 'sm'
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '内容',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: transaction.description || '（説明なし）',
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 3,
                weight: 'bold'
              }
            ],
            margin: 'sm'
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '日時',
                color: '#aaaaaa',
                size: 'sm',
                flex: 2
              },
              {
                type: 'text',
                text: new Date(transaction.createdAt).toLocaleString('ja-JP'),
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 3
              }
            ],
            margin: 'sm'
          }
        ],
        paddingAll: 'lg'
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: '#06C755',
            action: {
              type: 'postback',
              label: '✅ 確定',
              data: `confirm_edit_${token}`
            }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '❌ キャンセル',
              data: `cancel_edit_${token}`
            }
          }
        ],
        paddingAll: 'lg'
      }
    };
  }

  private async createBudgetProgressCard(stats: any, userId: string): Promise<any> {
    const periodStats = await this.getBudgetPeriodStats(stats.monthlyBudget, stats.currentSpent, userId);
    
    // ChartDataの作成
    const dailyChartData: ChartData = {
      spent: periodStats.daily.todaySpent,
      remaining: Math.max(0, periodStats.daily.remaining),
      budget: periodStats.daily.budget,
      percentage: periodStats.daily.percentage,
      type: 'daily',
      period: '本日'
    };

    const weeklyChartData: ChartData = {
      spent: periodStats.weekly.spent,
      remaining: Math.max(0, periodStats.weekly.remaining),
      budget: periodStats.weekly.budget,
      percentage: periodStats.weekly.percentage,
      type: 'weekly',
      period: '今週'
    };

    const monthlyChartData: ChartData = {
      spent: periodStats.monthly.spent,
      remaining: Math.max(0, periodStats.monthly.remaining),
      budget: periodStats.monthly.budget,
      percentage: periodStats.monthly.percentage,
      type: 'monthly',
      period: '今月'
    };

    // プログレスデータの生成
    const dailyProgressData = chartService.generateProgressData(dailyChartData);
    const weeklyProgressData = chartService.generateProgressData(weeklyChartData);
    const monthlyProgressData = chartService.generateProgressData(monthlyChartData);

    // ステータスと色を決定
    const getStatusAndColor = (percentage: number) => {
      if (percentage <= 50) return { status: 'Good', color: '#4CAF50' };
      if (percentage <= 80) return { status: 'Warning', color: '#FF9800' };
      return { status: 'Over Budget', color: '#F44336' };
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
                size: 'lg',
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
            backgroundColor: '#06C755',
            paddingAll: 'lg'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              this.createProgressBar(dailyProgressData.percentage, dailyProgressData.color),
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: `${dailyProgressData.percentage.toFixed(1)}%`,
                    color: dailyProgressData.color,
                    weight: 'bold',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: dailyProgressData.status,
                    color: '#666666',
                    size: 'xs',
                    align: 'end',
                    flex: 1
                  }
                ],
                margin: 'sm'
              },
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                margin: 'lg',
                contents: [
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '今日の支出',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 2
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.daily.todaySpent.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 3,
                        weight: 'bold'
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
                        text: '残り予算',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 2
                      },
                      {
                        type: 'text',
                        text: `¥${Math.max(0, periodStats.daily.remaining).toLocaleString()}`,
                        wrap: true,
                        color: '#06C755',
                        size: 'sm',
                        flex: 3,
                        weight: 'bold'
                      }
                    ]
                  }
                ]
              }
            ],
            paddingAll: 'lg'
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
                size: 'lg',
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
            backgroundColor: '#06C755',
            paddingAll: 'lg'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              this.createProgressBar(weeklyProgressData.percentage, weeklyProgressData.color),
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: `${weeklyProgressData.percentage.toFixed(1)}%`,
                    color: weeklyProgressData.color,
                    weight: 'bold',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: weeklyProgressData.status,
                    color: '#666666',
                    size: 'xs',
                    align: 'end',
                    flex: 1
                  }
                ],
                margin: 'sm'
              },
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                margin: 'lg',
                contents: [
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '今週の支出',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 2
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.weekly.spent.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 3,
                        weight: 'bold'
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
                        text: '残り予算',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 2
                      },
                      {
                        type: 'text',
                        text: `¥${Math.max(0, periodStats.weekly.remaining).toLocaleString()}`,
                        wrap: true,
                        color: '#06C755',
                        size: 'sm',
                        flex: 3,
                        weight: 'bold'
                      }
                    ]
                  }
                ]
              }
            ],
            paddingAll: 'lg'
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
                size: 'lg',
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
            backgroundColor: '#06C755',
            paddingAll: 'lg'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              this.createProgressBar(monthlyProgressData.percentage, monthlyProgressData.color),
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: `${monthlyProgressData.percentage.toFixed(1)}%`,
                    color: monthlyProgressData.color,
                    weight: 'bold',
                    size: 'sm',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: monthlyProgressData.status,
                    color: '#666666',
                    size: 'xs',
                    align: 'end',
                    flex: 1
                  }
                ],
                margin: 'sm'
              },
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                margin: 'lg',
                contents: [
                  {
                    type: 'box',
                    layout: 'baseline',
                    spacing: 'sm',
                    contents: [
                      {
                        type: 'text',
                        text: '今月の支出',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 2
                      },
                      {
                        type: 'text',
                        text: `¥${periodStats.monthly.spent.toLocaleString()}`,
                        wrap: true,
                        color: '#666666',
                        size: 'sm',
                        flex: 3,
                        weight: 'bold'
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
                        text: '残り予算',
                        color: '#aaaaaa',
                        size: 'sm',
                        flex: 2
                      },
                      {
                        type: 'text',
                        text: `¥${Math.max(0, periodStats.monthly.remaining).toLocaleString()}`,
                        wrap: true,
                        color: '#06C755',
                        size: 'sm',
                        flex: 3,
                        weight: 'bold'
                      }
                    ]
                  }
                ]
              }
            ],
            paddingAll: 'lg'
          }
        }
      ]
    };
  }

  async createWeeklyTrendCard(userId: string): Promise<any> {
    try {
      // 過去7日間のデータを取得
      const weeklyData = [];
      const today = new Date();
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
        
        // その日の支出を取得（簡易版）
        const daySpent = await this.getDaySpent(userId, date);
        const dayName = date.toLocaleDateString('ja-JP', { weekday: 'short' });
        
        weeklyData.push({
          day: dayName,
          spent: daySpent
        });
      }

      const trendChartUrl = chartService.generateWeeklyTrendChart(weeklyData);
      const totalWeekSpent = weeklyData.reduce((sum: number, day: { day: string; spent: number }) => sum + day.spent, 0);
      
      return {
        type: 'bubble',
        size: 'giga',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '📈 Weekly Spending Trend',
              weight: 'bold',
              color: '#ffffff',
              size: 'lg',
              align: 'center'
            },
            {
              type: 'text',
              text: `Total: ¥${totalWeekSpent.toLocaleString()}`,
              color: '#ffffff',
              size: 'md',
              align: 'center',
              margin: 'sm'
            }
          ],
          backgroundColor: '#2196F3',
          paddingAll: 'lg'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'image',
              url: trendChartUrl,
              size: 'full',
              aspectRatio: '2:1',
              aspectMode: 'cover',
              margin: 'md'
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'md',
              margin: 'lg',
              contents: [
                {
                  type: 'text',
                  text: '🔍 支出パターンの分析',
                  weight: 'bold',
                  color: '#333333',
                  size: 'md'
                },
                {
                  type: 'text',
                  text: this.analyzeTrend(weeklyData),
                  color: '#666666',
                  size: 'sm',
                  wrap: true
                }
              ]
            }
          ],
          paddingAll: 'lg'
        }
      };
    } catch (error) {
      console.error('Weekly trend card error:', error);
      return null;
    }
  }

  private async getDaySpent(userId: string, date: Date): Promise<number> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      const user = await databaseService.getUser(userId);
      if (!user) return 0;

      // 簡易版：その日の取引を合計. 今後より詳細に
      const transactions = await databaseService.getRecentTransactions(userId, CHART_TRANSACTIONS_LIMIT);
      return transactions
        .filter((t: Transaction) => {
          const transactionDate = new Date(t.createdAt);
          return transactionDate >= startOfDay && transactionDate <= endOfDay;
        })
        .reduce((sum: number, t: Transaction) => sum + t.amount, 0);
    } catch (error) {
      console.error('Get day spent error:', error);
      return 0;
    }
  }

  private analyzeTrend(weeklyData: { day: string; spent: number }[]): string {
    const amounts = weeklyData.map((d: { day: string; spent: number }) => d.spent);
    const maxAmount = Math.max(...amounts);
    const maxDay = weeklyData.find((d: { day: string; spent: number }) => d.spent === maxAmount)?.day || '';
    const avgAmount = amounts.reduce((sum: number, amount: number) => sum + amount, 0) / amounts.length;
    
    let analysis = `今週の最高支出は${maxDay}の¥${maxAmount.toLocaleString()}でした。`;
    
    if (maxAmount > avgAmount * 1.5) {
      analysis += ' 支出にばらつきがあります。';
    } else {
      analysis += ' 比較的安定した支出パターンです。';
    }
    
    return analysis;
  }

  async replyMessage(replyToken: string, text: string, userId?: string): Promise<void> {
    const messageClient = getMessageClient();
    await messageClient.replyMessage(replyToken, text, userId);
  }

  async pushMessage(userId: string, text: string): Promise<void> {
    const messageClient = getMessageClient();
    await messageClient.pushMessage(userId, text);
  }


  async replyFlexMessage(replyToken: string, altText: string, flexContent: any, userId?: string): Promise<void> {
    const messageClient = getMessageClient();
    await messageClient.replyFlexMessage(replyToken, altText, flexContent, userId);
  }

  async pushFlexMessage(userId: string, altText: string, flexContent: any): Promise<void> {
    const messageClient = getMessageClient();
    await messageClient.pushFlexMessage(userId, altText, flexContent);
  }

  async showLoadingAnimation(userId: string): Promise<void> {
    const messageClient = getMessageClient();
    await messageClient.showLoadingAnimation(userId);
  }

  private async pushButtonsMessage(
    userId: string, 
    title: string, 
    text: string, 
    actions: { label: string; data: string }[]
  ): Promise<void> {
    const messageClient = getMessageClient();
    await messageClient.pushButtonsMessage(userId, title, text, actions);
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
      
      // ワンタイムトークン生成
      const token = await tokenManager.generateExpenseToken(userId);

      // 保留中取引として保存
      this.pendingTransactions.set(userId, {
        userId,
        parsedAmounts: [mainAmount],
        storeName,
        timestamp: Date.now()
      });
      console.log('💾 Pending transaction saved');
      
      // Flex Messageで確認画面を送信
      const confirmationCard = this.createReceiptConfirmationCard(
        conversionResult.convertedAmount,
        mainAmount.currency.code !== 'JPY' ? mainAmount.amount : undefined,
        mainAmount.currency.code !== 'JPY' ? mainAmount.currency.code : undefined,
        mainAmount.currency.code !== 'JPY' ? conversionResult.rate : undefined,
        storeName || undefined,
        token
      );
      
      console.log('📤 About to send confirmation flex message...');
      await this.pushFlexMessage(userId, '💰 支出確認', confirmationCard);
      
    } catch (error) {
      console.error('❌ Process receipt amounts error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
      }
      await this.pushMessage(userId, '❌ 為替レートの取得中にエラーが発生しました。手動で金額を入力してください。');
    }
  }

  public async handleConfirmation(replyToken: string, userId: string, confirmed: boolean): Promise<void> {
    await this.confirmationFlowService.handleConfirmationResponse(userId, replyToken, confirmed);
  }

  public async handleReceiptEdit(replyToken: string, userId: string): Promise<void> {
    const pending = this.pendingTransactions.get(userId);
    
    if (!pending) {
      await this.replyMessage(replyToken, '⚠️ 編集可能な取引がありません。');
      return;
    }
    
    const mainAmount = pending.parsedAmounts[0];
    const currentAmount = mainAmount.convertedAmount || mainAmount.amount;
    
    await this.replyMessage(
      replyToken, 
      `✏️ 金額を編集してください\n\n` +
      `現在の金額: ¥${currentAmount.toLocaleString()}\n` +
      `新しい金額を数字で入力してください。`
    );
    
    // 編集モードのフラグを設定（簡易実装）
    this.pendingEdits.set(userId, {
      userId,
      transactionId: -1, // レシート編集の場合は特別な値
      timestamp: Date.now()
    });
  }


  private async handleConfirmEdit(replyToken: string, userId: string, transactionId: number, newAmount: number): Promise<void> {
    try {
      const updatedTransaction = await databaseService.editTransaction(userId, transactionId, newAmount);
      
      const message = `✅ 取引を編集しました\n\n` +
        `新しい金額: ¥${newAmount.toLocaleString()}\n` +
        `内容: ${updatedTransaction.description}`;

      await this.replyMessage(replyToken, message);

      // 更新された予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
      }
    } catch (error) {
      console.error('Confirm edit error:', error);
      if (error instanceof Error && error.message === 'Transaction not found') {
        await this.replyMessage(replyToken, '❌ 指定された取引が見つかりません。');
      } else {
        await this.replyMessage(replyToken, '❌ 取引の編集中にエラーが発生しました。');
      }
    }
  }

  private async handleReceiptAmountEdit(replyToken: string, userId: string, newAmount: number): Promise<void> {
    const pending = this.pendingTransactions.get(userId);
    
    if (!pending) {
      await this.replyMessage(replyToken, '⚠️ 編集可能な取引がありません。');
      return;
    }
    
    try {
      const mainAmount = pending.parsedAmounts[0];
      const originalCurrency = mainAmount.currency.code;
      
      // 元の通貨として金額を更新
      mainAmount.amount = newAmount;
      
      let convertedAmount = newAmount;
      let rate: number | undefined = undefined;
      
      // 外貨の場合は日本円に換算
      if (originalCurrency !== 'JPY') {
        const conversionResult = await CurrencyService.convertToJPY(newAmount, originalCurrency);
        convertedAmount = conversionResult.convertedAmount;
        rate = conversionResult.rate;
        mainAmount.convertedAmount = convertedAmount;
        
        await this.replyMessage(replyToken, `✅ 金額を ${newAmount.toLocaleString()} ${originalCurrency} (¥${convertedAmount.toLocaleString()}) に変更しました。`);
      } else {
        mainAmount.convertedAmount = newAmount;
        await this.replyMessage(replyToken, `✅ 金額を ¥${newAmount.toLocaleString()} に変更しました。`);
      }
      
      // ワンタイムトークン生成（編集後の確認用）
      const token = await tokenManager.generateExpenseToken(userId);

      // 更新されたレシート確認カードを再送信
      const confirmationCard = this.createReceiptConfirmationCard(
        convertedAmount,
        originalCurrency !== 'JPY' ? newAmount : undefined,
        originalCurrency !== 'JPY' ? originalCurrency : undefined,
        rate,
        pending.storeName || undefined,
        token
      );
      
      await this.pushFlexMessage(userId, '💰 支出確認（編集済み）', confirmationCard);
    } catch (error) {
      console.error('Receipt amount edit error:', error);
      await this.replyMessage(replyToken, '❌ 金額の変更中にエラーが発生しました。');
    }
  }

  public async handleMenuAction(replyToken: string, userId: string, action: string): Promise<void> {
    switch (action) {
      case 'menu_budget_status':
        await this.handleBudgetStatus(replyToken, userId);
        break;
      case 'menu_history':
        await this.handleHistory(replyToken, userId);
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

      const statusEmoji = stats.budgetUsagePercentage > BUDGET_DANGER_THRESHOLD ? '🚨' : 
                         stats.budgetUsagePercentage > BUDGET_WARNING_THRESHOLD ? '⚠️' : '✅';

      const message = `${statusEmoji} 支出を記録しました\n\n` +
        `💸 支出: ${amount.toLocaleString()}円\n` +
        `📝 内容: ${description}`;

      await this.pushMessage(userId, message);

      // Flex Messageで予算状況を表示
      const flexContent = await this.createBudgetProgressCard(stats, userId);
      await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
    } catch (error) {
      console.error('Add expense with push error:', error);
      await this.pushMessage(userId, '❌ 支出の記録中にエラーが発生しました。');
    }
  }

  public async handleTransactionEdit(replyToken: string, userId: string, transactionId: string): Promise<void> {
    try {
      // ローディングアニメーションを表示
      await this.showLoadingAnimation(userId);
      
      // 取引情報を取得して表示
      const transactions = await databaseService.getRecentTransactions(userId, 50);
      const transactionIdNum = parseInt(transactionId);
      const transaction = transactions.find((t: Transaction) => t.id === transactionIdNum);
      
      if (!transaction) {
        await this.replyMessage(replyToken, '❌ 取引が見つかりません。');
        return;
      }

      // 編集待機状態を直接設定
      this.pendingEdits.set(userId, {
        userId,
        transactionId: transactionIdNum,
        timestamp: Date.now()
      });

      const editCard = this.createTransactionEditInfoCard(transaction);
      await this.replyFlexMessage(replyToken, '✏️ 取引編集', editCard);
    } catch (error) {
      console.error('Transaction edit error:', error);
      await this.replyMessage(replyToken, '❌ 取引編集の準備中にエラーが発生しました。');
    }
  }

  public async handleTransactionDelete(replyToken: string, userId: string, transactionId: string): Promise<void> {
    try {
      // ローディングアニメーションを表示
      await this.showLoadingAnimation(userId);
      
      // 取引情報を取得して確認メッセージを表示
      const transactions = await databaseService.getRecentTransactions(userId, RECENT_TRANSACTIONS_LIMIT);
      const transactionIdNum = parseInt(transactionId);
      const transaction = transactions.find((t: Transaction) => t.id === transactionIdNum);
      
      if (!transaction) {
        await this.replyMessage(replyToken, '❌ 取引が見つかりません。');
        return;
      }

      // ワンタイム・トークンを生成
      const token = tokenManager.generateDeleteToken(userId, transactionIdNum);
      console.log(`🔐 Delete token generated: ${token} for transaction ${transactionIdNum}`);

      const deleteCard = this.createTransactionDeleteCard(transaction, token);
      await this.replyFlexMessage(replyToken, '🗑️ 取引削除確認', deleteCard);
    } catch (error) {
      console.error('Transaction delete error:', error);
      await this.replyMessage(replyToken, '❌ 取引削除の準備中にエラーが発生しました。');
    }
  }

  public async handleDirectEditAmount(replyToken: string, userId: string, transactionId: number, newAmount: number): Promise<void> {
    try {
      // 期限切れトークンをクリーンアップ
      
      // レシート編集の場合（transactionId = -1）
      if (transactionId === -1) {
        await this.handleReceiptAmountEdit(replyToken, userId, newAmount);
        return;
      }
      
      // 取引情報を取得して確認カードを表示
      const transactions = await databaseService.getRecentTransactions(userId, 50);
      const transaction = transactions.find((t: Transaction) => t.id === transactionId);
      
      if (!transaction) {
        await this.replyMessage(replyToken, '❌ 取引が見つかりません。');
        return;
      }

      // ワンタイム・トークンを生成
      const token = tokenManager.generateEditToken(userId, transactionId, newAmount);
      console.log(`🔐 Edit token generated: ${token} for transaction ${transactionId}`);

      // 編集確認カードを表示
      const confirmCard = this.createEditConfirmationCard(transaction, newAmount, token);
      await this.replyFlexMessage(replyToken, '✏️ 編集内容確認', confirmCard);
    } catch (error) {
      console.error('Direct edit error:', error);
      await this.replyMessage(replyToken, '❌ 取引の編集中にエラーが発生しました。');
    }
  }


  public async handleEditCommand(replyToken: string, userId: string, text: string): Promise<void> {
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

  public async handleTransactionDeleteConfirm(replyToken: string, userId: string, token: string): Promise<void> {
    try {
      // 期限切れトークンをクリーンアップ
      
      // トークンの検証
      const deleteRequest = tokenManager.getDeleteRequest(token);
      if (!deleteRequest) {
        await this.replyMessage(replyToken, '❌ 削除リクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired delete token: ${token}`);
        return;
      }

      // ユーザーIDの検証
      if (deleteRequest.userId !== userId) {
        await this.replyMessage(replyToken, '❌ 削除権限がありません。');
        console.log(`🚫 Unauthorized delete attempt: ${userId} != ${deleteRequest.userId}`);
        // 不正アクセス試行時はトークンを即座に削除
        tokenManager.removeDeleteRequest(token);
        return;
      }

      // トークンを失効（ワンタイム使用）
      tokenManager.removeDeleteRequest(token);
      console.log(`🔐 Delete token consumed: ${token}`);

      const result = await databaseService.deleteTransaction(userId, deleteRequest.transactionId);
      
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

  public async handleDeleteCancel(replyToken: string, token: string): Promise<void> {
    try {
      // トークンの検証とクリーンアップ
      
      const deleteRequest = tokenManager.getDeleteRequest(token);
      if (!deleteRequest) {
        await this.replyMessage(replyToken, '❌ キャンセルリクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired cancel token: ${token}`);
        return;
      }

      // トークンを失効（キャンセル時も削除）
      tokenManager.removeDeleteRequest(token);
      console.log(`🔐 Cancel token consumed: ${token}`);

      await this.replyMessage(replyToken, '❌ 削除をキャンセルしました。');
    } catch (error) {
      console.error('Delete cancel error:', error);
      await this.replyMessage(replyToken, '❌ キャンセル処理中にエラーが発生しました。');
    }
  }

  public async handleEditConfirm(replyToken: string, userId: string, token: string): Promise<void> {
    try {
      // 期限切れトークンをクリーンアップ
      
      // トークンの検証
      const editRequest = tokenManager.getEditRequest(token);
      if (!editRequest) {
        await this.replyMessage(replyToken, '❌ 編集リクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired edit token: ${token}`);
        return;
      }

      // ユーザーIDの検証
      if (editRequest.userId !== userId) {
        await this.replyMessage(replyToken, '❌ 編集権限がありません。');
        console.log(`🚫 Unauthorized edit attempt: ${userId} != ${editRequest.userId}`);
        // 不正アクセス試行時はトークンを即座に削除
        tokenManager.removeEditRequest(token);
        return;
      }

      // トークンを失効（ワンタイム使用）
      tokenManager.removeEditRequest(token);
      console.log(`🔐 Edit token consumed: ${token}`);

      const result = await databaseService.editTransaction(userId, editRequest.transactionId, editRequest.newAmount);
      
      const message = `✅ 取引を編集しました\n\n` +
        `変更後: ¥${editRequest.newAmount.toLocaleString()}`;

      await this.replyMessage(replyToken, message);

      // 更新された予算状況を表示
      const stats = await databaseService.getUserStats(userId);
      if (stats) {
        const flexContent = await this.createBudgetProgressCard(stats, userId);
        await this.pushFlexMessage(userId, '更新された予算状況', flexContent);
      }
    } catch (error) {
      console.error('Edit confirm error:', error);
      if (error instanceof Error && error.message === 'Transaction not found') {
        await this.replyMessage(replyToken, '❌ 指定された取引が見つかりません。');
      } else {
        await this.replyMessage(replyToken, '❌ 取引の編集中にエラーが発生しました。');
      }
    }
  }

  public async handleEditCancel(replyToken: string, token: string): Promise<void> {
    try {
      // トークンの検証とクリーンアップ
      
      const editRequest = tokenManager.getEditRequest(token);
      if (!editRequest) {
        await this.replyMessage(replyToken, '❌ キャンセルリクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired edit cancel token: ${token}`);
        return;
      }

      // トークンを失効（キャンセル時も削除）
      tokenManager.removeEditRequest(token);
      console.log(`🔐 Edit cancel token consumed: ${token}`);

      await this.replyMessage(replyToken, '❌ 編集をキャンセルしました。');
    } catch (error) {
      console.error('Edit cancel error:', error);
      await this.replyMessage(replyToken, '❌ キャンセル処理中にエラーが発生しました。');
    }
  }

  public async handleExpenseConfirm(replyToken: string, userId: string, token: string): Promise<void> {
    try {
      
      const expenseRequest = tokenManager.getExpenseConfirmRequest(token);
      if (!expenseRequest || expenseRequest.userId !== userId) {
        await this.replyMessage(replyToken, '❌ 確認リクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired expense confirm token: ${token}`);
        return;
      }

      // トークンを失効（ワンタイム使用）
      tokenManager.removeExpenseConfirmRequest(token);
      console.log(`🔐 Expense confirm token consumed: ${token}`);

      // 旧来のconfirmation処理を呼び出し
      await this.handleConfirmation(replyToken, userId, true);
    } catch (error) {
      console.error('Expense confirm error:', error);
      await this.replyMessage(replyToken, '❌ 確認処理中にエラーが発生しました。');
    }
  }

  public async handleExpenseCancel(replyToken: string, token: string): Promise<void> {
    try {
      
      const expenseRequest = tokenManager.getExpenseConfirmRequest(token);
      if (!expenseRequest) {
        await this.replyMessage(replyToken, '❌ キャンセルリクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired expense cancel token: ${token}`);
        return;
      }

      // トークンを失効
      tokenManager.removeExpenseConfirmRequest(token);
      console.log(`🔐 Expense cancel token consumed: ${token}`);

      // 旧来のconfirmation処理を呼び出し
      await this.handleConfirmation(replyToken, expenseRequest.userId, false);
    } catch (error) {
      console.error('Expense cancel error:', error);
      await this.replyMessage(replyToken, '❌ キャンセル処理中にエラーが発生しました。');
    }
  }

  public async handleResetConfirm(replyToken: string, userId: string, token: string): Promise<void> {
    try {
      
      const resetRequest = tokenManager.getResetRequest(token);
      if (!resetRequest || resetRequest.userId !== userId) {
        await this.replyMessage(replyToken, '❌ リセット確認が無効または期限切れです。');
        console.log(`🔒 Invalid or expired reset confirm token: ${token}`);
        return;
      }

      // トークンを失効（ワンタイム使用）
      tokenManager.removeResetRequest(token);
      console.log(`🔐 Reset confirm token consumed: ${token}`);

      // 旧来のreset confirmation処理を呼び出し
      await this.handleResetConfirmation(replyToken, userId, true);
    } catch (error) {
      console.error('Reset confirm error:', error);
      await this.replyMessage(replyToken, '❌ リセット確認処理中にエラーが発生しました。');
    }
  }

  public async handleResetCancel(replyToken: string, token: string): Promise<void> {
    try {
      
      const resetRequest = tokenManager.getResetRequest(token);
      if (!resetRequest) {
        await this.replyMessage(replyToken, '❌ キャンセルリクエストが無効または期限切れです。');
        console.log(`🔒 Invalid or expired reset cancel token: ${token}`);
        return;
      }

      // トークンを失効
      tokenManager.removeResetRequest(token);
      console.log(`🔐 Reset cancel token consumed: ${token}`);

      // 旧来のreset confirmation処理を呼び出し
      await this.handleResetConfirmation(replyToken, resetRequest.userId, false);
    } catch (error) {
      console.error('Reset cancel error:', error);
      await this.replyMessage(replyToken, '❌ キャンセル処理中にエラーが発生しました。');
    }
  }

  public async handleManualExpenseConfirmation(replyToken: string, userId: string, amount: number, description: string): Promise<void> {
    try {
      // 新しい確認フローサービスを使用
      await this.confirmationFlowService.createAndSendManualConfirmation(
        userId,
        replyToken,
        amount,
        description
      );
    } catch (error) {
      console.error('Manual expense confirmation error:', error);
      await this.replyMessage(replyToken, '❌ 支出確認の準備中にエラーが発生しました。');
    }
  }
}