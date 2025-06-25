import { ImageAnnotatorClient } from '@google-cloud/vision';
const sharp = require('sharp');
import { CurrencyService, ParsedAmount } from './currencyService';
import { imageProcessor } from './ImageProcessor';

export class OCRService {
  private client: ImageAnnotatorClient | null;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = process.env.OCR_ENABLED !== 'false';
    
    if (this.isEnabled) {
      try {
        // Check if credentials are available
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS || 
            (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.GOOGLE_CLOUD_PRIVATE_KEY)) {
          this.client = new ImageAnnotatorClient();
          console.log('✅ Google Cloud Vision API initialized');
        } else {
          console.log('⚠️  Google Cloud Vision API credentials not found, OCR disabled');
          this.isEnabled = false;
          this.client = null;
        }
      } catch (error) {
        console.log('❌ Failed to initialize Google Cloud Vision API:', error);
        this.isEnabled = false;
        this.client = null;
      }
    } else {
      console.log('📝 OCR is disabled by configuration');
      this.client = null;
    }
  }

  // 軽量OCR処理（画像回転対応版）
  async extractTextFromImageLight(imageBuffer: Buffer, abortSignal?: AbortSignal): Promise<string> {
    if (!this.isEnabled || !this.client) {
      throw new Error('OCR service is not available. Please configure Google Cloud Vision API credentials.');
    }

    try {
      // Abort チェック
      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      console.log('🖼️ Starting light OCR with image orientation correction...');

      // 1. 画像の向きを自動修正
      const orientationCorrectedImage = await imageProcessor.autoRotateImage(imageBuffer);
      
      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      // 2. OCR用に最適化
      const optimizedImage = await imageProcessor.optimizeForOCR(orientationCorrectedImage, 'light');

      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      // 3. 品質診断（デバッグ用）
      const quality = await imageProcessor.diagnoseImageQuality(optimizedImage);
      console.log('📊 Image quality diagnosis:', quality);

      // 4. OCR実行
      const [result] = await this.client.textDetection({
        image: { content: optimizedImage },
        imageContext: {
          languageHints: ['ja', 'en'] // 日本語と英語に限定
        }
      });

      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      const detections = result.textAnnotations;
      if (!detections || detections.length === 0) {
        console.log('⚠️ No text detected, trying different orientations...');
        return await this.tryDifferentOrientations(imageBuffer, 'light', abortSignal);
      }

      console.log('✅ Light OCR completed successfully');
      return detections[0].description || '';
      
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }
      console.error('Light OCR Error:', error);
      throw new Error(`Failed to extract text from image (light): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // フルOCR処理（画像回転対応版）
  async extractTextFromImage(imageBuffer: Buffer, abortSignal?: AbortSignal): Promise<string> {
    if (!this.isEnabled || !this.client) {
      throw new Error('OCR service is not available. Please configure Google Cloud Vision API credentials.');
    }

    try {
      // Abort チェック
      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      console.log('🖼️ Starting full OCR with comprehensive image processing...');

      // 1. 画像の向きを自動修正
      const orientationCorrectedImage = await imageProcessor.autoRotateImage(imageBuffer);
      
      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      // 2. OCR用に最適化（フル処理）
      const optimizedImage = await imageProcessor.optimizeForOCR(orientationCorrectedImage, 'full');

      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      // 3. 品質診断
      const quality = await imageProcessor.diagnoseImageQuality(optimizedImage);
      console.log('📊 Image quality diagnosis:', quality);

      // 4. OCR実行
      const [result] = await this.client.textDetection({
        image: { content: optimizedImage }
      });

      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }

      const detections = result.textAnnotations;
      if (!detections || detections.length === 0) {
        console.log('⚠️ No text detected, trying different orientations...');
        return await this.tryDifferentOrientations(imageBuffer, 'full', abortSignal);
      }

      console.log('✅ Full OCR completed successfully');
      return detections[0].description || '';
      
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new Error('OCR processing aborted');
      }
      console.error('OCR Error:', error);
      throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }


  /**
   * 複数の向きでOCRを試行
   */
  private async tryDifferentOrientations(imageBuffer: Buffer, mode: 'light' | 'full', abortSignal?: AbortSignal): Promise<string> {
    console.log('🔄 Trying different image orientations...');
    
    const rotationAngles = [90, 180, 270];
    
    for (const angle of rotationAngles) {
      try {
        if (abortSignal?.aborted) {
          throw new Error('OCR processing aborted');
        }
        
        console.log(`📐 Trying rotation: ${angle}°`);
        
        // 指定角度で回転
        const rotatedBuffer = await sharp(imageBuffer).rotate(angle).toBuffer();
        
        // OCR用に最適化
        const optimizedImage = await imageProcessor.optimizeForOCR(rotatedBuffer, mode);
        
        // OCR実行
        const [result] = await this.client!.textDetection({
          image: { content: optimizedImage },
          imageContext: {
            languageHints: ['ja', 'en']
          }
        });
        
        const detections = result.textAnnotations;
        if (detections && detections.length > 0 && detections[0].description) {
          console.log(`✅ Text detected with ${angle}° rotation`);
          return detections[0].description;
        }
        
      } catch (error) {
        console.error(`❌ Failed OCR with ${angle}° rotation:`, error);
        continue;
      }
    }
    
    throw new Error('No text detected in any orientation');
  }

  /**
   * 統合されたOCR処理メソッド（v2アーキテクチャ用）
   */
  async processImage(imageUrl: string): Promise<{
    success: boolean;
    result?: {
      text: string;
      confidence: number;
    };
    error?: string;
  }> {
    try {
      // URLから画像データを取得
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      
      // OCR処理を実行
      const text = await this.extractTextFromImage(imageBuffer);
      
      return {
        success: true,
        result: {
          text,
          confidence: 0.9 // デフォルト信頼度
        }
      };
    } catch (error) {
      console.error('OCR processing failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  parseReceiptInfo(text: string): {
    amounts: ParsedAmount[];
    storeName: string | null;
    items: string[];
  } {
    // 通貨サービスを使用して金額と通貨を解析
    const amounts = CurrencyService.parseAmountWithCurrency(text);
    
    // 店名の抽出
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const storeName = lines.length > 0 ? lines[0].trim() : null;

    // アイテム名の抽出
    const items = lines
      .filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 2 && 
               !trimmed.match(/^[\d\s\¥\\$,.-]+$/) && 
               !trimmed.match(/合計|小計|総額|計|total|subtotal/i); 
      })
      .slice(1, 6); 

    return {
      amounts,
      storeName,
      items
    };
  }
}

export const ocrService = new OCRService();