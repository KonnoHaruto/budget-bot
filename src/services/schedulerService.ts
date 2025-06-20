import { BudgetBot } from '../bot/budgetBot';
import { databaseService } from '../database/prisma';
import { exchangeRateUpdateService } from './exchangeRateUpdateService';

export class SchedulerService {
  private budgetBot: BudgetBot;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(budgetBot: BudgetBot) {
    this.budgetBot = budgetBot;
  }

  // 開始
  start(): void {
    this.stop(); // 既存のスケジューラーがあれば停止

    // 1分ごとにチェック（実際の運用では5分間隔でも十分）
    this.intervalId = setInterval(() => {
      this.checkAndSendWeeklyReport();
      this.checkAndUpdateExchangeRates();
    }, 60 * 1000); // 1分間隔

    console.log('📅 Scheduler started - Weekly reports will be sent every Monday at 6:00 AM JST');
    console.log('💱 Exchange rate updates will run 3 times per day (6:00, 12:00, 18:00 JST)');
    
    // 起動時に初回レート更新を実行
    this.performInitialExchangeRateUpdate();
  }

  // 停止
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('📅 Scheduler stopped');
    }
  }

  // 送信チェック
  private async checkAndSendWeeklyReport(): Promise<void> {
    try {
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000; // JST offset
      const jstNow = new Date(now.getTime() + jstOffset);

      // 月曜日かつ6時台かどうかチェック
      const dayOfWeek = jstNow.getDay(); // 0: 日曜日, 1: 月曜日
      const hour = jstNow.getHours();
      const minute = jstNow.getMinutes();

      // 月曜日の6:00-6:05の間に実行
      if (dayOfWeek === 1 && hour === 6 && minute < 5) {
        console.log('📊 Sending weekly trend reports...');
        await this.sendWeeklyReportsToAllUsers();
      }
    } catch (error) {
      console.error('❌ Error in weekly report scheduler:', error);
    }
  }

  // ユーザーにレポートを送信
  private async sendWeeklyReportsToAllUsers(): Promise<void> {
    try {
      // 全ユーザーを取得（今回は簡易実装）
      const users = await this.getAllUsers();
      
      for (const user of users) {
        try {
          await this.sendWeeklyReportToUser(user.lineUserId);
          // 各ユーザー間に少し間隔を空ける
          await this.delay(1000);
        } catch (error) {
          console.error(`❌ Failed to send weekly report to user ${user.lineUserId}:`, error);
        }
      }

      console.log(`✅ Weekly reports sent to ${users.length} users`);
    } catch (error) {
      console.error('❌ Error sending weekly reports:', error);
    }
  }

  // 特定のユーザーに送信
  private async sendWeeklyReportToUser(userId: string): Promise<void> {
    try {
      // 週間トレンドカード生成
      const weeklyTrendCard = await this.budgetBot.createWeeklyTrendCard(userId);
      
      if (weeklyTrendCard) {
        // メインの週間レポートメッセージ
        const reportMessage = '📅 毎週月曜日の週間支出レポートです！\n\n' +
          '先週の支出パターンを確認して、\n' +
          '今週の予算計画を立てましょう 💪';

        // 週間トレンドカードを送信
        await this.budgetBot.pushFlexMessage(userId, '📈 Weekly Spending Report', weeklyTrendCard);

        // 追加のアドバイスメッセージ
        // この部分はAIを導入したい
        const stats = await databaseService.getUserStats(userId);
        if (stats) {
          const adviceMessage = await this.generateWeeklyAdvice(userId, stats);
          await this.budgetBot.pushMessage(userId, adviceMessage);
        }

        // 週間目標メッセージを送信
        await this.budgetBot.pushMessage(userId, '今週も賢い支出を心がけましょう！🎯');

        console.log(`✅ Weekly report sent to user: ${userId}`);
      }
    } catch (error) {
      console.error(`❌ Error sending weekly report to user ${userId}:`, error);
    }
  }

  // アドバイスの生成
  // 後々AIを使用
  private async generateWeeklyAdvice(userId: string, stats: any): Promise<string> {
    try {
      const today = new Date();
      const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      // 先週の支出を計算（簡易版）
      const lastWeekSpent = await this.getWeekSpent(userId, lastWeek);
      const weeklyBudget = stats.monthlyBudget / 4; // 概算の週間予算
      
      let advice = '🤖 今週のアドバイス\n\n';
      
      if (lastWeekSpent > weeklyBudget * 1.2) {
        advice += '⚠️ 先週は予算をオーバーしました。\n' +
          '今週は支出を控えめにすることをお勧めします。\n\n';
      } else if (lastWeekSpent < weeklyBudget * 0.8) {
        advice += '✅ 先週は順調な支出でした！\n' +
          'この調子で今週も継続しましょう。\n\n';
      } else {
        advice += '📊 先週は適切な支出レベルでした。\n' +
          '今週も同じペースを維持しましょう。\n\n';
      }
      
      advice += `💡 今週の推奨予算: ¥${weeklyBudget.toLocaleString()}\n`;
      advice += `📈 先週の実績: ¥${lastWeekSpent.toLocaleString()}`;
      
      return advice;
    } catch (error) {
      console.error('Error generating weekly advice:', error);
      return '🤖 今週も計画的な支出を心がけましょう！';
    }
  }

  // 指定した州の支出を取得
  private async getWeekSpent(userId: string, weekStart: Date): Promise<number> {
    try {
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // TEST：その週の取引を合計
      const transactions = await databaseService.getRecentTransactions(userId, 100);
      return transactions
        .filter((t: any) => {
          const transactionDate = new Date(t.createdAt);
          return transactionDate >= weekStart && transactionDate < weekEnd;
        })
        .reduce((sum: number, t: any) => sum + t.amount, 0);
    } catch (error) {
      console.error('Error getting week spent:', error);
      return 0;
    }
  }

  // 全ユーザーを取得
  private async getAllUsers(): Promise<{ lineUserId: string }[]> {
    try {
      // Prismaを使って全ユーザーを取得
      // 翻案環境ではページネーションを使用
      const users = await databaseService.getAllUsers();
      return users.map(user => ({ lineUserId: user.lineUserId }));
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }

  // 遅延
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 手動レポート送信
  async sendTestWeeklyReport(userId: string): Promise<void> {
    console.log(`📧 Sending test weekly report to user: ${userId}`);
    await this.sendWeeklyReportToUser(userId);
  }

  // 為替レート更新チェック
  private async checkAndUpdateExchangeRates(): Promise<void> {
    try {
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000; // JST offset
      const jstNow = new Date(now.getTime() + jstOffset);

      const hour = jstNow.getHours();
      const minute = jstNow.getMinutes();

      // 6:00, 12:00, 18:00 の各時刻の00-05分の間に実行
      const targetHours = [6, 12, 18];
      if (targetHours.includes(hour) && minute < 5) {
        console.log(`💱 Updating exchange rates at ${hour}:${minute.toString().padStart(2, '0')} JST`);
        await exchangeRateUpdateService.updateAllExchangeRates();
      }
    } catch (error) {
      console.error('❌ Error in exchange rate update scheduler:', error);
    }
  }

  // 起動時の初回レート更新
  private async performInitialExchangeRateUpdate(): Promise<void> {
    try {
      console.log('🚀 Performing initial exchange rate update check...');
      const shouldUpdate = await exchangeRateUpdateService.shouldUpdateRates();
      
      if (shouldUpdate) {
        await exchangeRateUpdateService.updateAllExchangeRates();
      }
    } catch (error) {
      console.error('❌ Error in initial exchange rate update:', error);
    }
  }
}

export const schedulerService = new SchedulerService(new BudgetBot());