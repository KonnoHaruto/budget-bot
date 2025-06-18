export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  rate?: number;
}

export interface ParsedAmount {
  amount: number;
  currency: CurrencyInfo;
  originalText: string;
  convertedAmount?: number; // JPY equivalent
}

export interface ExchangeRateResponse {
  rates: Record<string, number>;
  base: string;
  date: string;
}

export class CurrencyService {
  private static readonly CURRENCIES: CurrencyInfo[] = [
    // 日本
    { code: 'JPY', symbol: '¥', name: '日本円' },
    { code: 'JPY', symbol: '円', name: '日本円' },
    
    // 主要通貨
    { code: 'USD', symbol: '$', name: 'アメリカドル' },
    { code: 'USD', symbol: 'USD', name: 'アメリカドル' },
    { code: 'EUR', symbol: '€', name: 'ユーロ' },
    { code: 'EUR', symbol: 'EUR', name: 'ユーロ' },
    { code: 'GBP', symbol: '£', name: 'ポンド' },
    { code: 'GBP', symbol: 'GBP', name: 'ポンド' },
    
    // アジア通貨
    { code: 'CNY', symbol: '¥', name: '中国元' },
    { code: 'CNY', symbol: '元', name: '中国元' },
    { code: 'CNY', symbol: 'CNY', name: '中国元' },
    { code: 'KRW', symbol: '₩', name: '韓国ウォン' },
    { code: 'KRW', symbol: 'KRW', name: '韓国ウォン' },
    { code: 'KRW', symbol: '원', name: '韓国ウォン' },
    { code: 'THB', symbol: '฿', name: 'タイバーツ' },
    { code: 'THB', symbol: 'THB', name: 'タイバーツ' },
    { code: 'SGD', symbol: 'S$', name: 'シンガポールドル' },
    { code: 'SGD', symbol: 'SGD', name: 'シンガポールドル' },
    { code: 'PHP', symbol: '₱', name: 'フィリピンペソ' },
    { code: 'PHP', symbol: 'PHP', name: 'フィリピンペソ' },
    { code: 'VND', symbol: '₫', name: 'ベトナムドン' },
    { code: 'VND', symbol: 'VND', name: 'ベトナムドン' },
    { code: 'IDR', symbol: 'Rp', name: 'インドネシアルピア' },
    { code: 'IDR', symbol: 'IDR', name: 'インドネシアルピア' },
    { code: 'MYR', symbol: 'RM', name: 'マレーシアリンギット' },
    { code: 'MYR', symbol: 'MYR', name: 'マレーシアリンギット' },
    
    // その他
    { code: 'AUD', symbol: 'A$', name: 'オーストラリアドル' },
    { code: 'AUD', symbol: 'AUD', name: 'オーストラリアドル' },
    { code: 'CAD', symbol: 'C$', name: 'カナダドル' },
    { code: 'CAD', symbol: 'CAD', name: 'カナダドル' },
    { code: 'CHF', symbol: 'CHF', name: 'スイスフラン' },
    { code: 'INR', symbol: '₹', name: 'インドルピー' },
    { code: 'INR', symbol: 'INR', name: 'インドルピー' }
  ];

  /**
   * テキストから通貨記号と金額を解析
   */
  static parseAmountWithCurrency(text: string): ParsedAmount[] {
    const results: ParsedAmount[] = [];
    
    for (const currency of this.CURRENCIES) {
      const patterns = this.getCurrencyPatterns(currency);
      
      for (const pattern of patterns) {
        const matches = Array.from(text.matchAll(pattern));
        
        for (const match of matches) {
          const amountStr = match[1] || match[2];
          if (amountStr) {
            const amount = this.parseNumberString(amountStr);
            if (amount > 0) {
              results.push({
                amount,
                currency,
                originalText: match[0]
              });
            }
          }
        }
      }
    }
    
    const uniqueResults = this.removeDuplicates(results);
    return uniqueResults.sort((a, b) => b.amount - a.amount);
  }

