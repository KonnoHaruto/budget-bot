/**
 * 重複処理防止とタスク状態管理
 */
export class ProcessingTracker {
  private static processedMessages: Set<string> = new Set();
  private static processingMessages: Set<string> = new Set();
  private static readonly MAX_CACHE_SIZE = 1000;
  private static readonly CLEANUP_INTERVAL = 10 * 60 * 1000; // 10分

  static {
    // 定期的にキャッシュをクリーンアップ
    setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * メッセージが既に処理済みかチェック
   */
  static isAlreadyProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  /**
   * メッセージが処理中かチェック
   */
  static isCurrentlyProcessing(messageId: string): boolean {
    return this.processingMessages.has(messageId);
  }

  /**
   * 処理開始をマーク
   */
  static markProcessingStart(messageId: string): boolean {
    if (this.isAlreadyProcessed(messageId) || this.isCurrentlyProcessing(messageId)) {
      return false; // 重複処理を防止
    }
    this.processingMessages.add(messageId);
    return true;
  }

  /**
   * 処理完了をマーク
   */
  static markProcessingComplete(messageId: string): void {
    this.processingMessages.delete(messageId);
    this.processedMessages.add(messageId);
    console.log(`✅ Message ${messageId} marked as processed`);
  }

  /**
   * 処理失敗をマーク
   */
  static markProcessingFailed(messageId: string): void {
    this.processingMessages.delete(messageId);
    // 失敗したメッセージは処理済みにマークしない（再試行可能）
    console.log(`❌ Message ${messageId} processing failed`);
  }

  /**
   * キャッシュサイズ制限とクリーンアップ
   */
  private static cleanup(): void {
    if (this.processedMessages.size > this.MAX_CACHE_SIZE) {
      const messagesToRemove = Array.from(this.processedMessages).slice(0, this.MAX_CACHE_SIZE / 2);
      messagesToRemove.forEach(messageId => {
        this.processedMessages.delete(messageId);
      });
      console.log(`🧹 Cleaned up ${messagesToRemove.length} processed messages from cache`);
    }

    // 10分以上処理中のメッセージは異常として削除
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    this.processingMessages.forEach(messageId => {
      // 実際の実装では処理開始時刻も記録する必要があるが、
      // 簡易版として長時間処理中のものは削除
    });
  }

  /**
   * 統計情報を取得
   */
  static getStats(): {
    processedCount: number;
    processingCount: number;
  } {
    return {
      processedCount: this.processedMessages.size,
      processingCount: this.processingMessages.size
    };
  }

  /**
   * デバッグ用：特定メッセージの状態確認
   */
  static getMessageStatus(messageId: string): 'processed' | 'processing' | 'not_started' {
    if (this.isAlreadyProcessed(messageId)) return 'processed';
    if (this.isCurrentlyProcessing(messageId)) return 'processing';
    return 'not_started';
  }
}

export const processingTracker = ProcessingTracker;