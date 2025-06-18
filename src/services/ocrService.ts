import { ImageAnnotatorClient } from '@google-cloud/vision';
import sharp from 'sharp';

export class OCRService {
  private client: ImageAnnotatorClient;

  constructor() {
    this.client = new ImageAnnotatorClient();
  }

  async extractTextFromImage(imageBuffer: Buffer): Promise<string> {
    try {
      // Optimize image for OCR
      const optimizedImage = await sharp(imageBuffer)
        .resize(1200, 1600, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      // Perform text detection
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
      throw new Error('Failed to extract text from image');
    }
  }

  parseReceiptAmount(text: string): number | null {
    const patterns = [
      // Japanese patterns
      /合計[：:\s]*[\¥\\]?([0-9,]+)/i,
      /小計[：:\s]*[\¥\\]?([0-9,]+)/i,
      /総額[：:\s]*[\¥\\]?([0-9,]+)/i,
      /計[：:\s]*[\¥\\]?([0-9,]+)/i,
      // English patterns
      /total[：:\s]*[\¥\\$]?([0-9,]+)/i,
      /subtotal[：:\s]*[\¥\\$]?([0-9,]+)/i,
      // General patterns
      /[\¥\\$]\s*([0-9,]+)/g,
      /([0-9,]+)\s*円/g
    ];

    const amounts: number[] = [];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const amountStr = match[1].replace(/,/g, '');
        const amount = parseInt(amountStr, 10);
        if (!isNaN(amount) && amount > 0) {
          amounts.push(amount);
        }
      }
    }

    if (amounts.length === 0) {
      return null;
    }

    // Return the largest amount found (likely to be the total)
    return Math.max(...amounts);
  }

  parseReceiptInfo(text: string): {
    amount: number | null;
    storeName: string | null;
    items: string[];
  } {
    const amount = this.parseReceiptAmount(text);
    
    // Extract store name (first few lines usually contain store info)
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const storeName = lines.length > 0 ? lines[0].trim() : null;

    // Extract potential item names (simple heuristic)
    const items = lines
      .filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 2 && 
               !trimmed.match(/^[\d\s\¥\\$,.-]+$/) && // Skip lines with only numbers/symbols
               !trimmed.match(/合計|小計|総額|計|total|subtotal/i); // Skip total lines
      })
      .slice(1, 6); // Take up to 5 items, skip first line (likely store name)

    return {
      amount,
      storeName,
      items
    };
  }
}

export const ocrService = new OCRService();