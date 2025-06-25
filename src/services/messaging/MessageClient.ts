import * as line from '@line/bot-sdk';

export class MessageClient {
  private client: line.messagingApi.MessagingApiClient;

  constructor(client: line.messagingApi.MessagingApiClient) {
    this.client = client;
  }

  /**
   * テキストメッセージを返信、失敗時はプッシュメッセージにフォールバック
   */
  async replyMessage(replyToken: string, text: string, userId?: string): Promise<void> {
    try {
      await this.client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text
        }]
      });
    } catch (error: any) {
      console.error('Reply message error:', error);
      
      // Invalid reply tokenの場合はプッシュメッセージにフォールバック
      if (userId && this.isInvalidReplyTokenError(error)) {
        console.log('🔄 Falling back to push message due to invalid reply token');
        await this.pushMessage(userId, text);
      } else {
        throw error;
      }
    }
  }

  /**
   * テキストメッセージをプッシュ送信
   */
  async pushMessage(userId: string, text: string): Promise<void> {
    try {
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'text',
          text
        }]
      });
    } catch (error) {
      console.error('Push message error:', error);
      throw error;
    }
  }

  /**
   * Flexメッセージを返信、失敗時はプッシュメッセージにフォールバック
   */
  async replyFlexMessage(replyToken: string, altText: string, flexContent: any, userId?: string): Promise<void> {
    try {
      await this.client.replyMessage({
        replyToken,
        messages: [{
          type: 'flex',
          altText,
          contents: flexContent
        }]
      });
    } catch (error: any) {
      console.error('Reply flex message error:', error);
      
      // Invalid reply tokenの場合はプッシュメッセージにフォールバック
      if (userId && this.isInvalidReplyTokenError(error)) {
        console.log('🔄 Falling back to push flex message due to invalid reply token');
        await this.pushFlexMessage(userId, altText, flexContent);
      } else {
        throw error;
      }
    }
  }

  /**
   * Flexメッセージをプッシュ送信
   */
  async pushFlexMessage(userId: string, altText: string, flexContent: any): Promise<void> {
    try {
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'flex',
          altText,
          contents: flexContent
        }]
      });
    } catch (error) {
      console.error('Push flex message error:', error);
      throw error;
    }
  }

  /**
   * ローディングアニメーションを表示
   */
  async showLoadingAnimation(userId: string): Promise<void> {
    try {
      await this.client.showLoadingAnimation({
        chatId: userId,
        loadingSeconds: 5
      });
    } catch (error) {
      console.error('Show loading animation error:', error);
      // ローディングアニメーションの失敗は非致命的なので例外を投げない
    }
  }

  /**
   * ボタン付きメッセージをプッシュ送信（LINEのbuttonsテンプレート使用）
   */
  async pushButtonsMessage(userId: string, title: string, text: string, actions: Array<{label: string, data: string}>): Promise<void> {
    try {
      console.log('🔄 Sending buttons message:', {
        userId,
        title,
        text: text.substring(0, 100) + '...',
        actionsCount: actions.length
      });
      
      // LINE Buttonsテンプレートの制限事項を考慮
      const truncatedTitle = title.length > 40 ? title.substring(0, 37) + '...' : title;
      const truncatedText = text.length > 60 ? text.substring(0, 57) + '...' : text;
      
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'template',
          altText: title,
          template: {
            type: 'buttons',
            title: truncatedTitle,
            text: truncatedText,
            actions: actions.map(action => ({
              type: 'postback',
              label: action.label,
              data: action.data
            }))
          }
        }]
      });
      
      console.log('✅ Buttons message sent successfully');
    } catch (error) {
      console.error('❌ Push buttons message error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
      throw error;
    }
  }

  /**
   * Invalid reply tokenエラーかどうかを判定
   */
  private isInvalidReplyTokenError(error: any): boolean {
    return error.status === 400 && 
           (error.body?.includes('Invalid reply token') || 
            error.message?.includes('Invalid reply token'));
  }
}

// シングルトンインスタンス（設定後に初期化される）
let messageClientInstance: MessageClient | null = null;

export function initializeMessageClient(client: line.messagingApi.MessagingApiClient): void {
  messageClientInstance = new MessageClient(client);
}

export function getMessageClient(): MessageClient {
  if (!messageClientInstance) {
    throw new Error('MessageClient is not initialized. Call initializeMessageClient first.');
  }
  return messageClientInstance;
}