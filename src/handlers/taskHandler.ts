import { Request, Response } from 'express';
import { BudgetBot } from '../bot/budgetBot';
import { ocrService } from '../services/ocrService';
import { CurrencyService, ParsedAmount } from '../services/currencyService';
import { ReceiptProcessingTask, CurrencyConversionTask } from '../services/cloudTasksService';
import { processingTracker } from '../services/ProcessingTracker';

export class TaskHandler {
  private budgetBot: BudgetBot;

  constructor(budgetBot: BudgetBot) {
    this.budgetBot = budgetBot;
  }

  /**
   * レシート処理タスクのハンドラー
   */
  async handleReceiptProcessing(req: Request, res: Response): Promise<void> {
    let messageId: string | undefined;
    
    try {
      const body = req.body;
      console.log('📝 Received receipt processing task:', body);

      if (body.type !== 'receipt_processing') {
        res.status(400).json({ error: 'Invalid task type' });
        return;
      }

      const taskData: ReceiptProcessingTask = body.data;
      messageId = taskData.messageId;
      
      console.log(`🔍 Processing receipt for user: ${taskData.userId}, messageId: ${taskData.messageId}`);

      // 重複処理チェック
      console.log(`🔍 Checking processing status for message: ${taskData.messageId}`);
      const isAlreadyProcessed = processingTracker.isAlreadyProcessed(taskData.messageId);
      const isCurrentlyProcessing = processingTracker.isCurrentlyProcessing(taskData.messageId);
      
      console.log(`📊 Processing status: processed=${isAlreadyProcessed}, processing=${isCurrentlyProcessing}`);
      
      if (!processingTracker.markProcessingStart(taskData.messageId)) {
        console.log(`⚠️ Message ${taskData.messageId} is already processed or processing, skipping`);
        res.status(200).json({ 
          success: true, 
          message: 'Message already processed or processing',
          userId: taskData.userId,
          messageId: taskData.messageId,
          skipped: true
        });
        return;
      }
      
      console.log(`✅ Started processing message: ${taskData.messageId}`);

      await this.processReceiptImage(taskData.userId, taskData.messageId, taskData.replyToken);
      
      // 処理成功をマーク
      processingTracker.markProcessingComplete(taskData.messageId);

      res.status(200).json({ 
        success: true, 
        message: 'Receipt processing completed',
        userId: taskData.userId,
        messageId: taskData.messageId
      });

    } catch (error) {
      console.error('❌ Receipt processing task failed:', error);
      
      // 処理失敗をマーク
      if (messageId) {
        processingTracker.markProcessingFailed(messageId);
      }
      
      // エラーの場合もユーザーに通知
      if (req.body?.data?.userId) {
        const errorMessage = '❌ レシートの処理中にエラーが発生しました。手動で金額を入力してください。';
        const taskData = req.body.data;
        
        try {
          if (taskData.replyToken) {
            await this.budgetBot.replyMessage(taskData.replyToken, errorMessage);
          } else {
            await this.budgetBot.pushMessage(taskData.userId, errorMessage);
          }
        } catch (messageError) {
          console.error('❌ Failed to send error message to user:', messageError);
        }
      }

      // エラータイプによってHTTPステータスコードを分ける
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // 永続的なエラー（再試行不要）
      if (errorMessage.includes('No text detected') || 
          errorMessage.includes('Invalid image') ||
          errorMessage.includes('No amounts found') ||
          errorMessage.includes('Invalid reply token') ||
          errorMessage.includes('400 - Bad Request') ||
          errorMessage.includes('Too Many Requests') ||
          errorMessage.includes('monthly limit') ||
          errorMessage.includes('Failed to send any confirmation message')) {
        console.log('🚨 Permanent error detected, not retrying:', errorMessage);
        res.status(200).json({ 
          success: false,
          permanent_error: true,
          error: 'Receipt processing failed - permanent error',
          message: errorMessage
        });
      } else {
        // 一時的なエラー（再試行可能）
        console.log('⏰ Temporary error, will retry:', errorMessage);
        res.status(500).json({ 
          error: 'Receipt processing failed',
          message: errorMessage
        });
      }
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
  private async processReceiptImage(userId: string, messageId: string, replyToken?: string): Promise<void> {
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
        await this.processCurrencyConversion(userId, receiptInfo.amounts, receiptInfo.storeName || undefined, replyToken);
      } else {
        console.log('⚠️ No amounts found in receipt');
        const noAmountMessage = '⚠️ レシートから金額を読み取れませんでした。\n手動で金額を入力してください。\n例: "1500" または "1500円"';
        
        if (replyToken) {
          await this.budgetBot.replyMessage(replyToken, noAmountMessage);
        } else {
          await this.budgetBot.pushMessage(userId, noAmountMessage);
        }
      }

    } catch (error) {
      console.error('❌ Receipt image processing error:', error);
      throw error;
    }
  }

