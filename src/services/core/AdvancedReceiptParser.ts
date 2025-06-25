import { CurrencyService, ParsedAmount, CurrencyInfo } from './currencyService';

// レシート解析結果
export interface ReceiptAnalysisResult {
  totalAmount: ParsedAmount | null;
  confidence: number;
  allAmounts: ParsedAmount[];
  storeName: string | null;
  items: string[];
  receiptType: 'receipt' | 'invoice' | 'unknown';
  analysisDetails: {
    totalKeywords: string[];
    subtotalFound: boolean;
    taxFound: boolean;
    discountFound: boolean;
  };
}

// レシート解析サービス
export class AdvancedReceiptParser {
  
  /**
   * メインの解析メソッド
   */
  parseReceipt(ocrText: string): ReceiptAnalysisResult {
    console.log('🔍 Starting advanced receipt analysis...');
    
    // 1. 基本的な前処理
    const cleanedText = this.preprocessText(ocrText);
    const lines = cleanedText.split('\n').filter(line => line.trim().length > 0);
    
    // 2. 全ての金額を抽出
    const allAmounts = this.extractAllAmounts(cleanedText);
    console.log(`💰 Found ${allAmounts.length} amounts:`, allAmounts.map(a => `${a.currency.symbol}${a.amount}`));
    
    // 3. レシートタイプを判定
    const receiptType = this.detectReceiptType(cleanedText);
    
    // 4. 合計金額を特定
    const totalCandidates = this.identifyTotalAmount(cleanedText, allAmounts, lines);
    
    // 5. 最適な合計金額を選択
    const bestTotal = this.selectBestTotal(totalCandidates, allAmounts);
    
    // 6. 店舗名を抽出
    const storeName = this.extractStoreName(lines);
    
    // 7. 商品アイテムを抽出
    const items = this.extractItems(lines, allAmounts);
    
    // 8. 分析詳細を作成
    const analysisDetails = this.createAnalysisDetails(cleanedText);
    
    const result: ReceiptAnalysisResult = {
      totalAmount: bestTotal,
      confidence: this.calculateConfidence(bestTotal, totalCandidates, allAmounts),
      allAmounts,
      storeName,
      items,
      receiptType,
      analysisDetails
    };
    
    console.log('✅ Receipt analysis completed:', {
      total: bestTotal ? `${bestTotal.currency.symbol}${bestTotal.amount}` : 'Not found',
      confidence: result.confidence,
      type: receiptType
    });
    
    return result;
  }
  
  // テキストの前処理
  private preprocessText(text: string): string {
    return text
      // Unicode正規化
      .normalize('NFKC')
      // 全角数字を半角に変換
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      // 全角記号を半角に変換
      .replace(/：/g, ':')
      .replace(/；/g, ';')
      // スペースの統一
      .replace(/\s+/g, ' ')
      // 不要な文字を除去
      .replace(/[\\u200B-\\u200D\\uFEFF]/g, '');
  }
  
