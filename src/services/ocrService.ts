import { ImageAnnotatorClient } from '@google-cloud/vision';
const sharp = require('sharp');
import { CurrencyService, ParsedAmount } from './currencyService';

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

  async extractTextFromImage(imageBuffer: Buffer): Promise<string> {
    if (!this.isEnabled || !this.client) {
      throw new Error('OCR service is not available. Please configure Google Cloud Vision API credentials.');
    }

    try {
      // 画像の調整
      const optimizedImage = await sharp(imageBuffer)
        .resize(1200, 1600, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      // 画像認識
      const [result] = await this.client.textDetection({
        image: { content: optimizedImage }
      });

      const detections = result.textAnnotations;
      if (!detections || detections.length === 0) {
        throw new Error('No text detected in image');
      }

      return detections[0].description || '';
    } catch (error) {
      console.error('OCR Error:', error);
      throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  parseReceiptAmount(text: string): number | null {
    const patterns = [
      // 日本
      /合計[：:\s]*[\¥\\]?([0-9,]+)/i,
      /小計[：:\s]*[\¥\\]?([0-9,]+)/i,
      /総額[：:\s]*[\¥\\]?([0-9,]+)/i,
      /計[：:\s]*[\¥\\]?([0-9,]+)/i,
      // 英語
      /total[：:\s]*[\¥\\$]?([0-9,]+)/i,
      /subtotal[：:\s]*[\¥\\$]?([0-9,]+)/i,
      // その他
      /[\¥\\$]\s*([0-9,]+)/g,
      /([0-9,]+)\s*円/g
    ];

    const amounts: number[] = [];

    for (const pattern of patterns) {
      if (pattern.global) {
        const matches = Array.from(text.matchAll(pattern));
        for (const match of matches) {
          const amountStr = match[1].replace(/,/g, '');
          const amount = parseInt(amountStr, 10);
          if (!isNaN(amount) && amount > 0) {
            amounts.push(amount);
          }
        }
      } else {
        const match = text.match(pattern);
        if (match && match[1]) {
          const amountStr = match[1].replace(/,/g, '');
          const amount = parseInt(amountStr, 10);
          if (!isNaN(amount) && amount > 0) {
            amounts.push(amount);
          }
        }
      }
    }

    if (amounts.length === 0) {
      return null;
    }

    // 最大値を返す(TODO:精度の決め手なのでロジックは今後変更)
    return Math.max(...amounts);
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