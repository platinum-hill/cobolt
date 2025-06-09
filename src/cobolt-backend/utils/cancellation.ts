/**
 * Enhanced cancellation token for stopping asynchronous operations with HTTP request cancellation
 */
export class CancellationToken {
  private _isCancelled: boolean = false;
  private _abortController?: AbortController;
  private _cancelReason?: string;

  /**
   * Cancel the ongoing operation with optional reason
   */
  public cancel(reason?: string): void {
    if (this._isCancelled) return; // Already cancelled
    
    this._isCancelled = true;
    this._cancelReason = reason;
    
    // Actually abort HTTP requests
    if (this._abortController) {
      this._abortController.abort();
      console.log(`[Cancellation] HTTP request aborted: ${reason || 'User cancelled'}`);
    }
  }

  /**
   * Get the abort signal for HTTP requests
   */
  public get signal(): AbortSignal | undefined {
    return this._abortController?.signal;
  }

  /**
   * Link an AbortController to this token
   */
  public setAbortController(controller: AbortController): void {
    this._abortController = controller;
  }

  /**
   * Check if the operation has been cancelled
   */
  public get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * Get the cancellation reason
   */
  public get cancelReason(): string | undefined {
    return this._cancelReason;
  }

  /**
   * Reset the token to uncancelled state
   */
  public reset(): void {
    this._isCancelled = false;
    this._cancelReason = undefined;
    this._abortController = undefined;
  }
}

export const globalCancellationToken = new CancellationToken();