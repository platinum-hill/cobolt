/**
 * Simple cancellation token for stopping asynchronous operations
 */
export class CancellationToken {
  private _isCancelled: boolean = false;

  /**
   * Cancel the ongoing operation
   */
  public cancel(): void {
    this._isCancelled = true;
  }

  /**
   * Check if the operation has been cancelled
   */
  public get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * Reset the token to uncancelled state
   */
  public reset(): void {
    this._isCancelled = false;
  }
}

export const globalCancellationToken = new CancellationToken();