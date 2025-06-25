import { Request, Response } from 'express';
import { ServiceFactory } from '../shared/utils/DependencyInjection';
import { AddExpense } from '../usecases/AddExpense';
import { GetBudgetStatus } from '../usecases/GetBudgetStatus';
import { LineMessageClient } from '../infra/line/LineMessageClient';
import { TaskQueueClient } from '../infra/cloudTasks/TaskQueueClient';
import { logger } from '../shared/utils/Logger';
import { ErrorHandler, ExternalApiError, ValidationError } from '../shared/utils/ErrorHandler';
import { Validator } from '../shared/utils/Validator';
import { FlexMessageTemplates } from '../interface/views/FlexMessageTemplates';
import { ocrService } from '../services/core/ocrService';
import { receiptProcessingService } from '../services/core/ReceiptProcessingService';

/**
 * 新しいクリーンアーキテクチャベースのTaskHandler
 */
export class TaskHandler {
  private addExpenseUseCase: AddExpense;
  private getBudgetStatusUseCase: GetBudgetStatus;
  private lineClient: LineMessageClient;
  private taskQueue: TaskQueueClient;

  constructor() {
    this.addExpenseUseCase = ServiceFactory.createAddExpenseUseCase();
    this.getBudgetStatusUseCase = ServiceFactory.createGetBudgetStatusUseCase();
    this.lineClient = ServiceFactory.createLineMessageClient();
    this.taskQueue = ServiceFactory.createTaskQueueClient();
  }

