import { User } from '../domain/entities/User';
import { Money } from '../domain/valueObjects/Money';

/**
 * 予算設定ユースケース
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<User>;
  create(user: User): Promise<User>;
}

export class SetBudget {
  constructor(
    private userRepository: UserRepository
  ) {}

  /**
   * 月間予算を設定
   */
  async execute(input: {
    userId: string;
    amount: number;
    currency?: string;
  }): Promise<User> {
    // 入力値検証
    if (!input.userId || input.userId.trim().length === 0) {
      throw new Error('User ID is required');
    }
    
    if (input.amount <= 0) {
      throw new Error('Budget amount must be positive');
    }

    if (input.amount > 10000000) { // 1000万円上限
      throw new Error('Budget amount too large');
    }

    // ユーザー取得または作成
    let user = await this.userRepository.findById(input.userId);
    const isNewUser = !user;
    
    if (isNewUser) {
      // 新規ユーザー作成
      user = User.create(input.userId);
      console.log(`👤 Creating new user: ${input.userId}`);
    }

    // この時点でuserは必ず存在する
    const budget = new Money(input.amount, input.currency || 'JPY');
    user!.setBudget(budget);

    // 永続化
    const savedUser = isNewUser ? 
      await this.userRepository.create(user!) :
      await this.userRepository.save(user!);
    
    console.log(`💰 Budget set for user ${savedUser.id}: ${budget.toString()}`);
    return savedUser;
  }

  /**
   * 予算をクリア
   */
  async clearBudget(userId: string): Promise<User> {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.clearBudget();
    const savedUser = await this.userRepository.save(user);
    
    console.log(`🗑️ Budget cleared for user ${savedUser.id}`);
    return savedUser;
  }

  /**
   * 現在の予算を取得
   */
  async getCurrentBudget(userId: string): Promise<Money | null> {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }

    const user = await this.userRepository.findById(userId);
    return user?.monthlyBudget || null;
  }

  /**
   * 予算が設定されているかチェック
   */
  async hasBudget(userId: string): Promise<boolean> {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID is required');
    }

    const user = await this.userRepository.findById(userId);
    return user?.hasBudget() || false;
  }

  /**
   * 予算の妥当性をチェック
   */
  validateBudgetAmount(amount: number, currency: string = 'JPY'): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 基本的なバリデーション
    if (amount <= 0) {
      errors.push('Budget amount must be positive');
    }

    if (amount > 10000000) {
      errors.push('Budget amount too large (max: 10,000,000)');
    }

    // 通貨別の妥当性チェック
    switch (currency) {
      case 'JPY':
        if (amount < 10000) {
          warnings.push('Budget seems low for monthly expenses');
        }
        if (amount > 1000000) {
          warnings.push('Budget seems very high');
        }
        break;
      case 'USD':
        if (amount < 100) {
          warnings.push('Budget seems low for monthly expenses');
        }
        if (amount > 10000) {
          warnings.push('Budget seems very high');
        }
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 推奨予算を計算
   */
  async suggestBudget(input: {
    userId: string;
    baseAmount?: number;
    currency?: string;
    lifestyle?: 'minimal' | 'moderate' | 'comfortable';
  }): Promise<Money[]> {
    const currency = input.currency || 'JPY';
    const lifestyle = input.lifestyle || 'moderate';
    
    let baseAmount = input.baseAmount;
    
    // ベース金額が指定されていない場合のデフォルト値
    if (!baseAmount) {
      switch (currency) {
        case 'JPY':
          baseAmount = 50000; // 5万円
          break;
        case 'USD':
          baseAmount = 500; // $500
          break;
        default:
          baseAmount = 50000;
      }
    }

    const suggestions: Money[] = [];
    
    // ライフスタイル別の倍率
    const multipliers = {
      minimal: [0.7, 1.0, 1.3],
      moderate: [1.0, 1.5, 2.0],
      comfortable: [1.5, 2.0, 3.0]
    };

    for (const multiplier of multipliers[lifestyle]) {
      const amount = Math.round(baseAmount * multiplier);
      suggestions.push(new Money(amount, currency));
    }

    return suggestions;
  }
}