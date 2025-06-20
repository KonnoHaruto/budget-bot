import { databaseService } from '../database/prisma';

export class ExchangeRateUpdateService {
  private readonly API_URL = 'https://api.exchangerate-api.com/v4/latest';
  private readonly SUPPORTED_CURRENCIES = [
    'USD', 'EUR', 'GBP', 'CNY', 'KRW', 'THB', 'SGD', 'MYR',
    'PHP', 'IDR', 'VND', 'TWD', 'HKD', 'AUD', 'CAD', 'CHF'
  ];

  async updateAllExchangeRates(): Promise<void> {
    console.log('🔄 Starting exchange rate update...');
    
    try {
      // JPYベースでレートを取得
      const response = await fetch(`${this.API_URL}/JPY`);
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json() as { rates: Record<string, number> };
      const rates = data.rates;

      // サポートしている通貨のレートを保存
      const updatePromises = this.SUPPORTED_CURRENCIES.map(async (currency) => {
        if (rates[currency]) {
          // JPY -> 外貨のレートなので、外貨 -> JPYに変換
          const jpyRate = 1 / rates[currency];
          await databaseService.saveExchangeRate(currency, 'JPY', jpyRate);
          console.log(`💱 Updated ${currency}/JPY rate: ${jpyRate.toFixed(4)}`);
        }
      });

      await Promise.all(updatePromises);
      
      console.log('✅ Exchange rate update completed successfully');
    } catch (error) {
      console.error('❌ Failed to update exchange rates:', error);
      console.log('📋 Using existing cached rates...');
    }
  }

  async getCachedExchangeRate(fromCurrency: string, toCurrency: string = 'JPY'): Promise<number | null> {
    try {
      const cachedRate = await databaseService.getExchangeRate(fromCurrency, toCurrency);
      
      if (!cachedRate) {
        console.log(`📈 No cached rate found for ${fromCurrency}/${toCurrency}`);
        return null;
      }

      // 12時間以上古いデータかチェック
      const now = new Date();
      const fetchedAt = new Date(cachedRate.fetchedAt);
      const hoursDiff = (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursDiff > 12) {
        console.log(`⏰ Cached rate for ${fromCurrency}/${toCurrency} is ${hoursDiff.toFixed(1)} hours old`);
      }

      console.log(`💰 Using cached rate ${fromCurrency}/${toCurrency}: ${cachedRate.rate.toFixed(4)}`);
      return cachedRate.rate;
    } catch (error) {
      console.error(`❌ Error getting cached rate for ${fromCurrency}/${toCurrency}:`, error);
      return null;
    }
  }

  async getLastUpdateTime(): Promise<Date | null> {
    try {
      return await databaseService.getLatestRateUpdate();
    } catch (error) {
      console.error('❌ Error getting last update time:', error);
      return null;
    }
  }

  async shouldUpdateRates(): Promise<boolean> {
    const lastUpdate = await this.getLastUpdateTime();
    
    if (!lastUpdate) {
      console.log('📊 No previous rate updates found, updating...');
      return true;
    }

    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
    
    // 8時間以上経過していれば更新
    const shouldUpdate = hoursSinceUpdate >= 8;
    
    if (shouldUpdate) {
      console.log(`🕐 Last update was ${hoursSinceUpdate.toFixed(1)} hours ago, updating rates...`);
    } else {
      console.log(`⏱️ Last update was ${hoursSinceUpdate.toFixed(1)} hours ago, skipping update`);
    }
    
    return shouldUpdate;
  }
}

export const exchangeRateUpdateService = new ExchangeRateUpdateService();