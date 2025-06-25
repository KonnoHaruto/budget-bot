import * as line from '@line/bot-sdk';
import { ocrService } from './ocrService';
import { CurrencyService, ParsedAmount } from './currencyService';
import { advancedReceiptParser, ReceiptAnalysisResult } from './AdvancedReceiptParser';

// レシート処理の結果
export interface ReceiptProcessingResult {
  amounts: ParsedAmount[];
  storeName: string | null;
  items: string[];
  confidence?: number;
  analysisResult?: ReceiptAnalysisResult;
}

// 為替変換後の結果
export interface CurrencyConversionResult {
  mainAmount: ParsedAmount;
  conversionResult: {
    convertedAmount: number;
    rate?: number;
  };
}

// レシート処理の共通サービス
export class ReceiptProcessingService {
  // LINEメッセージから画像Bufferを取得
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

  // テキストからレシート解析（v2アーキテクチャ用）
  async parseReceipt(text: string): Promise<{
    success: boolean;
    amounts: ParsedAmount[];
    storeName: string | null;
  }> {
    try {
      console.log('🔍 Parsing receipt text with advanced parser...');
      
      // 高度な解析を実行
      const analysisResult = advancedReceiptParser.parseReceipt(text);
      
      // 結果を最適化
      const optimizedResult = this.optimizeResults(analysisResult);
      
      return {
        success: true,
        amounts: optimizedResult.amounts,
        storeName: optimizedResult.storeName
      };
    } catch (error) {
      console.error('Receipt parsing failed:', error);
      return {
        success: false,
        amounts: [],
        storeName: null
      };
    }
  }

  // OCRを使用してレシート処理
  async processReceiptWithOCR(
    imageBuffer: Buffer, 
    mode: 'light' | 'full', 
    abortSignal?: AbortSignal
  ): Promise<ReceiptProcessingResult> {
    console.log(`🔍 Starting ${mode} OCR processing with advanced parser...`);
    
    // 1. OCRでテキスト抽出
    const extractedText = mode === 'light' 
      ? await ocrService.extractTextFromImageLight(imageBuffer, abortSignal)
      : await ocrService.extractTextFromImage(imageBuffer, abortSignal);
    
    console.log('📝 OCR extracted text preview:', extractedText.substring(0, 200) + '...');
    
    // 2. 高度な解析を実行
    const analysisResult = advancedReceiptParser.parseReceipt(extractedText);
    
    // 3. 結果を最適化
    const optimizedResult = this.optimizeResults(analysisResult);
    
    console.log('✅ Advanced OCR processing completed:', {
      confidence: optimizedResult.confidence,
      amountsFound: optimizedResult.amounts.length,
      storeName: optimizedResult.storeName,
      receiptType: analysisResult.receiptType
    });
    
    return optimizedResult;
  }
  
  // 解析結果を最適化
  private optimizeResults(analysisResult: ReceiptAnalysisResult): ReceiptProcessingResult {
    let amounts: ParsedAmount[] = [];
    
    // 合計金額が見つかった場合は、それを最優先
    if (analysisResult.totalAmount) {
      amounts = [analysisResult.totalAmount];
      console.log('🎯 Using identified total amount:', analysisResult.totalAmount.amount);
    } else if (analysisResult.allAmounts.length > 0) {
      // 合計が見つからない場合は最大金額を使用
      amounts = [analysisResult.allAmounts.reduce((max, current) => 
        current.amount > max.amount ? current : max
      )];
      console.log('📊 Using maximum amount as fallback:', amounts[0].amount);
    } else {
      throw new Error('No amounts found in receipt');
    }
    
    return {
      amounts,
      storeName: analysisResult.storeName,
      items: analysisResult.items,
      confidence: analysisResult.confidence,
      analysisResult
    };
  }

  // 主要金額を為替変換（高度解析結果を使用）
  async processAmountsWithCurrency(amounts: ParsedAmount[]): Promise<CurrencyConversionResult> {
    if (amounts.length === 0) {
      throw new Error('No amounts to process');
    }

    // 高度解析により既に最適な金額が選択されているため、最初の金額を使用
    const mainAmount = amounts[0];
    
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

  // レシート処理の完全なワークフロー（OCR → 為替変換）
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

  // 処理完了時のログ出力
  logProcessingResult(
    mode: 'light' | 'full',
    receiptInfo: ReceiptProcessingResult,
    currencyResult: CurrencyConversionResult
  ): void {
    console.log(`✅ ${mode} OCR processing completed with enhanced accuracy:`);
    console.log(`💰 Found ${receiptInfo.amounts.length} amounts`);
    console.log(`🏪 Store: ${receiptInfo.storeName || 'Unknown'}`);
    console.log(`💱 Main amount: ${currencyResult.mainAmount.amount} ${currencyResult.mainAmount.currency.code}`);
    console.log(`¥ Converted amount: ¥${currencyResult.conversionResult.convertedAmount.toLocaleString()}`);
    
    if (receiptInfo.confidence) {
      console.log(`📈 Analysis confidence: ${(receiptInfo.confidence * 100).toFixed(1)}%`);
    }
    
    if (receiptInfo.analysisResult) {
      const details = receiptInfo.analysisResult.analysisDetails;
      console.log(`📋 Analysis details:`, {
        receiptType: receiptInfo.analysisResult.receiptType,
        totalKeywords: details.totalKeywords,
        subtotalFound: details.subtotalFound,
        taxFound: details.taxFound
      });
    }
    
    if (currencyResult.conversionResult.rate) {
      console.log(`📊 Exchange rate: ${currencyResult.conversionResult.rate}`);
    }
  }

  // エラーハンドリングのヘルパーメソッド
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