  /**
   * リアルタイム為替レートを取得
   */
  static async getExchangeRate(fromCurrency: string, toCurrency: string = 'JPY'): Promise<number> {
    if (fromCurrency === toCurrency) return 1;
    
    try {
      // 為替レートAPI (ExchangeRate-API) を使用
      const url = `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`;
      
      const response = await fetch(url);
      const data = await response.json() as ExchangeRateResponse;
      
      if (data.rates && data.rates[toCurrency]) {
        return data.rates[toCurrency];
      }
      
      throw new Error(`Exchange rate not found for ${fromCurrency} to ${toCurrency}`);
    } catch (error) {
      console.error('Exchange rate API error:', error);
      
      // フォールバック: 固定レーと（2024年度）
      return this.getFallbackRate(fromCurrency, toCurrency);
    }
  }

  /**
   * フォールバック用の固定レート
   */
  private static getFallbackRate(fromCurrency: string, toCurrency: string = 'JPY'): number {
    const rates: Record<string, number> = {
      'JPY': 1,
      'USD': 150,
      'EUR': 160,
      'GBP': 190,
      'CNY': 20,
      'KRW': 0.11,
      'THB': 4.2,
      'SGD': 110,
      'MYR': 32,
      'IDR': 0.01,
      'PHP': 2.7,
      'VND': 0.006,
      'AUD': 100,
      'CAD': 110,
      'CHF': 165,
      'INR': 1.8
    };
    
    return rates[fromCurrency] || 1;
  }

  /**
   * 金額を日本円に変換
   */
  static async convertToJPY(amount: number, fromCurrency: string): Promise<{
    convertedAmount: number;
    rate: number;
    isRealTime: boolean;
  }> {
    if (fromCurrency === 'JPY') {
      return {
        convertedAmount: amount,
        rate: 1,
        isRealTime: true
      };
    }
    
    try {
      const rate = await this.getExchangeRate(fromCurrency, 'JPY');
      return {
        convertedAmount: Math.round(amount * rate),
        rate,
        isRealTime: true
      };
    } catch (error) {
      const fallbackRate = this.getFallbackRate(fromCurrency, 'JPY');
      return {
        convertedAmount: Math.round(amount * fallbackRate),
        rate: fallbackRate,
        isRealTime: false
      };
    }
  }

  /**
   * 通貨別の正規表現パターン
   */
  private static getCurrencyPatterns(currency: CurrencyInfo): RegExp[] {
    const symbol = this.escapeRegExp(currency.symbol);
    
    return [
      // 記号 + 数値 (例: $100, ¥1500)
      new RegExp(`${symbol}\\s*([0-9,]+(?:\\.[0-9]{1,2})?)`, 'gi'),
      
      // 数値 + 記号 (例: 100$, 1500円)
      new RegExp(`([0-9,]+(?:\\.[0-9]{1,2})?)\\s*${symbol}`, 'gi'),
      
      // 合計/総額 + 記号 + 数値
      new RegExp(`(?:合計|小計|総額|total|subtotal)[：:\\s]*${symbol}\\s*([0-9,]+(?:\\.[0-9]{1,2})?)`, 'gi'),
      
      // 数値 + 記号 + 合計/総額
      new RegExp(`([0-9,]+(?:\\.[0-9]{1,2})?)\\s*${symbol}\\s*(?:合計|小計|総額|total|subtotal)`, 'gi')
    ];
  }

  /**
   * 数値文字列を数値に変換
   */
  private static parseNumberString(str: string): number {
    const cleaned = str.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 重複の除去
   */
  private static removeDuplicates(results: ParsedAmount[]): ParsedAmount[] {
    const seen = new Set<string>();
    return results.filter(result => {
      const key = `${result.amount}-${result.currency.code}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * 正規表現用の文字列エスケープ
   */
  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 通貨コードから通貨情報を取得
   */
  static getCurrencyByCode(code: string): CurrencyInfo | undefined {
    return this.CURRENCIES.find(c => c.code === code);
  }

  /**
   * 通貨が日本円以外かのチェック
   */
  static isNonJPYCurrency(currencyCode: string): boolean {
    return currencyCode !== 'JPY';
  }
}

export const currencyService = new CurrencyService();