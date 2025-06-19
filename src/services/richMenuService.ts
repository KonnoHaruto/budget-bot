import * as line from '@line/bot-sdk';

export class RichMenuService {
  private client: line.messagingApi.MessagingApiClient;

  constructor(client: line.messagingApi.MessagingApiClient) {
    this.client = client;
  }

  async createRichMenu(): Promise<string> {
    try {
      const richMenu = {
        size: {
          width: 2500,
          height: 1686
        },
        selected: false,
        name: 'Budget Management Menu',
        chatBarText: 'メニュー',
        areas: [
          // 上段左：予算設定
          {
            bounds: {
              x: 0,
              y: 0,
              width: 833,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: '予算設定'
            }
          },
          // 上段中央：支出を記録
          {
            bounds: {
              x: 833,
              y: 0,
              width: 834,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: '支出を記録'
            }
          },
          // 上段右：レシート取込
          {
            bounds: {
              x: 1667,
              y: 0,
              width: 833,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: 'レシート取込'
            }
          },
          // 下段左：今日の残高
          {
            bounds: {
              x: 0,
              y: 843,
              width: 833,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: '今日の残高'
            }
          },
          // 下段中央：レポート
          {
            bounds: {
              x: 833,
              y: 843,
              width: 834,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: 'レポート'
            }
          },
          // 下段右：設定・ヘルプ
          {
            bounds: {
              x: 1667,
              y: 843,
              width: 833,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: 'ヘルプ'
            }
          }
        ]
      };

      const response = await this.client.createRichMenu(richMenu);
      console.log('✅ Rich menu created:', response.richMenuId);
      return response.richMenuId;
    } catch (error) {
      console.error('❌ Failed to create rich menu:', error);
      throw error;
    }
  }

  async setRichMenuImage(richMenuId: string): Promise<void> {
    try {
      // リッチメニュー画像をバイナリデータとして作成
      // 実際の実装では画像ファイルを用意する必要がありますが、
      // ここでは基本的な設定のみ行います
      
      console.log('📝 Rich menu image should be uploaded manually');
      console.log('Required image size: 2500x1686 pixels');
      console.log('Six sections layout for the menu items');
    } catch (error) {
      console.error('❌ Failed to set rich menu image:', error);
      throw error;
    }
  }

  async setDefaultRichMenu(richMenuId: string): Promise<void> {
    try {
      await this.client.setDefaultRichMenu(richMenuId);
      console.log('✅ Default rich menu set:', richMenuId);
    } catch (error) {
      console.error('❌ Failed to set default rich menu:', error);
      throw error;
    }
  }

  async setupRichMenu(): Promise<void> {
    try {
      // 既存のリッチメニューをクリーンアップ
      await this.cleanupExistingRichMenus();
      
      // 新しいリッチメニューを作成
      const richMenuId = await this.createRichMenu();
      
      // 画像設定の案内
      await this.setRichMenuImage(richMenuId);
      
      // デフォルトメニューとして設定
      await this.setDefaultRichMenu(richMenuId);
      
      console.log('🎉 Rich menu setup completed');
    } catch (error) {
      console.error('❌ Rich menu setup failed:', error);
      throw error;
    }
  }

  private async cleanupExistingRichMenus(): Promise<void> {
    try {
      const richMenus = await this.client.getRichMenuList();
      
      for (const menu of richMenus.richmenus) {
        await this.client.deleteRichMenu(menu.richMenuId);
        console.log('🗑️ Deleted existing rich menu:', menu.richMenuId);
      }
    } catch (error) {
      console.log('ℹ️ No existing rich menus to cleanup or cleanup failed:', error);
    }
  }
}