  // 全ての金額を抽出
  private extractAllAmounts(text: string): ParsedAmount[] {
    const amounts: ParsedAmount[] = [];
    
    // 既存のCurrencyServiceを使用
    const basicAmounts = CurrencyService.parseAmountWithCurrency(text);
    amounts.push(...basicAmounts);
    
    // 追加の金額抽出パターン
    const additionalPatterns = [
      // 数字のみのパターン（行の終わりや特定の位置）
      /(?:^|\\s)([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)(?:\\s*$|\\s+(?:円|JPY|yen))/gmi,
      
      // 合計らしい行での数字（前後の文脈考慮）
      /(?:合計|小計|総額|計|total|subtotal|amount|sum).*?([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)/gi,
      
      // 税込み表記
      /(?:税込|税込み|including tax|incl\\. tax).*?([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)/gi,
      
      // レシート特有のフォーマット
      /(?:^|\\n)\\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)\\s*(?:円|\\*)?\\s*(?:$|\\n)/gm
    ];
    
    // 通貨情報の推定
    const estimatedCurrency = this.estimateCurrency(text);
    
    for (const pattern of additionalPatterns) {
      const matches = Array.from(text.matchAll(pattern));
      for (const match of matches) {
        const amountStr = match[1];
        const amount = this.parseNumber(amountStr);
        if (amount > 0 && amount < 10000000) { // 予想現実範囲
          amounts.push({
            amount,
            currency: estimatedCurrency,
            originalText: match[0].trim()
          });
        }
      }
    }
    
    // 重複除去と検証
    return this.deduplicateAndValidateAmounts(amounts);
  }
  
  // 通貨推定
  private estimateCurrency(text: string): CurrencyInfo {
    const currencyPatterns = [
      { pattern: /[¥円]/g, currency: { code: 'JPY', symbol: '¥', name: '日本円' } },
      { pattern: /[$USD]/g, currency: { code: 'USD', symbol: '$', name: 'アメリカドル' } },
      { pattern: /[€EUR]/g, currency: { code: 'EUR', symbol: '€', name: 'ユーロ' } },
      { pattern: /RM/g, currency: { code: 'MYR', symbol: 'RM', name: 'マレーシアリンギット' } },
      { pattern: /[₩원]/g, currency: { code: 'KRW', symbol: '₩', name: '韓国ウォン' } },
      { pattern: /฿/g, currency: { code: 'THB', symbol: '฿', name: 'タイバーツ' } }
    ];
    
    let maxCount = 0;
    let estimatedCurrency: CurrencyInfo = { code: 'JPY', symbol: '¥', name: '日本円' };
    
    for (const { pattern, currency } of currencyPatterns) {
      const matches = text.match(pattern);
      const count = matches ? matches.length : 0;
      if (count > maxCount) {
        maxCount = count;
        estimatedCurrency = currency;
      }
    }
    
    return estimatedCurrency;
  }
  
  // レシートタイプ判定
  private detectReceiptType(text: string): 'receipt' | 'invoice' | 'unknown' {
    const receiptKeywords = /レシート|receipt|領収書|お買い上げ|purchase|店舗|store/i;
    const invoiceKeywords = /請求書|invoice|bill|明細書|statement/i;
    
    if (receiptKeywords.test(text)) return 'receipt';
    if (invoiceKeywords.test(text)) return 'invoice';
    return 'unknown';
  }
  
  // 合計金額候補を特定
  private identifyTotalAmount(text: string, allAmounts: ParsedAmount[], lines: string[]): ParsedAmount[] {
    const totalCandidates: ParsedAmount[] = [];
    
    // アルゴリズム1: キーワードベース検索
    const keywordBasedTotals = this.findTotalByKeywords(text, allAmounts);
    totalCandidates.push(...keywordBasedTotals);
    
    // アルゴリズム2: 位置ベース分析
    const positionBasedTotals = this.findTotalByPosition(lines, allAmounts);
    totalCandidates.push(...positionBasedTotals);
    
    // アルゴリズム3: 金額の大きさ分析
    const sizeBasedTotals = this.findTotalBySize(allAmounts);
    totalCandidates.push(...sizeBasedTotals);
    
    // アルゴリズム4: 計算検証
    const calculatedTotals = this.findTotalByCalculation(allAmounts, text);
    totalCandidates.push(...calculatedTotals);
    
    // 重複除去
    return this.deduplicateAmounts(totalCandidates);
  }
  
  // キーワードベース合計検索
  private findTotalByKeywords(text: string, amounts: ParsedAmount[]): ParsedAmount[] {
    const totalKeywords = [
      '合計', '小計', '総額', '計', '総計',
      'total', 'subtotal', 'sum', 'amount',
      '税込', '税込み', 'including tax', 'incl. tax',
      'grand total', 'final amount', '最終金額'
    ];
    
    const candidates: ParsedAmount[] = [];
    
    for (const keyword of totalKeywords) {
      const pattern = new RegExp(`${keyword}.*?([0-9,]+(?:\\.[0-9]{1,2})?)`, 'gi');
      const matches = Array.from(text.matchAll(pattern));
      
      for (const match of matches) {
        const matchedAmount = this.parseNumber(match[1]);
        const foundAmount = amounts.find(a => Math.abs(a.amount - matchedAmount) < 0.01);
        
        if (foundAmount) {
          candidates.push({
            ...foundAmount,
            confidence: this.calculateKeywordConfidence(keyword)
          } as ParsedAmount);
        }
      }
    }
    
    return candidates;
  }
  
  // 位置ベース合計検索
  private findTotalByPosition(lines: string[], amounts: ParsedAmount[]): ParsedAmount[] {
    const candidates: ParsedAmount[] = [];
    
    // 最後の方の行で金額を探す
    const lastLines = lines.slice(-5); // 最後の5行
    
    for (const line of lastLines) {
      for (const amount of amounts) {
        if (line.includes(amount.originalText)) {
          // 位置による重み付け
          const lineIndex = lines.indexOf(line);
          const positionWeight = (lineIndex / lines.length) * 0.3; // 下の方ほど高スコア
          
          candidates.push({
            ...amount,
            confidence: 0.4 + positionWeight
          } as ParsedAmount);
        }
      }
    }
    
    return candidates;
  }
  
  // 金額サイズベース分析
  private findTotalBySize(amounts: ParsedAmount[]): ParsedAmount[] {
    if (amounts.length === 0) return [];
    
    // 最大金額と2番目に大きい金額を候補とする
    const sorted = [...amounts].sort((a, b) => b.amount - a.amount);
    const candidates: ParsedAmount[] = [];
    
    // 最大金額
    if (sorted[0]) {
      candidates.push({
        ...sorted[0],
        confidence: 0.6
      } as ParsedAmount);
    }
    
    // 2番目に大きい金額（最大との差が少ない場合）
    if (sorted[1] && sorted[0]) {
      const ratio = sorted[1].amount / sorted[0].amount;
      if (ratio > 0.8) { // 80%以上なら候補
        candidates.push({
          ...sorted[1],
          confidence: 0.4
        } as ParsedAmount);
      }
    }
    
    return candidates;
  }
  
  // 計算検証による合計検索
  private findTotalByCalculation(amounts: ParsedAmount[], text: string): ParsedAmount[] {
    const candidates: ParsedAmount[] = [];
    
    // 税率を検出
    const taxRate = this.detectTaxRate(text);
    
    for (const amount of amounts) {
      // この金額が税込み合計かチェック
      const pretaxAmount = amount.amount / (1 + taxRate);
      const potentialSubtotal = amounts.find(a => 
        Math.abs(a.amount - pretaxAmount) < amount.amount * 0.02 // 2%以内の誤差
      );
      
      if (potentialSubtotal) {
        candidates.push({
          ...amount,
          confidence: 0.8
        } as ParsedAmount);
      }
      
      // 複数金額の合計かチェック
      const smallerAmounts = amounts.filter(a => a.amount < amount.amount * 0.8);
      if (smallerAmounts.length >= 2) {
        const sum = smallerAmounts.reduce((sum, a) => sum + a.amount, 0);
        if (Math.abs(sum - amount.amount) < amount.amount * 0.05) {
          candidates.push({
            ...amount,
            confidence: 0.7
          } as ParsedAmount);
        }
      }
    }
    
    return candidates;
  }
  
  // 最適な合計金額を選択
  private selectBestTotal(candidates: ParsedAmount[], allAmounts: ParsedAmount[]): ParsedAmount | null {
    if (candidates.length === 0) {
      // フォールバック: 最大金額を返す
      if (allAmounts.length > 0) {
        const maxAmount = allAmounts.reduce((max, current) => 
          current.amount > max.amount ? current : max
        );
        console.log('📊 Fallback to maximum amount:', maxAmount.amount);
        return maxAmount;
      }
      return null;
    }
    
    // 信頼度でソート
    const sortedCandidates = candidates.sort((a, b) => 
      ((b as any).confidence || 0) - ((a as any).confidence || 0)
    );
    
    console.log('🎯 Total candidates with confidence:', 
      sortedCandidates.map(c => ({
        amount: c.amount,
        confidence: (c as any).confidence || 0
      }))
    );
    
    return sortedCandidates[0];
  }
  
  // 店舗名抽出
  private extractStoreName(lines: string[]): string | null {
    const topLines = lines.slice(0, 5);
    
    for (const line of topLines) {
      const trimmed = line.trim();
      
      // 金額や日付っぽくない、ある程度長い文字列
      if (trimmed.length >= 2 && 
          !trimmed.match(/^[\d\s\¥\\$€,.-]+$/) && 
          !trimmed.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/) &&
          !trimmed.match(/\d{1,2}:\d{2}/) &&
          !trimmed.match(/receipt|領収書|明細/i)) {
        return trimmed;
      }
    }
    
    return null;
  }
  
  // 商品アイテム抽出
  private extractItems(lines: string[], amounts: ParsedAmount[]): string[] {
    const items: string[] = [];
    const amountTexts = amounts.map(a => a.originalText);
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // アイテムらしい行の条件
      if (trimmed.length >= 2 && 
          trimmed.length <= 50 &&
          !trimmed.match(/^[\d\s\¥\\$€,.-]+$/) &&
          !trimmed.match(/合計|小計|総額|計|total|subtotal|tax|receipt|店舗|store/i) &&
          !trimmed.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/) &&
          !amountTexts.some(amountText => line.includes(amountText))) {
        
        items.push(trimmed);
        if (items.length >= 10) break; // 最大10個
      }
    }
    
