import { FlexMessage, FlexBubble, FlexCarousel } from '@line/bot-sdk';
import { BudgetStatus } from '../../usecases/GetBudgetStatus';
import { Transaction } from '../../domain/entities/Transaction';
import { Money } from '../../domain/valueObjects/Money';

/**
 * Flex Message テンプレート集
 */
export class FlexMessageTemplates {
  
  /**
   * 予算状況カード
   */
  static createBudgetStatusCard(budgetStatus: BudgetStatus): FlexMessage {
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

    const progressBarColor = warningColors[budgetStatus.warningLevel];
    const progressWidth = Math.min(budgetStatus.usagePercentage, 100);

    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💰 予算状況',
            weight: 'bold',
            size: 'xl',
            color: '#1DB446'
          }
        ],
        backgroundColor: '#F0F8FF'
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
                size: 'xl',
                weight: 'bold',
                color: progressBarColor,
                align: 'center'
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'filler'
                      }
                    ],
                    backgroundColor: progressBarColor,
                    height: '8px',
                    flex: progressWidth
                  },
                  {
                    type: 'box',
                    layout: 'horizontal', 
                    contents: [
                      {
                        type: 'filler'
                      }
                    ],
                    backgroundColor: '#E0E0E0',
                    height: '8px',
                    flex: 100 - progressWidth
                  }
                ],
                margin: 'md'
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
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '予算',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: budgetStatus.budget ? budgetStatus.budget.toString() : '未設定',
                    size: 'sm',
                    weight: 'bold',
                    align: 'end',
                    flex: 2
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '支出',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: budgetStatus.totalExpense.toString(),
                    size: 'sm',
                    weight: 'bold',
                    align: 'end',
                    flex: 2,
                    color: '#FF4444'
                  }
                ],
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '残額',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: budgetStatus.remainingBudget.toString(),
                    size: 'sm',
                    weight: 'bold',
                    align: 'end',
                    flex: 2,
                    color: budgetStatus.isOverBudget ? '#FF4444' : '#00C851'
                  }
                ],
                margin: 'md'
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
                text: '📊 詳細統計',
                weight: 'bold',
                size: 'md',
                color: '#1DB446'
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '取引数',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: `${budgetStatus.summary.transactionCount}件`,
                    size: 'sm',
                    align: 'end',
                    flex: 1
                  }
                ],
                margin: 'sm'
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '平均額',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: budgetStatus.summary.averageTransactionAmount.toString(),
                    size: 'sm',
                    align: 'end',
                    flex: 1
                  }
                ],
                margin: 'sm'
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '推奨日額',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: budgetStatus.recommendedDailySpending.toString(),
                    size: 'sm',
                    align: 'end',
                    flex: 1,
                    color: '#1DB446'
                  }
                ],
                margin: 'sm'
              }
            ]
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
              type: 'message',
              label: '履歴',
              text: '履歴'
            },
            style: 'secondary',
            flex: 1
          },
          {
            type: 'button',
            action: {
              type: 'message',
              label: '更新',
              text: '予算状況'
            },
            style: 'primary',
            flex: 1
          }
        ]
      }
    };

    return {
      type: 'flex',
      altText: '予算状況',
      contents: bubble
    };
  }

  /**
   * 取引履歴カルーセル
   */
  static createTransactionHistoryCarousel(transactions: Transaction[]): FlexMessage {
    const bubbles: FlexBubble[] = [];
    const itemsPerBubble = 5;
    
    for (let i = 0; i < transactions.length; i += itemsPerBubble) {
      const chunk = transactions.slice(i, i + itemsPerBubble);
      const bubble = this.createTransactionBubble(chunk, i / itemsPerBubble + 1);
      bubbles.push(bubble);
    }

    if (bubbles.length === 0) {
      bubbles.push(this.createEmptyTransactionBubble());
    }

    const contents = bubbles.length === 1 ? bubbles[0] : {
      type: 'carousel' as const,
      contents: bubbles
    };

    return {
      type: 'flex',
      altText: '取引履歴',
      contents
    };
  }

  /**
   * 取引履歴バブル
   */
  private static createTransactionBubble(transactions: Transaction[], pageNum: number): FlexBubble {
    const transactionRows = transactions.map(transaction => ({
      type: 'box' as const,
      layout: 'horizontal' as const,
      contents: [
        {
          type: 'text' as const,
          text: transaction.createdAt.toLocaleDateString('ja-JP', {
            month: 'short',
            day: 'numeric'
          }),
          size: 'xs',
          color: '#666666',
          flex: 2
        },
        {
          type: 'text' as const,
          text: transaction.description.length > 8 
            ? transaction.description.substring(0, 8) + '...'
            : transaction.description,
          size: 'xs',
          flex: 3,
          wrap: true
        },
        {
          type: 'text' as const,
          text: transaction.amount.toString(),
          size: 'xs',
          align: 'end' as const,
          flex: 2,
          color: '#FF4444'
        }
      ],
      margin: 'md',
      action: {
        type: 'message',
        text: `取引詳細 ${transaction.id}`
      }
    }));

    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `📝 取引履歴 (${pageNum})`,
            weight: 'bold',
            size: 'lg',
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
                size: 'xs',
                color: '#999999',
                weight: 'bold',
                flex: 2
              },
              {
                type: 'text',
                text: '内容',
                size: 'xs',
                color: '#999999',
                weight: 'bold',
                flex: 3
              },
              {
                type: 'text',
                text: '金額',
                size: 'xs',
                color: '#999999',
                weight: 'bold',
                align: 'end',
                flex: 2
              }
            ]
          },
          {
            type: 'separator',
            margin: 'sm'
          },
          ...transactionRows as any[]
        ]
      }
    };
  }

  /**
   * 空の取引履歴バブル
   */
  private static createEmptyTransactionBubble(): FlexBubble {
    return {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📝 取引履歴',
            weight: 'bold',
            size: 'lg',
            color: '#1DB446',
            align: 'center'
          },
          {
            type: 'text',
            text: '取引履歴がありません',
            size: 'md',
            color: '#666666',
            align: 'center',
            margin: 'lg'
          },
          {
            type: 'text',
            text: 'レシートの写真を送信するか、\n「支出 金額 内容」で記録してみてください',
            size: 'sm',
            color: '#999999',
            align: 'center',
            wrap: true,
            margin: 'md'
          }
        ]
      }
    };
  }

  /**
   * レシート確認カード
   */
  static createReceiptConfirmCard(
    amount: number,
    description: string,
    imageUrl?: string
  ): FlexMessage {
    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📸 レシート確認',
            weight: 'bold',
            size: 'lg',
            color: '#1DB446'
          }
        ],
        backgroundColor: '#F0F8FF'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '以下の内容で支出を記録しますか？',
            size: 'md',
            wrap: true,
            margin: 'md'
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
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '💰 金額',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: `¥${amount.toLocaleString()}`,
                    size: 'lg',
                    weight: 'bold',
                    align: 'end',
                    flex: 2,
                    color: '#FF4444'
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '📝 内容',
                    size: 'sm',
                    color: '#666666',
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: description,
                    size: 'md',
                    align: 'end',
                    flex: 2,
                    wrap: true
                  }
                ],
                margin: 'md'
              }
            ]
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
              type: 'message',
              label: 'いいえ',
              text: 'いいえ'
            },
            style: 'secondary',
            flex: 1
          },
          {
            type: 'button',
            action: {
              type: 'message',
              label: 'はい',
              text: 'はい'
            },
            style: 'primary',
            flex: 1
          }
        ]
      }
    };

    if (imageUrl) {
      bubble.hero = {
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
      contents: bubble
    };
  }

  /**
   * 予算アラートカード
   */
  static createBudgetAlertCard(
    alertType: 'warning' | 'danger' | 'over',
    message: string,
    budgetStatus?: BudgetStatus
  ): FlexMessage {
    const alertConfigs = {
      warning: {
        icon: '⚠️',
        color: '#FF8800',
        title: '予算警告',
        backgroundColor: '#FFF8E1'
      },
      danger: {
        icon: '🚨',
        color: '#FF4444',
        title: '予算危険',
        backgroundColor: '#FFEBEE'
      },
      over: {
        icon: '🆘',
        color: '#CC0000',
        title: '予算超過！',
        backgroundColor: '#FFEBEE'
      }
    };

    const config = alertConfigs[alertType];

    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `${config.icon} ${config.title}`,
            weight: 'bold',
            size: 'xl',
            color: config.color,
            align: 'center'
          }
        ],
        backgroundColor: config.backgroundColor
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: message,
            size: 'md',
            wrap: true,
            align: 'center',
            color: config.color,
            weight: 'bold'
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
              type: 'message',
              label: '予算状況確認',
              text: '予算状況'
            },
            style: 'primary'
          }
        ]
      }
    };

    return {
      type: 'flex',
      altText: config.title,
      contents: bubble
    };
  }

  /**
   * 月次レポートカード
   */
  static createMonthlyReportCard(
    year: number,
    month: number,
    totalExpense: Money,
    transactionCount: number,
    budget?: Money
  ): FlexMessage {
    const usageRate = budget ? (totalExpense.amount / budget.amount) * 100 : 0;
    const statusColor = usageRate > 100 ? '#FF4444' : usageRate > 80 ? '#FF8800' : '#00C851';

    return {
      type: 'flex',
      altText: `${year}年${month}月の支出レポート`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `📊 ${year}年${month}月レポート`,
              weight: 'bold',
              size: 'xl',
              color: '#1DB446'
            }
          ],
          backgroundColor: '#F0F8FF'
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
                  text: '総支出',
                  size: 'sm',
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: totalExpense.toString(),
                  size: 'lg',
                  weight: 'bold',
                  align: 'end',
                  color: statusColor
                }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '取引件数',
                  size: 'sm',
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: `${transactionCount}件`,
                  size: 'md',
                  align: 'end'
                }
              ],
              margin: 'md'
            },
            budget ? {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '予算達成率',
                  size: 'sm',
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: `${usageRate.toFixed(1)}%`,
                  size: 'md',
                  align: 'end',
                  color: statusColor
                }
              ],
              margin: 'md'
            } : {
              type: 'filler'
            }
          ]
        }
      }
    };
  }
}