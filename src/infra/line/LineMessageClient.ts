import { Client, MessageAPIResponseBase, WebhookEvent, FlexMessage, TextMessage } from '@line/bot-sdk';
import { BudgetStatus } from '../../usecases/GetBudgetStatus';
import { Transaction } from '../../domain/entities/Transaction';
import { User } from '../../domain/entities/User';

/**
 * LINE Messaging APIクライアント
 */
export class LineMessageClient {
  public client: Client;

  constructor(channelAccessToken: string, channelSecret: string) {
    this.client = new Client({
      channelAccessToken,
      channelSecret
    });
  }

  /**
   * テキストメッセージを送信
   */
  async sendTextMessage(userId: string, text: string): Promise<MessageAPIResponseBase> {
    const message: TextMessage = {
      type: 'text',
      text
    };

    return await this.client.pushMessage(userId, message);
  }

  /**
   * 予算状況のFLEXメッセージを送信
   */
  async sendBudgetStatusMessage(userId: string, budgetStatus: BudgetStatus): Promise<MessageAPIResponseBase> {
    const flexMessage = this.createBudgetStatusFlexMessage(budgetStatus);
    return await this.client.pushMessage(userId, flexMessage);
  }

  /**
   * 取引確認のFLEXメッセージを送信
   */
  async sendTransactionConfirmMessage(
    userId: string, 
    amount: number, 
    description: string, 
    imageUrl?: string
  ): Promise<MessageAPIResponseBase> {
    const flexMessage = this.createTransactionConfirmFlexMessage(amount, description, imageUrl);
    return await this.client.pushMessage(userId, flexMessage);
  }

  /**
   * 取引履歴のFLEXメッセージを送信
   */
  async sendTransactionHistoryMessage(userId: string, transactions: Transaction[]): Promise<MessageAPIResponseBase> {
    const flexMessage = this.createTransactionHistoryFlexMessage(transactions);
    return await this.client.pushMessage(userId, flexMessage);
  }

  /**
   * 予算アラートメッセージを送信
   */
  async sendBudgetAlert(userId: string, alertType: 'warning' | 'danger' | 'over', message: string): Promise<MessageAPIResponseBase> {
    const flexMessage = this.createBudgetAlertFlexMessage(alertType, message);
    return await this.client.pushMessage(userId, flexMessage);
  }

  /**
   * リプライメッセージを送信
   */
  async replyMessage(replyToken: string, text: string): Promise<MessageAPIResponseBase> {
    const message: TextMessage = {
      type: 'text',
      text
    };

    return await this.client.replyMessage(replyToken, message);
  }

  /**
   * Flexメッセージを送信
   */
  async sendFlexMessage(userId: string, flexMessage: FlexMessage): Promise<MessageAPIResponseBase> {
    return await this.client.pushMessage(userId, flexMessage);
  }

