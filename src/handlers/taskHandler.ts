import { Request, Response } from 'express';
import { BudgetBot } from '../bot/budgetBot';
import { ocrService } from '../services/ocrService';
import { CurrencyService, ParsedAmount } from '../services/currencyService';
import { ReceiptProcessingTask, CurrencyConversionTask } from '../services/cloudTasksService';

export class TaskHandler {
  private budgetBot: BudgetBot;

  constructor(budgetBot: BudgetBot) {
    this.budgetBot = budgetBot;
  }

  /**
   * レシート処理タスクのハンドラー
   */
  async handleReceiptProcessing(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      console.log('📝 Received receipt processing task:', body);

      if (body.type !== 'receipt_processing') {
        res.status(400).json({ error: 'Invalid task type' });
        return;
      }

      const taskData: ReceiptProcessingTask = body.data;
      console.log(`🔍 Processing receipt for user: ${taskData.userId}, messageId: ${taskData.messageId}`);

      await this.processReceiptImage(taskData.userId, taskData.messageId);

      res.status(200).json({ 
        success: true, 
        message: 'Receipt processing completed',
        userId: taskData.userId,
        messageId: taskData.messageId
      });

    } catch (error) {
      console.error('❌ Receipt processing task failed:', error);
      
      // エラーの場合もユーザーに通知
      if (req.body?.data?.userId) {
        try {
          await this.budgetBot.pushMessage(
            req.body.data.userId,
            '❌ レシートの処理中にエラーが発生しました。手動で金額を入力してください。'
          );
        } catch (pushError) {
          console.error('❌ Failed to send error message to user:', pushError);
        }
      }

      res.status(500).json({ 
        error: 'Receipt processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 通貨変換処理タスクのハンドラー
   */
  async handleCurrencyConversion(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      console.log('💱 Received currency conversion task:', body);

      if (body.type !== 'currency_conversion') {
        res.status(400).json({ error: 'Invalid task type' });
        return;
      }

      const taskData: CurrencyConversionTask = body.data;
      console.log(`💰 Processing currency conversion for user: ${taskData.userId}`);

      await this.processCurrencyConversion(taskData.userId, taskData.amounts, taskData.storeName);

      res.status(200).json({ 
        success: true, 
        message: 'Currency conversion completed',
        userId: taskData.userId
      });

    } catch (error) {
      console.error('❌ Currency conversion task failed:', error);
      
      // エラーの場合もユーザーに通知
      if (req.body?.data?.userId) {
        try {
          await this.budgetBot.pushMessage(
            req.body.data.userId,
            '❌ 通貨変換の処理中にエラーが発生しました。再度お試しください。'
          );
        } catch (pushError) {
          console.error('❌ Failed to send error message to user:', pushError);
        }
      }

      res.status(500).json({ 
        error: 'Currency conversion failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 実際のレシート処理ロジック
   */
  private async processReceiptImage(userId: string, messageId: string): Promise<void> {
    try {
      console.log(`📷 Starting image processing for user: ${userId}, messageId: ${messageId}`);

      // LINE画像コンテンツを取得
      const stream = await this.budgetBot.getBlobClient().getMessageContent(messageId);
      
      // ストリームをバッファに変換
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const imageBuffer = Buffer.concat(chunks);
      console.log(`📦 Image buffer size: ${imageBuffer.length} bytes`);

      // OCRで文字認識
      console.log('🔍 Extracting text from image...');
      const extractedText = await ocrService.extractTextFromImage(imageBuffer);
      console.log('📝 Extracted text:', extractedText.substring(0, 200) + '...');

      const receiptInfo = ocrService.parseReceiptInfo(extractedText);
      console.log('💰 Parsed receipt info:', receiptInfo);

      if (receiptInfo.amounts && receiptInfo.amounts.length > 0) {
        console.log(`💱 Found ${receiptInfo.amounts.length} amounts, processing...`);
        await this.processCurrencyConversion(userId, receiptInfo.amounts, receiptInfo.storeName || undefined);
      } else {
        console.log('⚠️ No amounts found in receipt');
        await this.budgetBot.pushMessage(
          userId, 
          '⚠️ レシートから金額を読み取れませんでした。\n手動で金額を入力してください。\n例: "1500" または "1500円"'
        );
      }

    } catch (error) {
      console.error('❌ Receipt image processing error:', error);
      throw error;
    }
  }

  /**
   * 通貨変換処理ロジック
   */
  private async processCurrencyConversion(userId: string, amounts: ParsedAmount[], storeName?: string): Promise<void> {
    try {
      console.log(`💱 Starting currency conversion for ${amounts.length} amounts`);

      // 最大金額を選択
      const mainAmount = amounts.sort((a, b) => b.amount - a.amount)[0];
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
      const token = await this.budgetBot.generateExpenseToken(userId);

      // 保留中取引として保存
      await this.budgetBot.savePendingTransaction(userId, {
        userId,
        parsedAmounts: [mainAmount],
        storeName: storeName || null,
        timestamp: Date.now()
      });
      console.log('💾 Pending transaction saved');
      
      // Flex Messageで確認画面を送信
      const confirmationCard = await this.budgetBot.createConfirmationCard(
        conversionResult.convertedAmount,
        mainAmount.currency.code !== 'JPY' ? mainAmount.amount : undefined,
        mainAmount.currency.code !== 'JPY' ? mainAmount.currency.code : undefined,
        mainAmount.currency.code !== 'JPY' ? conversionResult.rate : undefined,
        storeName || undefined,
        token
      );
      
      console.log('📤 Sending confirmation flex message...');
      await this.budgetBot.pushFlexMessage(userId, '💰 支出確認', confirmationCard);
      console.log('✅ Receipt processing completed successfully');
      
    } catch (error) {
      console.error('❌ Currency conversion processing error:', error);
      throw error;
    }
  }

  /**
   * 汎用タスクハンドラー
   */
  async handleGenericTask(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      const taskType = req.params.taskType;
      
      console.log(`🔄 Received ${taskType} task:`, body);

      // タスクタイプに応じて処理を分岐
      switch (taskType) {
        case 'receipt-processing':
          await this.handleReceiptProcessing(req, res);
          break;
        case 'currency-conversion':
          await this.handleCurrencyConversion(req, res);
          break;
        default:
          res.status(400).json({ error: `Unknown task type: ${taskType}` });
          return;
      }

    } catch (error) {
      console.error(`❌ Generic task handler failed for ${req.params.taskType}:`, error);
      res.status(500).json({ 
        error: 'Task processing failed',
        taskType: req.params.taskType,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * タスク処理の健全性チェック
   */
  async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'task-handler'
      });
    } catch (error) {
      res.status(500).json({ 
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export default TaskHandler;