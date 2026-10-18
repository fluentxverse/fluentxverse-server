// Simple webhook server to trigger deployments
// Run with: bun run scripts/webhook-server.ts

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-secret-here';
// Use absolute path so this works no matter where it's started from.
const DEPLOY_SCRIPT = `${import.meta.dir}/deploy.sh`;

const server = Bun.serve({
  port: 9000,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }
    
    // GitHub webhook endpoint
    if (url.pathname === '/webhook' && req.method === 'POST') {
      try {
        // Verify GitHub signature
        const signature = req.headers.get('x-hub-signature-256');
        const body = await req.text();
        
        if (WEBHOOK_SECRET !== 'your-secret-here') {
          const crypto = await import('crypto');
          const expectedSig = 'sha256=' + crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(body)
            .digest('hex');
          
          if (signature !== expectedSig) {
            console.log('❌ Invalid signature');
            return new Response('Invalid signature', { status: 401 });
          }
        }
        
        const payload = JSON.parse(body);
        
        // Only deploy on push to main branch
        if (payload.ref === 'refs/heads/main') {
          console.log(`📦 Push to main by ${payload.pusher?.name || 'unknown'}`);
          console.log(`📝 Commit: ${payload.head_commit?.message || 'No message'}`);
          
          // Run deploy script in background
          const proc = Bun.spawn(['bash', DEPLOY_SCRIPT], {
            stdout: 'inherit',
            stderr: 'inherit',
          });
          
          // Don't wait for it - respond immediately
          console.log('🚀 Deploy triggered');
          return new Response(JSON.stringify({ success: true, message: 'Deploy triggered' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        return new Response(JSON.stringify({ success: true, message: 'Ignored (not main branch)' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.error('❌ Webhook error:', error);
        return new Response('Error processing webhook', { status: 500 });
      }
    }
    
    return new Response('Not found', { status: 404 });
  },
});

console.log(`🎣 Webhook server listening on port ${server.port}`);
console.log(`   POST /webhook - GitHub webhook endpoint`);
console.log(`   GET  /health  - Health check`);
