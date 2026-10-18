import { cancellationRefundService } from './cancellationRefund.service';

export function startCancellationRefundJob() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await cancellationRefundService.reconcile(); }
    catch (error) { console.error('Cancellation refund recovery failed:', error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 30_000);
  timer.unref();
}