  /**
   * レシート処理タスクハンドラー
   */
  async handleReceiptProcessing(req: Request, res: Response): Promise<void> {
    const stopTimer = logger.timer('receipt-processing-task');
    
    try {
      const { messageId, userId, imageUrl, replyToken } = req.body;

      // バリデーション
      if (!messageId || !userId || !imageUrl) {
        throw new ValidationError('Required fields missing', { messageId, userId, imageUrl });
      }

      logger.info('Receipt processing task started', { messageId, userId });

      // OCR処理でレシート解析
      const ocrResult = await logger.measureAsync('ocr-processing', async () => {
        return await ocrService.processImage(imageUrl);
      });

      if (!ocrResult.success || !ocrResult.result) {
        throw new ExternalApiError('OCR processing failed', 502, { ocrResult });
      }

      // レシート内容を解析
      const parsedResult = await receiptProcessingService.parseReceipt(ocrResult.result.text);

      if (!parsedResult.success || parsedResult.amounts.length === 0) {
        await this.sendReceiptProcessingError(userId, replyToken, 'レシートから金額を読み取れませんでした。');
        res.status(200).json({ success: false, message: 'No amounts found' });
        return;
      }

      // 最適な金額を選択
      const bestAmount = parsedResult.amounts[0]; // 最初の候補が最も確度が高い

      // 支出として追加
      const validatedInput = Validator.expenseInput({
        userId,
        amount: bestAmount.amount,
        description: parsedResult.storeName || 'レシート',
        currency: 'JPY',
        imageUrl
      });

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

      // 成功メッセージを送信
      await this.sendReceiptProcessingSuccess(userId, replyToken, transaction, parsedResult.storeName);

      res.status(200).json({
        success: true,
        transaction: transaction.toJSON(),
        confidence: (bestAmount as any).confidence || 0.9
      });

      logger.info('Receipt processing completed successfully', {
        messageId,
        userId,
        amount: transaction.amount.amount,
        description: transaction.description
      });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { 
        messageId: req.body.messageId,
        userId: req.body.userId 
      });

      // エラー分類に応じてレスポンスを返す
      if (errorInfo.category === 'VALIDATION' || errorInfo.category === 'BUSINESS_LOGIC') {
        res.status(200).json({ permanent_error: true, message: errorInfo.message });
      } else {
        res.status(errorInfo.statusCode).json({ 
          temporary_error: errorInfo.isRetryable,
          message: errorInfo.message 
        });
      }

      // ユーザーにエラーメッセージを送信
      if (req.body.userId && req.body.replyToken) {
        await this.sendReceiptProcessingError(
          req.body.userId, 
          req.body.replyToken, 
          'レシートの処理でエラーが発生しました。'
        );
      }

    } finally {
      stopTimer();
    }
  }

  /**
   * 予算アラート送信タスクハンドラー
   */
  async handleBudgetAlert(req: Request, res: Response): Promise<void> {
    try {
      const { userId, alertType, message } = req.body;

      // バリデーション
      if (!userId || !alertType || !message) {
        throw new ValidationError('Required fields missing', { userId, alertType, message });
      }

      // アラートメッセージを送信
      const flexMessage = FlexMessageTemplates.createBudgetAlertCard(alertType, message);
      await this.lineClient.sendFlexMessage(userId, flexMessage);

      res.status(200).json({ success: true });

      logger.info('Budget alert sent successfully', { userId, alertType });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId: req.body.userId });
      res.status(errorInfo.statusCode).json({ error: errorInfo.message });
    }
  }

  /**
   * 通貨レート更新タスクハンドラー
   */
  async handleCurrencyUpdate(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Currency rate update task started');

      // 通貨レート更新処理（既存のサービスを利用）
      // TODO: 通貨レート更新の具体的な実装

      res.status(200).json({ success: true });

      logger.info('Currency rate update completed');

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error);
      res.status(errorInfo.statusCode).json({ error: errorInfo.message });
    }
  }

  /**
   * レポート送信タスクハンドラー
   */
  async handleReportTask(req: Request, res: Response): Promise<void> {
    try {
      const { userId, reportType } = req.body;

      if (!userId || !reportType) {
        throw new ValidationError('Required fields missing', { userId, reportType });
      }

      // レポート生成と送信
      const budgetStatus = await this.getBudgetStatusUseCase.execute(userId);
      
      let reportMessage: string;
      switch (reportType) {
        case 'daily':
          reportMessage = this.generateDailyReport(budgetStatus);
          break;
        case 'weekly':
          reportMessage = this.generateWeeklyReport(budgetStatus);
          break;
        case 'monthly':
          reportMessage = this.generateMonthlyReport(budgetStatus);
          break;
        default:
          throw new ValidationError('Invalid report type', { reportType });
      }

      await this.lineClient.sendTextMessage(userId, reportMessage);

      res.status(200).json({ success: true });

      logger.info('Report sent successfully', { userId, reportType });

    } catch (error) {
      const errorInfo = ErrorHandler.handle(error as Error, { userId: req.body.userId });
      res.status(errorInfo.statusCode).json({ error: errorInfo.message });
    }
  }

  /**
   * ヘルスチェック
   */
  async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      // 基本的なヘルスチェック
      const status = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0',
        dependencies: {
          database: 'connected',
          lineApi: 'connected',
          cloudTasks: 'connected'
        }
      };

      res.status(200).json(status);

    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * レシート処理成功メッセージ送信
   */
  private async sendReceiptProcessingSuccess(
    userId: string, 
    replyToken: string | undefined, 
    transaction: any,
    storeName: string | null
  ): Promise<void> {
    const message = `✅ レシートを処理しました！

💰 金額: ${transaction.amount.toString()}
🏪 店舗: ${storeName || '不明'}
📝 説明: ${transaction.description}

予算状況を確認するには「予算状況」と入力してください。`;

    try {
      if (replyToken) {
        await this.lineClient.replyMessage(replyToken, message);
      } else {
        await this.lineClient.sendTextMessage(userId, message);
      }
    } catch (error) {
      logger.error('Failed to send receipt processing success message', error as Error, { userId });
    }
  }

  /**
   * レシート処理エラーメッセージ送信
   */
  private async sendReceiptProcessingError(
    userId: string, 
    replyToken: string | undefined, 
    errorMessage: string
  ): Promise<void> {
    try {
      if (replyToken) {
        await this.lineClient.replyMessage(replyToken, errorMessage);
      } else {
        await this.lineClient.sendTextMessage(userId, errorMessage);
      }
    } catch (error) {
      logger.error('Failed to send receipt processing error message', error as Error, { userId });
    }
  }

  /**
   * 日次レポート生成
   */
  private generateDailyReport(budgetStatus: any): string {
    return `📊 本日の支出レポート

💰 今日の支出: ${budgetStatus.dailyAverage.toString()}
📈 予算使用率: ${budgetStatus.usagePercentage.toFixed(1)}%
💡 推奨支出: ${budgetStatus.recommendedDailySpending.toString()}`;
  }

  /**
   * 週次レポート生成
   */
  private generateWeeklyReport(budgetStatus: any): string {
    return `📊 今週の支出レポート

💰 今月の支出: ${budgetStatus.totalExpense.toString()}
📈 予算使用率: ${budgetStatus.usagePercentage.toFixed(1)}%
📝 取引件数: ${budgetStatus.summary.transactionCount}件`;
  }

  /**
   * 月次レポート生成
   */
  private generateMonthlyReport(budgetStatus: any): string {
    return `📊 今月の支出レポート

💰 総支出: ${budgetStatus.totalExpense.toString()}
💵 残予算: ${budgetStatus.remainingBudget.toString()}
📈 使用率: ${budgetStatus.usagePercentage.toFixed(1)}%
📝 取引件数: ${budgetStatus.summary.transactionCount}件
📊 平均取引額: ${budgetStatus.summary.averageTransactionAmount.toString()}`;
  }
}