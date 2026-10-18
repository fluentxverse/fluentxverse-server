import Elysia, { t } from 'elysia';
import { privatePassMode } from '../services/lessonPasses/policy';
import { trialLaunchMode } from '../services/schedule.services/trialPolicy';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isMockTicketMode, ticketService, type TicketTier } from '@/services/ticket.services/ticket.service';
import { cacheGetOrSet, invalidateCache } from '@/db/redis';
import { getIO } from '@/socket/socket.server';
import { notifyTicketReceived } from '@/socket/handlers/ticket.handler';
import { verifyAuthToken, verifyAdminToken } from '@/utils/jwt';
import * as fs from 'fs';
import * as path from 'path';

const isProduction = process.env.NODE_ENV === 'production';

const Ticket = new Elysia({ prefix: '/tickets' })
  .onBeforeHandle(async ({ request, path, cookie, set }) => {
    if (trialLaunchMode() && request.method === 'POST' && !path.includes('/refund')) {
      set.status = 409; return { success: false, error: 'Ticketing is paused during the free trial launch' };
    }
    if (privatePassMode() && request.method === 'POST' && ['/purchase','/consume','/mint'].some(suffix => path.endsWith(suffix))) {
      set.status = 409; return { success: false, error: 'New lesson credits use private passes; legacy refunds and history remain available' };
    }
    const restricted = (request.method === 'POST' && (path === '/tickets/' || path === '/tickets' || path.endsWith('/mint'))) || path === '/tickets/purchases' || path === '/tickets/purchases/stats';
    if (restricted && !await createAdminGuard(cookie, set, 'finance')) return { success: false, error: 'Finance permission required' };
  })
  /**
   * Get all tickets from contract (source of truth)
   * GET /tickets
   */
  .get('/', async () => {
    try {
      const tickets = await ticketService.getTickets();
      return {
        success: true,
        data: tickets
      };
    } catch (error) {
      console.error('Error in GET /tickets:', error);
      return {
        success: false,
        error: 'Failed to get tickets'
      };
    }
  })

  /**
   * Get ticket statistics
   * GET /tickets/stats
   */
  .get('/stats', async () => {
    try {
      const stats = await ticketService.getTicketStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Error in GET /tickets/stats:', error);
      return {
        success: false,
        error: 'Failed to get ticket statistics'
      };
    }
  })

  /**
   * Create a new ticket type (Basic or Premium) - Admin only
   * Only 2 ticket types should exist on contract
   * POST /tickets
   */
  .post('/', async ({ body }) => {
    try {
      const { tier, price, supply } = body;

      // Validate tier
      if (tier !== 'basic' && tier !== 'premium' && tier !== 'trial') {
        return {
          success: false,
          error: 'Invalid tier. Must be "basic", "premium", or "trial"'
        };
      }

      const { ticket, transactionId } = await ticketService.createTicket({
        tier,
        price: Number(price),
        supply: Number(supply),
      });

      return {
        success: true,
        data: {
          ticket,
          transactionId,
        },
        message: `${tier.charAt(0).toUpperCase() + tier.slice(1)} ticket minting started. You will be notified when complete.`
      };
    } catch (error) {
      console.error('Error in POST /tickets:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create ticket'
      };
    }
  }, {
    body: t.Object({
      tier: t.Union([t.Literal('basic'), t.Literal('premium'), t.Literal('trial')]),
      price: t.Number(),
      supply: t.Number(),
    })
  })

  /**
   * Mint additional supply for existing ticket (Admin only)
   * POST /tickets/:tokenId/mint
   */
  .post('/:tokenId/mint', async ({ params, body }) => {
    try {
      const { quantity } = body;

      if (!quantity || quantity < 1) {
        return {
          success: false,
          error: 'Quantity must be at least 1'
        };
      }

      const { ticket, transactionId } = await ticketService.mintAdditional({
        tokenId: params.tokenId,
        quantity: Number(quantity),
      });

      return {
        success: true,
        data: {
          ticket,
          transactionId,
        },
        message: `Minting ${quantity} additional ${ticket.tier} tickets started. You will be notified when complete.`
      };
    } catch (error) {
      console.error('Error in POST /tickets/:tokenId/mint:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to mint additional supply'
      };
    }
  }, {
    body: t.Object({
      quantity: t.Number()
    })
  })

  /**
   * Get ticket image file
   * GET /tickets/image/:tier
   */
  .get('/image/:tier', async ({ params, set }) => {
    try {
      const tier = params.tier as TicketTier;
      
      if (tier !== 'basic' && tier !== 'premium' && tier !== 'trial') {
        set.status = 400;
        return { error: 'Invalid tier' };
      }

      const imagePath = path.join(__dirname, '../assets/ticket', `${tier}_ticket.png`);
      
      if (!fs.existsSync(imagePath)) {
        set.status = 404;
        return { error: 'Image not found' };
      }

      // Return the image file
      set.headers['Content-Type'] = 'image/png';
      set.headers['Cache-Control'] = 'public, max-age=31536000'; // Cache for 1 year
      return Bun.file(imagePath);
    } catch (error) {
      console.error('Error in GET /tickets/image/:tier:', error);
      set.status = 500;
      return { error: 'Failed to get ticket image' };
    }
  })

  /**
   * Process ticket purchase - transfers NFT to buyer
   * SECURITY: This endpoint is DISABLED in production.
   * In production, purchases must be processed through the configured payment gateway/webhook.
   * This endpoint only exists for development/testing with mock transactions.
   * POST /tickets/purchase
   */
  .post('/purchase', async ({ body, cookie, set }) => {
    // CRITICAL SECURITY: Disable in production - purchases should go through verified payment flow
    if (isProduction && !isMockTicketMode) {
      set.status = 403;
      return {
        success: false,
        error: 'Direct purchase endpoint is disabled. Use the payment gateway.'
      };
    }
    
    
    try {
      const { buyerWallet, tier, quantity, mockTransactionHash } = body;
      let userId = body.userId;

      if (isMockTicketMode) {
        const raw = cookie.studentAuth?.value;
        const payload = raw ? await verifyAuthToken(String(raw)) : null;
        if (!payload) {
          set.status = 401;
          return { success: false, error: 'Please sign in before purchasing tickets' };
        }
        userId = payload.userId;
      }

      // CRITICAL VALIDATION: Ensure buyer wallet is valid
      if (!buyerWallet || !buyerWallet.startsWith('0x')) {
        return {
          success: false,
          error: 'Invalid buyer wallet address'
        };
      }
      
      // CRITICAL: Validate wallet address length (standard Ethereum address)
      if (buyerWallet.length !== 42) {
        return {
          success: false,
          error: 'Invalid buyer wallet address format'
        };
      }
      
      // CRITICAL: Prevent sending to vault/server wallet (would be sending to ourselves!)
      const vaultWallet = process.env.VAULT_WALLET_ADDRESS?.toLowerCase();
      if (vaultWallet && buyerWallet.toLowerCase() === vaultWallet) {
        return {
          success: false,
          error: 'Invalid buyer wallet - cannot send to system wallet'
        };
      }
      
      // Additional safety check: Prevent common invalid/placeholder addresses
      const invalidAddresses = [
        '0x0000000000000000000000000000000000000000', // Zero address
        '0xdead000000000000000000000000000000000000', // Dead address
      ];
      if (invalidAddresses.includes(buyerWallet.toLowerCase())) {
        return {
          success: false,
          error: 'Invalid buyer wallet address'
        };
      }

      if (tier !== 'basic' && tier !== 'premium' && tier !== 'trial') {
        return {
          success: false,
          error: 'Invalid tier. Must be "basic", "premium", or "trial"'
        };
      }

      if (!quantity || quantity < 1) {
        return {
          success: false,
          error: 'Quantity must be at least 1'
        };
      }


      // Process the purchase - transfer NFT to buyer
      const result = await ticketService.processPurchase({
        buyerWallet,
        tier,
        quantity: Number(quantity),
        mockTransactionHash,
        userId,
      });


      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to process purchase'
        };
      }

      // Invalidate ticket balance cache after successful purchase
      const cacheKey = `ticket:balance:${buyerWallet.toLowerCase()}`;
      await invalidateCache(cacheKey);
      
      // Invalidate student activity cache if userId provided
      if (userId) {
        await Promise.all([
          invalidateCache(`student:activity:${userId}:10`),
          invalidateCache(`student:activity:${userId}:50`),
        ]);
        
        // Send real-time notification via WebSocket
        const io = getIO();
        if (io) {
          notifyTicketReceived(io, userId, {
            tier: result.tier as 'basic' | 'premium' | 'trial',
            quantity: result.quantity,
            transactionId: result.transactionId,
          });
        }
      }

      return {
        success: true,
        data: {
          transactionId: result.transactionId,
          tokenId: result.tokenId,
          tier: result.tier,
          quantity: result.quantity,
          purchaseDate: result.purchaseDate,
        },
        message: `Successfully processed purchase of ${quantity} ${tier} ticket(s). Transfer initiated.`
      };
    } catch (error) {
      console.error('Error in POST /tickets/purchase:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process purchase'
      };
    }
  }, {
    body: t.Object({
      buyerWallet: t.String(),
      tier: t.Union([t.Literal('basic'), t.Literal('premium'), t.Literal('trial')]),
      quantity: t.Number(),
      mockTransactionHash: t.Optional(t.String()),
      userId: t.Optional(t.String()),
    })
  })

  .post('/consume', async ({ body, cookie, set }) => {
    if (!isMockTicketMode) {
      set.status = 404;
      return { success: false, error: 'Not found' };
    }

    try {
      const raw = cookie.studentAuth?.value;
      const payload = raw ? await verifyAuthToken(String(raw)) : null;
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Please sign in before booking a lesson' };
      }

      const data = await ticketService.consumeMockTicket({
        walletAddress: body.walletAddress,
        studentId: payload.userId,
        tier: body.tier,
        quantity: body.quantity,
      });
      await invalidateCache(`ticket:balance:${body.walletAddress.toLowerCase()}`);

      return { success: true, data };
    } catch (error) {
      set.status = 400;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to use ticket',
      };
    }
  }, {
    body: t.Object({
      walletAddress: t.String({ minLength: 42, maxLength: 42 }),
      tier: t.Union([t.Literal('basic'), t.Literal('premium'), t.Literal('trial')]),
      quantity: t.Number({ minimum: 1, maximum: 10 }),
    })
  })

  /**
   * Get wallet's ticket balance (Basic and Premium)
   * GET /tickets/balance/:walletAddress
   * Cached for 30 seconds to reduce blockchain RPC calls
   */
  .get('/balance/:walletAddress', async ({ params }) => {
    try {
      const { walletAddress } = params;

      if (!walletAddress || !walletAddress.startsWith('0x')) {
        return {
          success: false,
          error: 'Invalid wallet address'
        };
      }

      // Cache ticket balance for 15 seconds (shorter TTL for more responsive updates)
      const cacheKey = `ticket:balance:${walletAddress.toLowerCase()}`;
      const balance = await cacheGetOrSet(cacheKey, 15, () => 
        ticketService.getWalletTicketBalance(walletAddress)
      );

      return {
        success: true,
        data: balance
      };
    } catch (error) {
      console.error('Error in GET /tickets/balance/:walletAddress:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get ticket balance'
      };
    }
  })

  /**
   * Invalidate ticket balance cache for a wallet
   * POST /tickets/invalidate-cache/:walletAddress
   * Called after booking or purchasing tickets
   */
  .post('/invalidate-cache/:walletAddress', async ({ params }) => {
    try {
      const { walletAddress } = params;
      
      if (!walletAddress || !walletAddress.startsWith('0x')) {
        return { success: false, error: 'Invalid wallet address' };
      }

      const cacheKey = `ticket:balance:${walletAddress.toLowerCase()}`;
      await invalidateCache(cacheKey);
      
      return { success: true, message: 'Cache invalidated' };
    } catch (error) {
      console.error('Error invalidating cache:', error);
      return { success: false, error: 'Failed to invalidate cache' };
    }
  })

  /**
   * Get my purchase history (authenticated user)
   * GET /tickets/my-purchases
   * Uses the auth cookie to get the user's purchases
   */
  .get('/my-purchases', async ({ cookie, set }) => {
    try {
      // Get user ID from studentAuth cookie
      const raw = cookie.studentAuth?.value;
      
      if (!raw) {
        set.status = 401;
        return {
          success: false,
          error: 'Authentication required'
        };
      }

      // Verify JWT token
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        console.error('🔐 my-purchases: Invalid or expired JWT token');
        set.status = 401;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }
      
      const userId = payload.userId;

      if (!userId) {
        set.status = 401;
        return {
          success: false,
          error: 'User ID not found in authentication'
        };
      }

      const purchases = await ticketService.getPurchaseHistoryByUserId(userId);

      return {
        success: true,
        data: purchases
      };
    } catch (error) {
      console.error('Error in GET /tickets/my-purchases:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get purchase history'
      };
    }
  })

  /**
   * Get purchase history for a wallet address
   * GET /tickets/purchases/:walletAddress
   */
  .get('/purchases/:walletAddress', async ({ params }) => {
    try {
      const { walletAddress } = params;

      if (!walletAddress || !walletAddress.startsWith('0x')) {
        return {
          success: false,
          error: 'Invalid wallet address'
        };
      }

      const purchases = await ticketService.getPurchaseHistoryByWallet(walletAddress);

      return {
        success: true,
        data: purchases
      };
    } catch (error) {
      console.error('Error in GET /tickets/purchases/:walletAddress:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get purchase history'
      };
    }
  })

  /**
   * Get all purchases (admin view) with optional filters
   * GET /tickets/purchases
   */
  .get('/purchases', async ({ query }) => {
    try {
      const tier = query.tier as 'basic' | 'premium' | undefined;
      const limit = query.limit ? parseInt(query.limit as string) : undefined;
      const offset = query.offset ? parseInt(query.offset as string) : undefined;

      const result = await ticketService.getAllPurchases({ tier, limit, offset });

      return {
        success: true,
        data: result.purchases,
        total: result.total
      };
    } catch (error) {
      console.error('Error in GET /tickets/purchases:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get purchases'
      };
    }
  })

  /**
   * Get purchase statistics (admin view)
   * GET /tickets/purchases/stats
   */
  .get('/purchases/stats', async () => {
    try {
      const stats = await ticketService.getPurchaseStats();

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Error in GET /tickets/purchases/stats:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get purchase stats'
      };
    }
  });

export default Ticket;