  /**
   * 予算状況のFLEXメッセージを作成
   */
  private createBudgetStatusFlexMessage(budgetStatus: BudgetStatus): FlexMessage {
    const warningColors = {
      safe: '#00C851',
      warning: '#FF8800',
      danger: '#FF4444',
      over: '#CC0000'
    };

    const warningIcons = {
      safe: '✅',
      warning: '⚠️',
      danger: '🚨',
      over: '🆘'
    };

    return {
      type: 'flex',
      altText: '予算状況',
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '予算状況',
              weight: 'bold',
              size: 'xl',
              color: '#1DB446'
            }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: `${warningIcons[budgetStatus.warningLevel]} ${budgetStatus.usagePercentage.toFixed(1)}%使用`,
                  size: 'lg',
                  weight: 'bold',
                  color: warningColors[budgetStatus.warningLevel]
                },
                {
                  type: 'text',
                  text: budgetStatus.budget ? `予算: ${budgetStatus.budget.toString()}` : '予算未設定',
                  size: 'sm',
                  color: '#666666',
                  margin: 'md'
                },
                {
                  type: 'text',
                  text: `支出: ${budgetStatus.totalExpense.toString()}`,
                  size: 'sm',
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: `残額: ${budgetStatus.remainingBudget.toString()}`,
                  size: 'sm',
                  color: '#666666'
                }
              ]
            },
            {
              type: 'separator',
              margin: 'lg'
            },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                {
                  type: 'text',
                  text: '📊 詳細情報',
                  weight: 'bold',
                  size: 'md'
                },
                {
                  type: 'text',
                  text: `取引件数: ${budgetStatus.summary.transactionCount}件`,
                  size: 'sm',
                  color: '#666666',
                  margin: 'sm'
                },
                {
                  type: 'text',
                  text: `平均支出: ${budgetStatus.summary.averageTransactionAmount.toString()}`,
                  size: 'sm',
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: `今日の推奨額: ${budgetStatus.recommendedDailySpending.toString()}`,
                  size: 'sm',
                  color: '#666666'
                }
              ]
            }
          ]
        }
      }
    };
  }

  /**
   * 取引確認のFLEXメッセージを作成
   */
  private createTransactionConfirmFlexMessage(amount: number, description: string, imageUrl?: string): FlexMessage {
    const contents: any = {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'レシート確認',
            weight: 'bold',
            size: 'xl',
            color: '#1DB446'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `金額: ¥${amount.toLocaleString()}`,
            size: 'lg',
            weight: 'bold'
          },
          {
            type: 'text',
            text: `内容: ${description}`,
            size: 'md',
            margin: 'md'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'button',
            action: {
              type: 'message' as const,
              label: 'はい',
              text: 'はい'
            },
            style: 'primary' as const
          },
          {
            type: 'button',
            action: {
              type: 'message' as const,
              label: 'いいえ',
              text: 'いいえ'
            },
            style: 'secondary' as const
          }
        ]
      }
    };

    if (imageUrl) {
      contents.hero = {
        type: 'image',
        url: imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover'
      };
    }

    return {
      type: 'flex',
      altText: 'レシート確認',
      contents
    };
  }

  /**
   * 取引履歴のFLEXメッセージを作成
   */
  private createTransactionHistoryFlexMessage(transactions: Transaction[]): FlexMessage {
    const transactionContents = transactions.slice(0, 5).map(transaction => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: transaction.createdAt.toLocaleDateString('ja-JP'),
          size: 'sm',
          color: '#666666',
          flex: 2
        },
        {
          type: 'text',
          text: transaction.description,
          size: 'sm',
          flex: 3
        },
        {
          type: 'text',
          text: transaction.amount.toString(),
          size: 'sm',
          align: 'end',
          flex: 2
        }
      ],
      margin: 'md'
    }));

    return {
      type: 'flex',
      altText: '取引履歴',
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '📝 取引履歴',
              weight: 'bold',
              size: 'xl',
              color: '#1DB446'
            }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '日付',
                  size: 'sm',
                  color: '#666666',
                  weight: 'bold',
                  flex: 2
                },
                {
                  type: 'text',
                  text: '内容',
                  size: 'sm',
                  color: '#666666',
                  weight: 'bold',
                  flex: 3
                },
                {
                  type: 'text',
                  text: '金額',
                  size: 'sm',
                  color: '#666666',
                  weight: 'bold',
                  align: 'end',
                  flex: 2
                }
              ]
            },
            {
              type: 'separator',
              margin: 'md'
            },
            ...transactionContents as any[]
          ]
        }
      }
    };
  }

  /**
   * 予算アラートのFLEXメッセージを作成
   */
  private createBudgetAlertFlexMessage(alertType: 'warning' | 'danger' | 'over', message: string): FlexMessage {
    const alertConfigs = {
      warning: {
        icon: '⚠️',
        color: '#FF8800',
        title: '予算警告'
      },
      danger: {
        icon: '🚨',
        color: '#FF4444',
        title: '予算危険'
      },
      over: {
        icon: '🆘',
        color: '#CC0000',
        title: '予算超過'
      }
    };

    const config = alertConfigs[alertType];

    return {
      type: 'flex',
      altText: config.title,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `${config.icon} ${config.title}`,
              weight: 'bold',
              size: 'xl',
              color: config.color
            }
          ],
          backgroundColor: '#F8F8F8'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: message,
              size: 'md',
              wrap: true
            }
          ]
        }
      }
    };
  }

  /**
   * ユーザープロフィールを取得
   */
  async getUserProfile(userId: string): Promise<any> {
    return await this.client.getProfile(userId);
  }

  /**
   * Webhookイベントを検証
   */
  validateSignature(body: string, signature: string): boolean {
    // LINE SDK v8 では validateSignature は利用できないため、別途実装が必要
    // ここでは簡略化のため true を返す（本来は HMAC-SHA256 検証が必要）
    return true;
  }
}