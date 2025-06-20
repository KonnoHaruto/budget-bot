import * as line from '@line/bot-sdk';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

export class RichMenuService {
  private client: line.messagingApi.MessagingApiClient;
  private blobClient: line.messagingApi.MessagingApiBlobClient;

  constructor(client: line.messagingApi.MessagingApiClient) {
    this.client = client;
    const config = {
      channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
      channelSecret: process.env.CHANNEL_SECRET!
    };
    this.blobClient = new line.messagingApi.MessagingApiBlobClient(config);
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
          // 上段左：今日の残高
          {
            bounds: {
              x: 0,
              y: 0,
              width: 1250,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: '今日の残高'
            }
          },
          // 上段右：履歴
          {
            bounds: {
              x: 1250,
              y: 0,
              width: 1250,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: '履歴'
            }
          },
          // 下段左：レポート
          {
            bounds: {
              x: 0,
              y: 843,
              width: 833,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: 'レポート'
            }
          },
          // 下段中央：予算設定
          {
            bounds: {
              x: 833,
              y: 843,
              width: 834,
              height: 843
            },
            action: {
              type: 'message' as const,
              text: '予算設定'
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

  private async createCombinedRichMenuImage(): Promise<Buffer> {
    try {
      const assetsPath = path.join(process.cwd(), 'assets', 'richmenus');
      
      // 各セクションの画像パス（5要素用）
      const imageFiles = {
        balance: path.join(assetsPath, 'balance.png'),        // 上段左
        history: path.join(assetsPath, 'history.png'),        // 上段右（新規）
        report: path.join(assetsPath, 'report.png'),          // 下段左
        budgetSetting: path.join(assetsPath, 'budget-setting.png'), // 下段中央
        settingHelp: path.join(assetsPath, 'setting-help.png') // 下段右
      };

      // ファイルの存在確認（履歴画像がない場合はbalance.pngで代用）
      for (const [key, filePath] of Object.entries(imageFiles)) {
        if (!fs.existsSync(filePath)) {
          if (key === 'history') {
            console.log('📝 History image not found, using balance.png as fallback');
            imageFiles.history = imageFiles.balance;
          } else {
            throw new Error(`Image file not found: ${filePath}`);
          }
        }
      }

      // 2500x1686の空白画像を作成
      const combinedImage = sharp({
        create: {
          width: 2500,
          height: 1686,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      });

      // 各画像をリサイズして配置（5要素レイアウト）
      const composite = [
        // 上段左 (1250x843): 今日の残高
        {
          input: await sharp(imageFiles.balance)
            .resize(1250, 843, { fit: 'cover' })
            .png({ quality: 85, compressionLevel: 9 })
            .toBuffer(),
          left: 0,
          top: 0
        },
        // 上段右 (1250x843): 履歴
        {
          input: await sharp(imageFiles.history)
            .resize(1250, 843, { fit: 'cover' })
            .png({ quality: 85, compressionLevel: 9 })
            .toBuffer(),
          left: 1250,
          top: 0
        },
        // 下段左 (833x843): レポート
        {
          input: await sharp(imageFiles.report)
            .resize(833, 843, { fit: 'cover' })
            .png({ quality: 85, compressionLevel: 9 })
            .toBuffer(),
          left: 0,
          top: 843
        },
        // 下段中央 (834x843): 予算設定
        {
          input: await sharp(imageFiles.budgetSetting)
            .resize(834, 843, { fit: 'cover' })
            .png({ quality: 85, compressionLevel: 9 })
            .toBuffer(),
          left: 833,
          top: 843
        },
        // 下段右 (833x843): 設定・ヘルプ
        {
          input: await sharp(imageFiles.settingHelp)
            .resize(833, 843, { fit: 'cover' })
            .png({ quality: 85, compressionLevel: 9 })
            .toBuffer(),
          left: 1667,
          top: 843
        }
      ];

      let combinedBuffer = await combinedImage.composite(composite).png({ 
        quality: 80,
        compressionLevel: 9 
      }).toBuffer();
      
      // LINE Rich Menu image size limit is 1MB
      const MAX_SIZE = 1024 * 1024; // 1MB
      console.log(`📏 Image size: ${(combinedBuffer.length / 1024).toFixed(2)}KB`);
      
      // If still too large, reduce quality further
      if (combinedBuffer.length > MAX_SIZE) {
        console.log('🔧 Image too large, reducing quality...');
        combinedBuffer = await combinedImage.composite(composite).jpeg({ 
          quality: 60 
        }).toBuffer();
        console.log(`📏 Compressed image size: ${(combinedBuffer.length / 1024).toFixed(2)}KB`);
      }
      
      // 統合画像を保存（オプション）
      const outputPath = path.join(assetsPath, 'richmenu.png');
      fs.writeFileSync(outputPath, combinedBuffer);
      console.log('✅ Combined rich menu image created:', outputPath);
      
      return combinedBuffer;
    } catch (error) {
      console.error('❌ Failed to create combined image:', error);
      throw error;
    }
  }

  async setRichMenuImage(richMenuId: string): Promise<void> {
    try {
      // 統合リッチメニュー画像のパスを確認
      const possiblePaths = [
        path.join(process.cwd(), 'assets', 'richmenus', 'richmenu.png'),
        path.join(process.cwd(), 'assets', 'richmenus', 'menu.png'),
        path.join(process.cwd(), 'assets', 'richmenus', 'rich-menu.png'),
        path.join(process.cwd(), 'assets', 'richmenus', 'richmenus.png')
      ];

      let imageBuffer: Buffer;
      let imagePath: string | null = null;
      
      // 既存の統合画像を確認
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          imagePath = possiblePath;
          break;
        }
      }

      if (imagePath) {
        // 既存の統合画像を使用
        imageBuffer = fs.readFileSync(imagePath);
        console.log('📝 Using existing rich menu image:', imagePath);
      } else {
        // 個別画像から統合画像を作成
        console.log('📝 Creating combined rich menu image from individual images...');
        imageBuffer = await this.createCombinedRichMenuImage();
      }
      
      // BufferをBlobに変換
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      
      // 画像をアップロード
      await this.blobClient.setRichMenuImage(richMenuId, blob);
      console.log('✅ Rich menu image uploaded successfully');
      
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
      
      // 画像をアップロード
      await this.setRichMenuImage(richMenuId);
      
      // デフォルトメニューとして設定
      await this.setDefaultRichMenu(richMenuId);
      
      console.log('🎉 Rich menu setup completed');
    } catch (error) {
      console.error('❌ Rich menu setup failed:', error);
      console.log('⚠️  Continuing without rich menu. You can set it up manually later.');
      // エラーがあってもアプリケーションの起動は継続
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