    return items;
  }
  
  // ヘルパーメソッド群
  private parseNumber(str: string): number {
    const cleaned = str.replace(/[,\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  
  private calculateKeywordConfidence(keyword: string): number {
    const highConfidenceKeywords = ['合計', 'total', '総額', 'grand total'];
    const mediumConfidenceKeywords = ['小計', 'subtotal', '税込'];
    
    if (highConfidenceKeywords.some(k => keyword.toLowerCase().includes(k.toLowerCase()))) {
      return 0.9;
    }
    if (mediumConfidenceKeywords.some(k => keyword.toLowerCase().includes(k.toLowerCase()))) {
      return 0.7;
    }
    return 0.5;
  }
  
  private detectTaxRate(text: string): number {
    // 日本の消費税率を検出
    if (text.match(/10%|10\s*%|消費税.*10/)) return 0.1;
    if (text.match(/8%|8\s*%|消費税.*8/)) return 0.08;
    if (text.match(/5%|5\s*%|消費税.*5/)) return 0.05;
    
    
    return 0.1;
  }
  
  private deduplicateAmounts(amounts: ParsedAmount[]): ParsedAmount[] {
    const seen = new Set<string>();
    return amounts.filter(amount => {
      const key = `${amount.amount}-${amount.currency.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  private deduplicateAndValidateAmounts(amounts: ParsedAmount[]): ParsedAmount[] {
    // 重複除去
    const deduplicated = this.deduplicateAmounts(amounts);
    
    // 現実的でない金額を除去
    return deduplicated.filter(amount => 
      amount.amount > 0 && 
      amount.amount < 1000000 && // 100万以下
      amount.amount !== Math.floor(amount.amount / 1000) * 1000 // きりの良すぎる数字を除外
    );
  }
  
  private calculateConfidence(
    bestTotal: ParsedAmount | null, 
    candidates: ParsedAmount[], 
    allAmounts: ParsedAmount[]
  ): number {
    if (!bestTotal) return 0;
    
    let confidence = (bestTotal as any).confidence || 0.5;
    
    // 候補数によるボーナス
    if (candidates.length > 1) confidence += 0.1;
    
    // 全体の金額数による調整
    if (allAmounts.length >= 3) confidence += 0.1;
    if (allAmounts.length >= 5) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }
  
  private createAnalysisDetails(text: string): ReceiptAnalysisResult['analysisDetails'] {
    return {
      totalKeywords: this.findTotalKeywordsInText(text),
      subtotalFound: /小計|subtotal/i.test(text),
      taxFound: /税|tax/i.test(text),
      discountFound: /割引|discount|off/i.test(text)
    };
  }
  
  private findTotalKeywordsInText(text: string): string[] {
    const keywords = ['合計', '小計', '総額', 'total', 'subtotal', '税込'];
    return keywords.filter(keyword => 
      new RegExp(keyword, 'i').test(text)
    );
  }
}

export const advancedReceiptParser = new AdvancedReceiptParser();