  /**
   * 通貨変換処理ロジック
   */
  private async processCurrencyConversion(userId: string, amounts: ParsedAmount[], storeName?: string, replyToken?: string): Promise<void> {
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
      
      if (replyToken) {
        // replyTokenが有効な場合はreply messageで送信（無料）
        try {
          await this.budgetBot.replyFlexMessage(replyToken, '💰 支出確認', confirmationCard);
          console.log('✅ Confirmation flex message sent as reply');
        } catch (replyError: any) {
          console.error('❌ Reply flex message failed, falling back to push:', replyError);
          
          // replyTokenが無効な場合、フォールバックとしてpush messageを試す
          try {
            await this.budgetBot.pushFlexMessage(userId, '💰 支出確認', confirmationCard);
            console.log('✅ Confirmation flex message sent as push (fallback)');
          } catch (pushError: any) {
            console.error('❌ Push flex message also failed, sending simple text:', pushError);
            
            // Flex messageも失敗した場合は、シンプルなテキストメッセージで通知
            const fallbackText = `💰 支出確認\n\n店舗: ${storeName || '不明'}\n金額: ¥${conversionResult.convertedAmount.toLocaleString()}\n\n追加しますか？\n「はい」または「いいえ」で回答してください。`;
            
            try {
              await this.budgetBot.pushMessage(userId, fallbackText);
              console.log('✅ Fallback text message sent successfully');
            } catch (textError: any) {
              console.error('❌ All message types failed:', textError);
              
              // LINE API制限の場合は保留中取引を削除（ユーザーに通知できないため）
              if (textError.status === 429 || textError.message?.includes('monthly limit')) {
                console.log('📈 LINE API limit reached, cleaning up pending transaction');
                // 保留中取引を削除（ユーザーが確認メッセージを受け取れないため）
                this.budgetBot.removePendingTransaction(userId);
                console.log('🗑️ Pending transaction removed due to message send failure');
                return; // エラーをthrowしない
              }
              
              // その他のエラーの場合
              console.log('⚠️ Skipping pending transaction cleanup due to message send failure');
              throw new Error('Failed to send any confirmation message to user');
            }
          }
        }
      } else {
        // replyTokenが無い場合はpush messageで送信
        try {
          await this.budgetBot.pushFlexMessage(userId, '💰 支出確認', confirmationCard);
          console.log('✅ Confirmation flex message sent as push');
        } catch (pushError: any) {
          console.error('❌ Push flex message failed, sending text fallback:', pushError);
          
          // Flex messageが失敗した場合のテキストフォールバック
          try {
            const fallbackText = `💰 支出確認\n\n店舗: ${storeName || '不明'}\n金額: ¥${conversionResult.convertedAmount.toLocaleString()}\n\n追加しますか？\n「はい」または「いいえ」で回答してください。`;
            await this.budgetBot.pushMessage(userId, fallbackText);
            console.log('✅ Fallback text message sent');
          } catch (textError: any) {
            console.error('❌ Push text message also failed:', textError);
            
            // LINE API制限の場合は保留中取引を削除
            if (textError.status === 429 || textError.message?.includes('monthly limit')) {
              console.log('📈 LINE API limit reached, cleaning up pending transaction');
              this.budgetBot.removePendingTransaction(userId);
              console.log('🗑️ Pending transaction removed due to message send failure');
              return; // エラーをthrowしない
            }
            
            throw textError; // その他のエラーは再スロー
          }
        }
      }
      
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