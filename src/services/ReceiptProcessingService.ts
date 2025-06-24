import * as line from '@line/bot-sdk';
import { ocrService } from './ocrService';
import { CurrencyService, ParsedAmount } from './currencyService';

/**
 * レシート処理の結果
 */
export interface ReceiptProcessingResult {
  amounts: ParsedAmount[];
  storeName: string | null;
  items: string[];
}

/**
 * 為替変換後の結果
 */
export interface CurrencyConversionResult {
  mainAmount: ParsedAmount;
  conversionResult: {
    convertedAmount: number;
    rate?: number;
  };
}

/**
 * レシート処理の共通サービス
 */
export class ReceiptProcessingService {
  /**
   * LINEメッセージから画像Bufferを取得
   */
  async getImageBufferFromLineMessage(
    messageId: string, 
    blobClient: line.messagingApi.MessagingApiBlobClient
  ): Promise<Buffer> {
    const stream = await blobClient.getMessageContent(messageId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * OCRを使用してレシート処理を実行
   */
  async processReceiptWithOCR(
    imageBuffer: Buffer, 
    mode: 'light' | 'full', 
    abortSignal?: AbortSignal
  ): Promise<ReceiptProcessingResult> {
    const extractedText = mode === 'light' 
      ? await ocrService.extractTextFromImageLight(imageBuffer, abortSignal)
      : await ocrService.extractTextFromImage(imageBuffer, abortSignal);
    
    const receiptInfo = ocrService.parseReceiptInfo(extractedText);
    
    return {
      amounts: receiptInfo.amounts || [],
      storeName: receiptInfo.storeName || null,
      items: receiptInfo.items || []
    };
  }

  /**
   * 金額リストから最大金額を選択し、為替変換を実行
   */
  async processAmountsWithCurrency(amounts: ParsedAmount[]): Promise<CurrencyConversionResult> {
    if (amounts.length === 0) {
      throw new Error('No amounts to process');
    }

    // 最大の金額を選択（通常は合計金額）
    const mainAmount = amounts.sort((a, b) => b.amount - a.amount)[0];
    
    // 為替変換を実行
    const conversionResult = await CurrencyService.convertToJPY(
      mainAmount.amount, 
      mainAmount.currency.code
    );
    
    // 変換後の金額を設定
    mainAmount.convertedAmount = conversionResult.convertedAmount;
    
    return { 
      mainAmount, 
      conversionResult 
    };
  }

  /**
   * レシート処理の完全なワークフロー（OCR → 為替変換）
   */
  async processReceiptWorkflow(
    messageId: string,
    blobClient: line.messagingApi.MessagingApiBlobClient,
    mode: 'light' | 'full',
    abortSignal?: AbortSignal
  ): Promise<{
    receiptInfo: ReceiptProcessingResult;
    currencyResult: CurrencyConversionResult;
  }> {
    // 1. 画像取得
    const imageBuffer = await this.getImageBufferFromLineMessage(messageId, blobClient);

    // 2. OCR処理
    const receiptInfo = await this.processReceiptWithOCR(imageBuffer, mode, abortSignal);

    // 3. 金額がない場合はエラー
    if (receiptInfo.amounts.length === 0) {
      throw new Error('No amounts found in receipt');
    }

    // 4. 為替変換
    const currencyResult = await this.processAmountsWithCurrency(receiptInfo.amounts);

    return {
      receiptInfo,
      currencyResult
    };
  }

  /**
   * 処理完了時のログ出力
   */
  logProcessingResult(
    mode: 'light' | 'full',
    receiptInfo: ReceiptProcessingResult,
    currencyResult: CurrencyConversionResult
  ): void {
    console.log(`✅ ${mode} OCR processing completed:`);
    console.log(`💰 Found ${receiptInfo.amounts.length} amounts`);
    console.log(`🏪 Store: ${receiptInfo.storeName || 'Unknown'}`);
    console.log(`💱 Main amount: ${currencyResult.mainAmount.amount} ${currencyResult.mainAmount.currency.code}`);
    console.log(`¥ Converted amount: ¥${currencyResult.conversionResult.convertedAmount.toLocaleString()}`);
    
    if (currencyResult.conversionResult.rate) {
      console.log(`📊 Exchange rate: ${currencyResult.conversionResult.rate}`);
    }
  }

  /**
   * エラーハンドリングのヘルパーメソッド
   */
  handleProcessingError(error: any, context: string): {
    isTimeout: boolean;
    isNetworkError: boolean;
    message: string;
  } {
    const isTimeout = error.message?.includes('timeout') || error.name === 'TimeoutError';
    const isNetworkError = error.message?.includes('network') || error.message?.includes('ENOTFOUND');

    let message = '❌ 処理中にエラーが発生しました。手動で金額を入力してください。\n例: "1500" または "1500円"';

    if (isTimeout) {
      message = '⏰ 処理がタイムアウトしました。バックグラウンドで再試行しています...';
    } else if (isNetworkError) {
      message = '🌐 ネットワークエラーが発生しました。しばらく待ってから再試行してください。';
    }

    console.error(`❌ ${context} failed:`, error);

    return {
      isTimeout,
      isNetworkError,
      message
    };
  }
}

// シングルトンインスタンス
export const receiptProcessingService = new ReceiptProcessingService();