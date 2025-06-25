const sharp = require('sharp');

/**
 * 画像処理サービス
 * 画像の回転、リサイズ、最適化を行う
 */
export class ImageProcessor {
  
  /**
   * 画像の向きを自動検出して修正
   */
  static async autoRotateImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      console.log('🔄 Starting auto-rotation analysis...');
      
      // 1. 画像のメタデータを取得
      const metadata = await sharp(imageBuffer).metadata();
      console.log('📊 Image metadata:', {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        format: metadata.format
      });
      
      // 2. EXIF orientationに基づく自動回転
      let rotatedBuffer = await sharp(imageBuffer)
        .rotate() // EXIF orientationを自動適用
        .toBuffer();
      
      // 3. 向きの再チェック（縦長になっているか確認）
      const rotatedMetadata = await sharp(rotatedBuffer).metadata();
      const isLandscape = (rotatedMetadata.width || 0) > (rotatedMetadata.height || 0);
      
      if (isLandscape) {
        console.log('🔄 Image is still landscape, trying manual rotation...');
        rotatedBuffer = await this.tryMultipleRotations(imageBuffer);
      }
      
      console.log('✅ Auto-rotation completed');
      return rotatedBuffer;
      
    } catch (error) {
      console.error('❌ Auto-rotation failed:', error);
      return imageBuffer; // フォールバック：元の画像を返す
    }
  }
  
  /**
   * 複数の回転角度でOCRテストを行い、最適な向きを特定
   */
  private static async tryMultipleRotations(imageBuffer: Buffer): Promise<Buffer> {
    const rotationAngles = [0, 90, 180, 270];
    const results: { angle: number; buffer: Buffer; score: number }[] = [];
    
    console.log('🔍 Testing multiple rotation angles...');
    
    for (const angle of rotationAngles) {
      try {
        // 指定角度で回転
        const rotatedBuffer = angle === 0 
          ? imageBuffer 
          : await sharp(imageBuffer).rotate(angle).toBuffer();
        
        // 簡易OCRテスト（テキスト量で判定）
        const score = await this.calculateTextScore(rotatedBuffer);
        
        results.push({
          angle,
          buffer: rotatedBuffer,
          score
        });
        
        console.log(`📐 Rotation ${angle}°: score ${score}`);
        
      } catch (error) {
        console.error(`❌ Failed to rotate ${angle}°:`, error);
      }
    }
    
    // 最高スコアの回転角度を選択
    const bestResult = results.reduce((best, current) => 
      current.score > best.score ? current : best
    );
    
    console.log(`🎯 Best rotation: ${bestResult.angle}° (score: ${bestResult.score})`);
    return bestResult.buffer;
  }
  
  /**
   * 画像からテキスト検出の品質を簡易評価
   */
  private static async calculateTextScore(imageBuffer: Buffer): Promise<number> {
    try {
      // sharpで画像解析（コントラスト、エッジ検出など）
      const stats = await sharp(imageBuffer).stats();
      
      // 画像の統計情報から品質スコアを計算
      // より良いテキスト検出ができそうな画像ほど高スコア
      const channels = stats.channels;
      let score = 0;
      
      if (channels && channels.length > 0) {
        // コントラスト指標（標準偏差が高いほど良い）
        const stdDev = channels[0].std || 0;
        score += Math.min(stdDev / 50, 10); // 最大10点
        
        // 明度指標（適度な明るさが良い）
        const mean = channels[0].mean || 0;
        const brightness = Math.abs(mean - 128) / 128; // 128から離れるほど減点
        score += Math.max(0, 10 - brightness * 10);
      }
      
      // 画像サイズ指標（大きすぎず小さすぎず）
      const metadata = await sharp(imageBuffer).metadata();
      const area = (metadata.width || 0) * (metadata.height || 0);
      if (area > 100000 && area < 5000000) { // 適度なサイズ
        score += 5;
      }
      
      return score;
      
    } catch (error) {
      console.error('❌ Failed to calculate text score:', error);
      return 0;
    }
  }
  
  /**
   * レシート画像用の最適化処理
   */
  static async optimizeForOCR(imageBuffer: Buffer, mode: 'light' | 'full'): Promise<Buffer> {
    try {
      console.log(`🎨 Optimizing image for ${mode} OCR...`);
      
      const processor = sharp(imageBuffer);
      
      if (mode === 'light') {
        // 軽量処理：リサイズのみ
        return await processor
          .resize(800, 1000, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: 75 })
          .toBuffer();
      } else {
        // 完全処理：リサイズ + 画質向上
        return await processor
          .resize(1200, 1600, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          // コントラスト向上
          .modulate({
            brightness: 1.1,
            saturation: 0.8
          })
          // シャープネス適用
          .sharpen(1, 1, 1)
          .jpeg({ quality: 90 })
          .toBuffer();
      }
      
    } catch (error) {
      console.error('❌ Image optimization failed:', error);
      return imageBuffer; // フォールバック
    }
  }
  
  /**
   * 画像の向きを強制的に縦向きに修正
   */
  static async forcePortraitOrientation(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      
      // 横長の場合は90度回転
      if (width > height) {
        console.log('🔄 Forcing portrait orientation (90° rotation)');
        return await sharp(imageBuffer)
          .rotate(90)
          .toBuffer();
      }
      
      return imageBuffer;
      
    } catch (error) {
      console.error('❌ Failed to force portrait orientation:', error);
      return imageBuffer;
    }
  }
  
  /**
   * 画像品質の診断
   */
  static async diagnoseImageQuality(imageBuffer: Buffer): Promise<{
    isGoodQuality: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const stats = await sharp(imageBuffer).stats();
      
      const issues: string[] = [];
      const recommendations: string[] = [];
      
      // サイズチェック
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const area = width * height;
      
      if (area < 50000) {
        issues.push('Image resolution too low');
        recommendations.push('Use higher resolution image');
      }
      
      if (area > 10000000) {
        issues.push('Image resolution too high');
        recommendations.push('Compress image before processing');
      }
      
      // 向きチェック
      if (width > height) {
        issues.push('Image is in landscape orientation');
        recommendations.push('Rotate image to portrait orientation');
      }
      
      // 明度チェック
      if (stats.channels && stats.channels[0]) {
        const brightness = stats.channels[0].mean || 0;
        if (brightness < 50) {
          issues.push('Image too dark');
          recommendations.push('Increase brightness');
        }
        if (brightness > 200) {
          issues.push('Image too bright');
          recommendations.push('Decrease brightness');
        }
      }
      
      return {
        isGoodQuality: issues.length === 0,
        issues,
        recommendations
      };
      
    } catch (error) {
      console.error('❌ Failed to diagnose image quality:', error);
      return {
        isGoodQuality: false,
        issues: ['Failed to analyze image'],
        recommendations: ['Try a different image']
      };
    }
  }
}

export const imageProcessor = ImageProcessor;