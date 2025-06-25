interface DeleteRequest {
  userId: string;
  transactionId: number;
  token: string;
  timestamp: number;
}

interface EditRequest {
  userId: string;
  transactionId: number;
  newAmount: number;
  token: string;
  timestamp: number;
}

interface ExpenseConfirmRequest {
  userId: string;
  token: string;
  timestamp: number;
}

interface ResetConfirmRequest {
  userId: string;
  token: string;
  timestamp: number;
}

export class TokenManager {
  private deleteRequests: Map<string, DeleteRequest> = new Map();
  private editRequests: Map<string, EditRequest> = new Map();
  private expenseConfirmRequests: Map<string, ExpenseConfirmRequest> = new Map();
  private resetConfirmRequests: Map<string, ResetConfirmRequest> = new Map();

  private readonly EXPIRY_TIME = 5 * 60 * 1000; // 5分

  /**
   * ランダムなトークンを生成
   */
  generateToken(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * 期限切れトークンをクリーンアップ
   */
  cleanupExpiredTokens(): void {
    const now = Date.now();

    // 削除リクエストのクリーンアップ
    for (const [token, request] of this.deleteRequests.entries()) {
      if (now - request.timestamp > this.EXPIRY_TIME) {
        this.deleteRequests.delete(token);
      }
    }

    // 編集リクエストのクリーンアップ
    for (const [token, request] of this.editRequests.entries()) {
      if (now - request.timestamp > this.EXPIRY_TIME) {
        this.editRequests.delete(token);
      }
    }

    // 支出確認リクエストのクリーンアップ
    for (const [token, request] of this.expenseConfirmRequests.entries()) {
      if (now - request.timestamp > this.EXPIRY_TIME) {
        this.expenseConfirmRequests.delete(token);
      }
    }

    // リセット確認リクエストのクリーンアップ
    for (const [token, request] of this.resetConfirmRequests.entries()) {
      if (now - request.timestamp > this.EXPIRY_TIME) {
        this.resetConfirmRequests.delete(token);
      }
    }
  }

  /**
   * 支出確認用トークンを生成・保存
   */
  async generateExpenseToken(userId: string): Promise<string> {
    this.cleanupExpiredTokens();
    const token = this.generateToken();
    this.expenseConfirmRequests.set(token, {
      userId,
      token,
      timestamp: Date.now()
    });
    return token;
  }

  /**
   * 削除確認用トークンを生成・保存
   */
  generateDeleteToken(userId: string, transactionId: number): string {
    this.cleanupExpiredTokens();
    const token = this.generateToken();
    this.deleteRequests.set(token, {
      userId,
      transactionId,
      token,
      timestamp: Date.now()
    });
    return token;
  }

  /**
   * 編集確認用トークンを生成・保存
   */
  generateEditToken(userId: string, transactionId: number, newAmount: number): string {
    this.cleanupExpiredTokens();
    const token = this.generateToken();
    this.editRequests.set(token, {
      userId,
      transactionId,
      newAmount,
      token,
      timestamp: Date.now()
    });
    return token;
  }

  /**
   * リセット確認用トークンを生成・保存
   */
  generateResetToken(userId: string): string {
    this.cleanupExpiredTokens();
    const token = this.generateToken();
    this.resetConfirmRequests.set(token, {
      userId,
      token,
      timestamp: Date.now()
    });
    return token;
  }

  /**
   * 支出確認リクエストを取得
   */
  getExpenseConfirmRequest(token: string): ExpenseConfirmRequest | undefined {
    return this.expenseConfirmRequests.get(token);
  }

  /**
   * 削除リクエストを取得
   */
  getDeleteRequest(token: string): DeleteRequest | undefined {
    return this.deleteRequests.get(token);
  }

  /**
   * 編集リクエストを取得
   */
  getEditRequest(token: string): EditRequest | undefined {
    return this.editRequests.get(token);
  }

  /**
   * リセットリクエストを取得
   */
  getResetRequest(token: string): ResetConfirmRequest | undefined {
    return this.resetConfirmRequests.get(token);
  }

  /**
   * 支出確認リクエストを削除
   */
  removeExpenseConfirmRequest(token: string): boolean {
    return this.expenseConfirmRequests.delete(token);
  }

  /**
   * 削除リクエストを削除
   */
  removeDeleteRequest(token: string): boolean {
    return this.deleteRequests.delete(token);
  }

  /**
   * 編集リクエストを削除
   */
  removeEditRequest(token: string): boolean {
    return this.editRequests.delete(token);
  }

  /**
   * リセットリクエストを削除
   */
  removeResetRequest(token: string): boolean {
    return this.resetConfirmRequests.delete(token);
  }
}

// シングルトンインスタンス
export const tokenManager = new TokenManager();