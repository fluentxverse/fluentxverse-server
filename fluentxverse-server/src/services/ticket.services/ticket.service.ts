import * as path from "path";
import {
  getAddress,
  parseAbiItem,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { ticketChain, ticketPublicClient as publicClient } from '../../config/ticketChain';
import { getIO } from "../../socket/socket.server";
import { NotificationService } from "../notification.services/notification.service";
import { getDriver } from "../../db/memgraph";
import { v4 as uuidv4 } from "uuid";
import { TICKETS_PER_LESSON, REFUND_POLICY } from "../../config/constant";
import { gmrEngine } from "../web3.services/gmrEngine.service";
import { cancellationRefundService } from './cancellationRefund.service';
import { attendanceStartMs } from "../schedule.services/attendanceWindow";
import { canReserveForBooking } from "../schedule.services/bookingPolicy";

// Contract configuration
const TICKET_CONTRACT_ADDRESS = process.env.TICKET_CONTRACT_ADDRESS || "";
const CHAIN_ID = ticketChain.id;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS || "";
const TICKET_BASIC_TOKEN_ID = process.env.TICKET_BASIC_TOKEN_ID || "";
const TICKET_PREMIUM_TOKEN_ID = process.env.TICKET_PREMIUM_TOKEN_ID || "";
const TICKET_TRIAL_TOKEN_ID = process.env.TICKET_TRIAL_TOKEN_ID || "";

export const isMockTicketMode = process.env.ALLOW_MOCK_TICKET_PURCHASES === "true";

const mockTokenId = (tier: TicketTier) => `mock-${tier}`;

const erc1155Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mintTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "uri", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "mintAdditionalSupplyTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "additionalSupply", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const transferSingleEvent = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");

// Notification service instance
const notificationService = new NotificationService();

// Minting status types
export type MintingStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface MintingResult {
  transactionId: string;
  status: MintingStatus;
  tokenId?: string;
  tier: TicketTier;
  supply: number;
  mintType: 'create' | 'additional';
  error?: string;
}

// Ticket tier types - Basic, Premium, and Trial
export type TicketTier = 'basic' | 'premium' | 'trial';

// Simplified ticket interface (stored on-chain)
export interface Ticket {
  tokenId: string;
  tier: TicketTier;
  price: number;
  supply: number;
  name: string;
  description: string;
  imageUri?: string;
  createdAt: string; // ISO date string stored in metadata
  contractAddress: string;
}

// Request to create a new ticket type (Basic or Premium)
export interface CreateTicketRequest {
  tier: TicketTier;
  price: number;
  supply: number;
}

// Request to mint additional supply
export interface MintAdditionalRequest {
  tokenId: string;
  quantity: number;
}

// Ticket purchase record (stored in Memgraph)
export interface TicketPurchase {
  id: string;
  buyerWallet: string;
  userId?: string; // Optional: link to User node if available
  tokenId: string;
  tier: TicketTier;
  quantity: number;
  pricePerTicket: number;
  totalPrice: number;
  transferTxId: string;
  paymentTxHash?: string; // From checkout widget
  purchaseDate: string;
  status: 'pending' | 'completed' | 'failed';
}

// Ticket transaction types for lesson bookings
export type TicketTransactionType = 'booking' | 'cancellation' | 'refund' | 'purchase' | 'admin_adjustment';

// Ticket transaction record for booking/refund tracking (stored in Memgraph)
export interface TicketTransaction {
  id: string;
  studentId: string;
  studentWallet: string;
  tutorId?: string;
  bookingId?: string;
  slotId?: string;
  tokenId: string;
  tier: TicketTier;
  quantity: number;
  type: TicketTransactionType;
  status: 'pending' | 'completed' | 'failed';
  transferTxId?: string;
  reason?: string;
  createdAt: string;
  completedAt?: string;
  refundPhase?: string;
}

// Input for deducting ticket when booking
export interface DeductTicketInput {
  studentId: string;
  studentWallet: string;
  tutorId: string;
  bookingId: string;
  slotId: string;
  tier?: TicketTier; // Optional, defaults to 'basic'
}

// Input for recording ticket deduction (when transfer is done on frontend)
export interface RecordTicketDeductionInput {
  studentId: string;
  studentWallet: string;
  tutorId: string;
  bookingId: string;
  slotId: string;
  tier?: TicketTier;
  transferTxHash?: string; // Transaction hash from frontend transfer
}

// Input for refunding ticket on cancellation
export interface RefundTicketInput {
  studentId: string;
  studentWallet: string;
  bookingId: string;
  transactionId: string; // Original deduction transaction ID
  reason?: string;
}


export class TicketService {
  private assetsPath: string;

  constructor() {
    this.assetsPath = path.join(__dirname, '../../assets/ticket');
  }

  /**
   * Get the image path for a ticket tier
   */
  private getTicketImagePath(tier: TicketTier): string {
    return path.join(this.assetsPath, `${tier}_ticket.png`);
  }

  /**
   * Upload ticket image to IPFS
   */
  async uploadTicketImage(tier: TicketTier): Promise<string> {
    return `${process.env.API_PUBLIC_URL || process.env.API_BASE_URL || ""}/tickets/image/${tier}`;
  }

  private getContractAddress(): Address {
    if (!TICKET_CONTRACT_ADDRESS) throw new Error('Configure a lesson-ticket contract on the selected network before using on-chain tickets.');
    return getAddress(TICKET_CONTRACT_ADDRESS);
  }

  private getVaultWalletAddress(): Address {
    if (!VAULT_WALLET_ADDRESS) {
      throw new Error('VAULT_WALLET_ADDRESS is required for ticket transfers');
    }
    return getAddress(VAULT_WALLET_ADDRESS);
  }

  private async readTicketBalance(owner: string, tokenId: string): Promise<number> {
    const balance = await publicClient.readContract({
      address: this.getContractAddress(),
      abi: erc1155Abi,
      functionName: "balanceOf",
      args: [getAddress(owner), BigInt(tokenId)],
    });

    return Number(balance);
  }

  private async enqueueTicketTransfer(params: {
    from: string;
    to: string;
    tokenId: string;
    quantity: number;
    walletAddress?: string;
  }): Promise<string> {
    const transaction = await gmrEngine.contractWrite({
      abi: erc1155Abi,
      args: [
        getAddress(params.from),
        getAddress(params.to),
        params.tokenId,
        String(params.quantity),
        "0x",
      ],
      chainId: CHAIN_ID,
      contractAddress: TICKET_CONTRACT_ADDRESS,
      functionName: "safeTransferFrom",
      walletAddress: params.walletAddress || params.from,
    });

    return transaction.transactionHash || transaction.id;
  }

  /**
   * Send real-time notification to admin via socket
   */
  private async sendAdminNotification(
    type: 'minting_started' | 'minting_success' | 'minting_failed',
    title: string,
    message: string,
    data: Record<string, any>
  ) {
    const io = getIO();
    
    // Create notification in database
    const notification = await notificationService.createNotification({
      userId: 'admin', // Admin user ID - could be a list of admin IDs
      userType: 'admin',
      type,
      title,
      message,
      data,
    });

    // Send real-time notification via socket
    if (io) {
      // Broadcast to admin room
      io.to('notifications:admin').emit('notification:new', notification);
      // Also emit to a general admin channel for minting updates
      io.emit('minting:update', {
        type,
        ...data,
        timestamp: new Date().toISOString(),
      });
    }

    return notification;
  }

  /**
   * Poll for minting status and send notifications
   */
  async pollMintingStatus(
    transactionId: string,
    tier: TicketTier,
    supply: number,
    mintType: 'create' | 'additional',
    tokenId?: string
  ): Promise<MintingResult> {
    const maxAttempts = 60; // Poll for up to 5 minutes (60 * 5 seconds)
    const pollInterval = 5000; // 5 seconds

    let attempts = 0;
    let lastStatus: MintingStatus = 'pending';

    while (attempts < maxAttempts) {
      try {
        const statusResult = await this.getMintingStatus(transactionId);

        if (statusResult === 'confirmed' || statusResult === 'CONFIRMED' || statusResult === 'mined') {
          // Success!
          const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
          await this.sendAdminNotification(
            'minting_success',
            `${tierName} Tickets Minted Successfully`,
            mintType === 'create'
              ? `Successfully minted ${supply} ${tierName} lesson tickets.`
              : `Successfully minted ${supply} additional ${tierName} tickets.`,
            {
              transactionId,
              tier,
              supply,
              mintType,
              tokenId,
            }
          );

          return {
            transactionId,
            status: 'confirmed',
            tokenId,
            tier,
            supply,
            mintType,
          };
        }

        if (statusResult === 'failed' || statusResult === 'FAILED' || statusResult === 'errored') {
          // Failed
          const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
          await this.sendAdminNotification(
            'minting_failed',
            `${tierName} Ticket Minting Failed`,
            `Failed to mint ${supply} ${tierName} tickets. Please try again.`,
            {
              transactionId,
              tier,
              supply,
              mintType,
              tokenId,
              errorMessage: 'Transaction failed on-chain',
            }
          );

          return {
            transactionId,
            status: 'failed',
            tier,
            supply,
            mintType,
            error: 'Transaction failed on-chain',
          };
        }

        // Still pending/submitted
        if (statusResult === 'submitted' && lastStatus === 'pending') {
          lastStatus = 'submitted';
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error(`Error polling minting status (attempt ${attempts}):`, error);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    // Timeout - still pending after max attempts
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    await this.sendAdminNotification(
      'minting_failed',
      `${tierName} Ticket Minting Timeout`,
      `Minting of ${supply} ${tierName} tickets is taking longer than expected. Transaction ID: ${transactionId}`,
      {
        transactionId,
        tier,
        supply,
        mintType,
        tokenId,
        errorMessage: 'Minting timeout - check transaction status manually',
      }
    );

    return {
      transactionId,
      status: 'pending',
      tier,
      supply,
      mintType,
      error: 'Minting timeout',
    };
  }

  /**
   * Create a new ticket type (Basic or Premium) and mint initial NFTs
   * Only 2 ticket types should exist - one Basic, one Premium
   */
  async createTicket(request: CreateTicketRequest): Promise<{ ticket: Ticket; transactionId: string }> {
    const { tier, price, supply } = request;
    const createdAt = new Date().toISOString();

    // Check if this tier already exists on-chain
    const existingTickets = await this.getTickets();
    const existingTier = existingTickets.find(t => t.tier === tier);
    if (existingTier) {
      throw new Error(`${tier.charAt(0).toUpperCase() + tier.slice(1)} ticket already exists (Token ID: ${existingTier.tokenId}). Use mint additional supply instead.`);
    }

    // Upload image to IPFS
    const imageUri = await this.uploadTicketImage(tier);

    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    const name = `${tierName} Lesson Ticket`;
    const description = `FluentXverse ${tierName} Lesson Ticket - Redeem for one 25-minute lesson session. Never expires.`;

    const nftMetadata = {
      name,
      description,
      image: imageUri,
      attributes: [
        { trait_type: "Tier", value: tierName },
        { trait_type: "Price", value: `$${price}` },
        { trait_type: "Created", value: createdAt },
      ],
    };

    const transaction = await gmrEngine.contractWrite({
      abi: erc1155Abi,
      args: [VAULT_WALLET_ADDRESS, JSON.stringify(nftMetadata), String(supply)],
      chainId: CHAIN_ID,
      contractAddress: TICKET_CONTRACT_ADDRESS,
      functionName: "mintTo",
      walletAddress: VAULT_WALLET_ADDRESS,
    });
    const transactionId = transaction.id;


    // Send minting started notification
    await this.sendAdminNotification(
      'minting_started',
      `${tierName} Ticket Minting Started`,
      `Minting ${supply} ${tierName} lesson tickets...`,
      {
        transactionId,
        tier,
        supply,
        mintType: 'create',
      }
    );

    // Start polling for minting status in the background (non-blocking)
    this.pollMintingStatus(transactionId, tier, supply, 'create').catch(err => {
      console.error('Error in background minting status poll:', err);
    });

    // Return the ticket info immediately (don't wait for confirmation)
    const ticket: Ticket = {
      tokenId: transactionId, // Temporary - will be replaced when fetched from chain
      tier,
      price,
      supply,
      name,
      description,
      imageUri,
      createdAt,
      contractAddress: TICKET_CONTRACT_ADDRESS,
    };

    return { ticket, transactionId };
  }

  /**
   * Get all tickets from the contract (source of truth)
   * Filters out invalid NFTs that don't have proper ticket attributes
   */
  async getTickets(): Promise<Ticket[]> {
    const configuredTicketCandidates: Array<{ tier: TicketTier; tokenId: string; price: number }> = [
      { tier: "basic", tokenId: TICKET_BASIC_TOKEN_ID, price: 6 },
      { tier: "premium", tokenId: TICKET_PREMIUM_TOKEN_ID, price: 9 },
      { tier: "trial", tokenId: TICKET_TRIAL_TOKEN_ID, price: 0 },
    ];
    const configuredTickets = configuredTicketCandidates.filter((ticket) => ticket.tokenId);

    const tickets = await Promise.all(configuredTickets.map(async ({ tier, tokenId, price }) => {
      let supply = 0n;
      try {
        supply = await publicClient.readContract({
          address: TICKET_CONTRACT_ADDRESS as Address,
          abi: erc1155Abi,
          functionName: "totalSupply",
          args: [BigInt(tokenId)],
        }) as bigint;
      } catch (error) {
        console.warn(`Could not read total supply for ${tier} ticket ${tokenId}:`, error);
      }

      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      return {
        tokenId,
        tier,
        price,
        supply: Number(supply),
        name: `${tierName} Lesson Ticket`,
        description: `FluentXVerse ${tierName} Lesson Ticket - Redeem for one 25-minute lesson session. Never expires.`,
        imageUri: await this.uploadTicketImage(tier),
        createdAt: new Date().toISOString(),
        contractAddress: TICKET_CONTRACT_ADDRESS,
      };
    }));

    return tickets;
  }

  /**
   * Mint additional supply to an existing ticket NFT
   */
  async mintAdditional(request: MintAdditionalRequest): Promise<{ ticket: Ticket; transactionId: string }> {
    const { tokenId, quantity } = request;

    // Verify ticket exists
    const tickets = await this.getTickets();
    const ticket = tickets.find(t => t.tokenId === tokenId);
    
    if (!ticket) {
      throw new Error(`Ticket with token ID ${tokenId} not found`);
    }

    const tierName = ticket.tier.charAt(0).toUpperCase() + ticket.tier.slice(1);

    const transaction = await gmrEngine.contractWrite({
      abi: erc1155Abi,
      args: [VAULT_WALLET_ADDRESS, tokenId, String(quantity)],
      chainId: CHAIN_ID,
      contractAddress: TICKET_CONTRACT_ADDRESS,
      functionName: "mintAdditionalSupplyTo",
      walletAddress: VAULT_WALLET_ADDRESS,
    });
    const transactionId = transaction.id;


    // Send minting started notification
    await this.sendAdminNotification(
      'minting_started',
      `Additional ${tierName} Tickets Minting Started`,
      `Minting ${quantity} additional ${tierName} tickets...`,
      {
        transactionId,
        tier: ticket.tier,
        supply: quantity,
        mintType: 'additional',
        tokenId,
      }
    );

    // Start polling for minting status in the background (non-blocking)
    this.pollMintingStatus(transactionId, ticket.tier, quantity, 'additional', tokenId).catch(err => {
      console.error('Error in background minting status poll:', err);
    });

    // Return updated ticket info immediately (don't wait for confirmation)
    const updatedTicket: Ticket = {
      ...ticket,
      supply: ticket.supply + quantity,
    };

    return { ticket: updatedTicket, transactionId };
  }

  /**
   * Get ticket statistics
   */
  async getTicketStats(): Promise<{
    totalTicketTypes: number;
    totalSupply: number;
    basicTicket: Ticket | null;
    premiumTicket: Ticket | null;
    trialTicket: Ticket | null;
  }> {
    const tickets = await this.getTickets();
    
    const basicTicket = tickets.find(t => t.tier === 'basic') || null;
    const premiumTicket = tickets.find(t => t.tier === 'premium') || null;
    const trialTicket = tickets.find(t => t.tier === 'trial') || null;
    const totalSupply = tickets.reduce((sum, t) => sum + t.supply, 0);

    return {
      totalTicketTypes: tickets.length,
      totalSupply,
      basicTicket,
      premiumTicket,
      trialTicket,
    };
  }

  /**
   * Get minting transaction status from GMR Engine
   */
  private async getMintingStatus(transactionId: string): Promise<string> {
    try {
      const status = await gmrEngine.transaction(transactionId);
      return status.status;
    } catch (error) {
      console.error(`Error fetching transaction status for ${transactionId}:`, error);
      throw error;
    }
  }

  /**
   * Process a ticket purchase - transfers NFT to buyer
   * The NFT metadata is immutable on IPFS, so purchase date tracking
   * should be done in the database instead
   */
  async processPurchase(params: {
    buyerWallet: string;
    tier: TicketTier;
    quantity: number;
    mockTransactionHash?: string;
    userId?: string;
  }): Promise<{
    success: boolean;
    transactionId: string;
    tokenId: string;
    tier: TicketTier;
    quantity: number;
    purchaseDate: string;
    error?: string;
  }> {
    const { buyerWallet, tier, quantity, mockTransactionHash, userId } = params;
    const purchaseDate = new Date().toISOString();

    // CRITICAL VALIDATION at service layer (defense in depth)
    if (!buyerWallet || !buyerWallet.startsWith('0x') || buyerWallet.length !== 42) {
      throw new Error('CRITICAL: Invalid buyer wallet address');
    }

    if (isMockTicketMode) {
      const transactionId = `mock-purchase-${uuidv4()}`;
      const pricePerTicket = tier === 'basic' ? 6 : tier === 'premium' ? 9 : 0;
      const driver = getDriver();
      const session = driver.session();

      try {
        const wallet = buyerWallet.toLowerCase();
        const increments = {
          basic: tier === 'basic' ? quantity : 0,
          premium: tier === 'premium' ? quantity : 0,
          trial: tier === 'trial' ? quantity : 0,
        };

        await session.run(`
          MERGE (balance:MockTicketBalance {walletAddress: $wallet})
          SET balance.basic = coalesce(balance.basic, 0) + $basic,
              balance.premium = coalesce(balance.premium, 0) + $premium,
              balance.trial = coalesce(balance.trial, 0) + $trial,
              balance.updatedAt = datetime()
        `, { wallet, ...increments });

        await this.saveTicketPurchase({
          buyerWallet: wallet,
          userId,
          tokenId: mockTokenId(tier),
          tier,
          quantity,
          pricePerTicket,
          totalPrice: pricePerTicket * quantity,
          transferTxId: transactionId,
          paymentTxHash: mockTransactionHash,
          purchaseDate,
          status: 'completed',
        });

        return {
          success: true,
          transactionId,
          tokenId: mockTokenId(tier),
          tier,
          quantity,
          purchaseDate,
        };
      } finally {
        await session.close();
      }
    }
    
    const vaultWallet = this.getVaultWalletAddress();
    if (buyerWallet.toLowerCase() === vaultWallet.toLowerCase()) {
      throw new Error('CRITICAL: Cannot transfer tickets to vault wallet');
    }


    // Get the token ID for this tier
    const tickets = await this.getTickets();
    const ticket = tickets.find(t => t.tier === tier);

    if (!ticket) {
      throw new Error(`${tier.charAt(0).toUpperCase() + tier.slice(1)} tickets not found. Please contact support.`);
    }

    // Check if we have enough supply
    if (ticket.supply < quantity) {
      throw new Error(`Insufficient ${tier} tickets. Available: ${ticket.supply}, Requested: ${quantity}`);
    }

    try {
      const transferTxId = await this.enqueueTicketTransfer({
        from: vaultWallet,
        to: buyerWallet,
        tokenId: ticket.tokenId,
        quantity,
        walletAddress: vaultWallet,
      });

      // Send notification about the purchase
      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      await this.sendAdminNotification(
        'minting_success',
        `${tierName} Ticket Purchased`,
        `${quantity} ${tierName} ticket(s) transferred to ${buyerWallet.slice(0, 6)}...${buyerWallet.slice(-4)}`,
        {
          transactionId: transferTxId,
          tier,
          quantity,
          buyerWallet,
          purchaseDate,
          mockTransactionHash,
          action: 'purchase',
        }
      );

      // Save purchase record to Memgraph
      const pricePerTicket = tier === 'basic' ? 6 : 9;
      try {
        await this.saveTicketPurchase({
          buyerWallet,
          userId,
          tokenId: ticket.tokenId,
          tier,
          quantity,
          pricePerTicket,
          totalPrice: pricePerTicket * quantity,
          transferTxId,
          paymentTxHash: mockTransactionHash,
          purchaseDate,
          status: 'completed',
        });
      } catch (dbError) {
        // Log but don't fail the purchase - blockchain transfer already succeeded
        console.error('⚠️ Failed to save purchase to Memgraph:', dbError);
      }

      return {
        success: true,
        transactionId: transferTxId,
        tokenId: ticket.tokenId,
        tier,
        quantity,
        purchaseDate,
      };
    } catch (error) {
      console.error('Error processing ticket purchase:', error);
      
      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      await this.sendAdminNotification(
        'minting_failed',
        `${tierName} Ticket Purchase Failed`,
        `Failed to transfer ${quantity} ${tierName} ticket(s) to ${buyerWallet.slice(0, 6)}...${buyerWallet.slice(-4)}`,
        {
          tier,
          quantity,
          buyerWallet,
          purchaseDate,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          action: 'purchase',
        }
      );

      return {
        success: false,
        transactionId: '',
        tokenId: ticket.tokenId,
        tier,
        quantity,
        purchaseDate,
        error: error instanceof Error ? error.message : 'Failed to process purchase',
      };
    }
  }

  /**
   * Get a user's ticket balance for Basic, Premium, and Trial tickets
   * Uses balanceOf from ERC1155 to check on-chain balance
   */
  async getWalletTicketBalance(walletAddress: string): Promise<{
    basic: number;
    premium: number;
    trial: number;
    basicTokenId: string | null;
    premiumTokenId: string | null;
    trialTokenId: string | null;
  }> {

    if (isMockTicketMode) {
      const driver = getDriver();
      const session = driver.session();
      try {
        const result = await session.run(`
          OPTIONAL MATCH (balance:MockTicketBalance {walletAddress: $wallet})
          RETURN coalesce(balance.basic, 0) AS basic,
                 coalesce(balance.premium, 0) AS premium,
                 coalesce(balance.trial, 0) AS trial
        `, { wallet: walletAddress.toLowerCase() });
        const record = result.records[0];
        const asNumber = (value: any) => typeof value === 'object' && value?.toNumber
          ? value.toNumber()
          : Number(value || 0);

        return {
          basic: asNumber(record?.get('basic')),
          premium: asNumber(record?.get('premium')),
          trial: asNumber(record?.get('trial')),
          basicTokenId: mockTokenId('basic'),
          premiumTokenId: mockTokenId('premium'),
          trialTokenId: mockTokenId('trial'),
        };
      } finally {
        await session.close();
      }
    }

    // Get all tickets to find token IDs for basic, premium, and trial
    const tickets = await this.getTickets();
    const basicTicket = tickets.find(t => t.tier === 'basic');
    const premiumTicket = tickets.find(t => t.tier === 'premium');
    const trialTicket = tickets.find(t => t.tier === 'trial');

    let basicBalance = 0;
    let premiumBalance = 0;
    let trialBalance = 0;

    // Get basic ticket balance
    if (basicTicket) {
      try {
        basicBalance = await this.readTicketBalance(walletAddress, basicTicket.tokenId);
      } catch (error) {
        console.error('Error getting basic ticket balance:', error);
      }
    }

    // Get premium ticket balance
    if (premiumTicket) {
      try {
        premiumBalance = await this.readTicketBalance(walletAddress, premiumTicket.tokenId);
      } catch (error) {
        console.error('Error getting premium ticket balance:', error);
      }
    }

    // Get trial ticket balance
    if (trialTicket) {
      try {
        trialBalance = await this.readTicketBalance(walletAddress, trialTicket.tokenId);
      } catch (error) {
        console.error('Error getting trial ticket balance:', error);
      }
    }

    return {
      basic: basicBalance,
      premium: premiumBalance,
      trial: trialBalance,
      basicTokenId: basicTicket?.tokenId || null,
      premiumTokenId: premiumTicket?.tokenId || null,
      trialTokenId: trialTicket?.tokenId || null,
    };
  }

  /**
   * Save a ticket purchase record to Memgraph
   */
  async saveTicketPurchase(purchase: Omit<TicketPurchase, 'id'>): Promise<TicketPurchase> {
    const driver = getDriver();
    const session = driver.session();
    const purchaseId = uuidv4();

    try {
      // Create the TicketPurchase node
      await session.run(`
        CREATE (p:TicketPurchase {
          id: $id,
          buyerWallet: $buyerWallet,
          userId: $userId,
          tokenId: $tokenId,
          tier: $tier,
          quantity: $quantity,
          pricePerTicket: $pricePerTicket,
          totalPrice: $totalPrice,
          transferTxId: $transferTxId,
          paymentTxHash: $paymentTxHash,
          purchaseDate: $purchaseDate,
          status: $status
        })
      `, {
        id: purchaseId,
        buyerWallet: purchase.buyerWallet,
        userId: purchase.userId || null,
        tokenId: purchase.tokenId,
        tier: purchase.tier,
        quantity: purchase.quantity,
        pricePerTicket: purchase.pricePerTicket,
        totalPrice: purchase.totalPrice,
        transferTxId: purchase.transferTxId,
        paymentTxHash: purchase.paymentTxHash || null,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
      });

      // If userId is provided, create relationship to User or Student
      if (purchase.userId) {
        // Try to link to Student first, then User
        await session.run(`
          MATCH (p:TicketPurchase {id: $purchaseId})
          OPTIONAL MATCH (s:Student {id: $userId})
          OPTIONAL MATCH (u:User {id: $userId})
          WITH p, COALESCE(s, u) AS user
          WHERE user IS NOT NULL
          MERGE (user)-[:PURCHASED]->(p)
        `, {
          purchaseId,
          userId: purchase.userId,
        });
      }


      return {
        id: purchaseId,
        ...purchase,
      };
    } catch (error) {
      console.error('Error saving ticket purchase to Memgraph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get purchase history for a wallet address
   */
  async getPurchaseHistoryByWallet(walletAddress: string): Promise<TicketPurchase[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (p:TicketPurchase {buyerWallet: $walletAddress})
        RETURN p
        ORDER BY p.purchaseDate DESC
      `, { walletAddress });

      return result.records.map(record => {
        const p = record.get('p').properties;
        return {
          id: p.id,
          buyerWallet: p.buyerWallet,
          userId: p.userId,
          tokenId: p.tokenId,
          tier: p.tier as TicketTier,
          quantity: typeof p.quantity === 'object' ? p.quantity.toNumber() : p.quantity,
          pricePerTicket: typeof p.pricePerTicket === 'object' ? p.pricePerTicket.toNumber() : p.pricePerTicket,
          totalPrice: typeof p.totalPrice === 'object' ? p.totalPrice.toNumber() : p.totalPrice,
          transferTxId: p.transferTxId,
          paymentTxHash: p.paymentTxHash,
          purchaseDate: p.purchaseDate,
          status: p.status as TicketPurchase['status'],
        };
      });
    } catch (error) {
      console.error('Error fetching purchase history from Memgraph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get purchase history for a user ID
   */
  async getPurchaseHistoryByUserId(userId: string): Promise<TicketPurchase[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      
      // Use comprehensive query like recent activity - check multiple ways to find purchases:
      // 1. By userId property directly on the purchase
      // 2. By PURCHASED relationship from User node
      // 3. By PURCHASED relationship from Student node
      // 4. By buyerWallet matching student's wallet
      const result = await session.run(`
        MATCH (p:TicketPurchase)
        WHERE p.userId = $userId
        RETURN p
        UNION
        MATCH (u:User {id: $userId})-[:PURCHASED]->(p:TicketPurchase)
        RETURN p
        UNION
        MATCH (s:Student {id: $userId})-[:PURCHASED]->(p:TicketPurchase)
        RETURN p
        UNION
        MATCH (s:Student {id: $userId})
        MATCH (p:TicketPurchase)
        WHERE toLower(p.buyerWallet) = toLower(s.walletAddress)
        RETURN p
      `, { userId });

      // Deduplicate purchases (UNION may return duplicates)
      const purchaseMap = new Map();
      result.records.forEach(record => {
        const p = record.get('p').properties;
        if (!purchaseMap.has(p.id)) {
          purchaseMap.set(p.id, {
            id: p.id,
            buyerWallet: p.buyerWallet,
            userId: p.userId,
            tokenId: p.tokenId,
            tier: p.tier as TicketTier,
            quantity: typeof p.quantity === 'object' ? p.quantity.toNumber() : p.quantity,
            pricePerTicket: typeof p.pricePerTicket === 'object' ? p.pricePerTicket.toNumber() : p.pricePerTicket,
            totalPrice: typeof p.totalPrice === 'object' ? p.totalPrice.toNumber() : p.totalPrice,
            transferTxId: p.transferTxId,
            paymentTxHash: p.paymentTxHash,
            purchaseDate: p.purchaseDate,
            status: p.status as TicketPurchase['status'],
          });
        }
      });

      const purchases = Array.from(purchaseMap.values())
        .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());

      return purchases;
    } catch (error) {
      console.error('Error fetching purchase history from Memgraph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get all purchases (admin view) with optional filters
   */
  async getAllPurchases(options?: {
    tier?: TicketTier;
    limit?: number;
    offset?: number;
  }): Promise<{ purchases: TicketPurchase[]; total: number }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      let whereClause = '';
      const params: Record<string, any> = {};

      if (options?.tier) {
        whereClause = 'WHERE p.tier = $tier';
        params.tier = options.tier;
      }

      // Get total count
      const countResult = await session.run(`
        MATCH (p:TicketPurchase)
        ${whereClause}
        RETURN count(p) as total
      `, params);
      const total = countResult.records[0]?.get('total')?.toNumber() || 0;

      // Get purchases with pagination
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      
      const result = await session.run(`
        MATCH (p:TicketPurchase)
        ${whereClause}
        RETURN p
        ORDER BY p.purchaseDate DESC
        SKIP $offset
        LIMIT $limit
      `, { ...params, offset, limit });

      const purchases = result.records.map(record => {
        const p = record.get('p').properties;
        return {
          id: p.id,
          buyerWallet: p.buyerWallet,
          userId: p.userId,
          tokenId: p.tokenId,
          tier: p.tier as TicketTier,
          quantity: typeof p.quantity === 'object' ? p.quantity.toNumber() : p.quantity,
          pricePerTicket: typeof p.pricePerTicket === 'object' ? p.pricePerTicket.toNumber() : p.pricePerTicket,
          totalPrice: typeof p.totalPrice === 'object' ? p.totalPrice.toNumber() : p.totalPrice,
          transferTxId: p.transferTxId,
          paymentTxHash: p.paymentTxHash,
          purchaseDate: p.purchaseDate,
          status: p.status as TicketPurchase['status'],
        };
      });

      return { purchases, total };
    } catch (error) {
      console.error('Error fetching all purchases from Memgraph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get purchase statistics
   */
  async getPurchaseStats(): Promise<{
    totalPurchases: number;
    totalRevenue: number;
    basicSold: number;
    premiumSold: number;
    uniqueBuyers: number;
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (p:TicketPurchase {status: 'completed'})
        RETURN 
          count(p) as totalPurchases,
          sum(p.totalPrice) as totalRevenue,
          sum(CASE WHEN p.tier = 'basic' THEN p.quantity ELSE 0 END) as basicSold,
          sum(CASE WHEN p.tier = 'premium' THEN p.quantity ELSE 0 END) as premiumSold,
          count(DISTINCT p.buyerWallet) as uniqueBuyers
      `);

      const record = result.records[0];
      return {
        totalPurchases: record?.get('totalPurchases')?.toNumber() || 0,
        totalRevenue: record?.get('totalRevenue')?.toNumber() || 0,
        basicSold: record?.get('basicSold')?.toNumber() || 0,
        premiumSold: record?.get('premiumSold')?.toNumber() || 0,
        uniqueBuyers: record?.get('uniqueBuyers')?.toNumber() || 0,
      };
    } catch (error) {
      console.error('Error fetching purchase stats from Memgraph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // ==========================================
  // TICKET USAGE FOR LESSON BOOKINGS
  // ==========================================

  /**
   * Deduct a ticket from student when booking a lesson
   * Transfers the NFT ticket from student wallet to vault wallet ON-CHAIN
   */
  async deductTicketForBooking(input: DeductTicketInput): Promise<TicketTransaction> {
    const { studentId, studentWallet, tutorId, bookingId, slotId, tier = 'basic' } = input;
    const transactionId = uuidv4();
    const createdAt = new Date().toISOString();


    // Get the token ID for this tier
    const tickets = await this.getTickets();
    const ticket = tickets.find(t => t.tier === tier);

    if (!ticket) {
      throw new Error(`${tier.charAt(0).toUpperCase() + tier.slice(1)} tickets not found. Please contact support.`);
    }

    // Check student's ticket balance
    const balance = await this.getWalletTicketBalance(studentWallet);
    const studentBalance = tier === 'basic' ? balance.basic : balance.premium;

    if (studentBalance < TICKETS_PER_LESSON) {
      throw new Error(`Insufficient ${tier} tickets. You have ${studentBalance} but need ${TICKETS_PER_LESSON} to book a lesson.`);
    }

    // Create pending transaction record in Memgraph first
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.run(`
        CREATE (t:TicketTransaction {
          id: $id,
          studentId: $studentId,
          studentWallet: $studentWallet,
          tutorId: $tutorId,
          bookingId: $bookingId,
          slotId: $slotId,
          tokenId: $tokenId,
          tier: $tier,
          quantity: $quantity,
          type: 'booking',
          status: 'pending',
          reason: 'Lesson booking',
          createdAt: $createdAt
        })
      `, {
        id: transactionId,
        studentId,
        studentWallet,
        tutorId,
        bookingId,
        slotId,
        tokenId: ticket.tokenId,
        tier,
        quantity: TICKETS_PER_LESSON,
        createdAt,
      });

      // Link to Student and Booking nodes (booking may not exist yet, so use OPTIONAL)
      await session.run(`
        MATCH (t:TicketTransaction {id: $transactionId})
        MATCH (s:Student {id: $studentId})
        MERGE (s)-[:MADE_TRANSACTION]->(t)
      `, { transactionId, studentId });

      const transferTxId = await this.enqueueTicketTransfer({
        from: studentWallet,
        to: this.getVaultWalletAddress(),
        tokenId: ticket.tokenId,
        quantity: TICKETS_PER_LESSON,
        walletAddress: studentWallet,
      });

      // Update transaction to completed with the real transfer tx ID
      await session.run(`
        MATCH (t:TicketTransaction {id: $transactionId})
        SET t.status = 'completed',
            t.transferTxId = $transferTxId,
            t.completedAt = $completedAt
      `, {
        transactionId,
        transferTxId,
        completedAt: new Date().toISOString(),
      });


      return {
        id: transactionId,
        studentId,
        studentWallet,
        tutorId,
        bookingId,
        slotId,
        tokenId: ticket.tokenId,
        tier,
        quantity: TICKETS_PER_LESSON,
        type: 'booking',
        status: 'completed',
        transferTxId,
        reason: 'Lesson booking',
        createdAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[TicketService] Error deducting ticket:', error);
      
      // Mark transaction as failed if it was created
      await session.run(`
        MATCH (t:TicketTransaction {id: $transactionId})
        SET t.status = 'failed', t.reason = $reason
      `, {
        transactionId,
        reason: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {}); // Ignore error if transaction doesn't exist

      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Refund a ticket to student when cancelling a booking
   * Only refunds if cancellation is more than 1 hour before scheduled time
   */
  async refundTicketForCancellation(input: RefundTicketInput & { scheduledTime: Date }): Promise<TicketTransaction | null> {
    return cancellationRefundService.process(input.bookingId);
  }

  /**
   * Get ticket transaction history for a student
   */
  async getStudentTransactionHistory(studentId: string): Promise<TicketTransaction[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:Student {id: $studentId})-[:MADE_TRANSACTION]->(t:TicketTransaction)
        RETURN t
        ORDER BY t.createdAt DESC
      `, { studentId });

      return result.records.map(record => {
        const t = record.get('t').properties;
        return {
          id: t.id,
          studentId: t.studentId,
          studentWallet: t.studentWallet,
          tutorId: t.tutorId,
          bookingId: t.bookingId,
          slotId: t.slotId,
          tokenId: t.tokenId,
          tier: t.tier as TicketTier,
          quantity: typeof t.quantity === 'object' ? t.quantity.toNumber() : t.quantity,
          type: t.type as TicketTransactionType,
          status: t.status as TicketTransaction['status'],
          transferTxId: t.transferTxId,
          reason: t.reason,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        };
      });
    } catch (error) {
      console.error('Error fetching student transaction history:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get the original booking transaction for a booking ID
   */
  async getBookingTransaction(bookingId: string): Promise<TicketTransaction | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (t:TicketTransaction {bookingId: $bookingId, type: 'booking'})
        RETURN t
        LIMIT 1
      `, { bookingId });

      if (result.records.length === 0) {
        return null;
      }

      const t = result.records[0]?.get('t').properties;
      return {
        id: t.id,
        studentId: t.studentId,
        studentWallet: t.studentWallet,
        tutorId: t.tutorId,
        bookingId: t.bookingId,
        slotId: t.slotId,
        tokenId: t.tokenId,
        tier: t.tier as TicketTier,
        quantity: typeof t.quantity === 'object' ? t.quantity.toNumber() : t.quantity,
        type: t.type as TicketTransactionType,
        status: t.status as TicketTransaction['status'],
        transferTxId: t.transferTxId,
        reason: t.reason,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      };
    } catch (error) {
      console.error('Error fetching booking transaction:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Verify a ticket transfer transaction on-chain
   * Checks that the transaction:
   * 1. Exists and was successful
   * 2. Was sent to the vault wallet
   * 3. Interacted with our ticket contract
   */
  async verifyTicketTransfer(txHash: string, expectedFromWallet: string): Promise<{
    valid: boolean;
    error?: string;
    tier?: TicketTier;
    tokenId?: string;
  }> {
    try {
      if (isMockTicketMode && txHash.startsWith('mock-ticket-')) {
        const driver = getDriver();
        const session = driver.session();
        try {
          const result = await session.run(`
            MATCH (transfer:MockTicketTransfer {
              transactionHash: $txHash,
              walletAddress: $wallet,
              status: 'pending'
            })
            RETURN transfer.transactionHash AS transactionHash, transfer.tier AS tier
          `, { txHash, wallet: expectedFromWallet.toLowerCase() });

          if (result.records.length === 0) {
            return { valid: false, error: 'Mock ticket transfer was not found or has already been used' };
          }

          return {
            valid: true,
            tier: result.records[0]?.get('tier') as TicketTier,
          };
        } finally {
          await session.close();
        }
      }
      
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as Hash,
      });

      if (!receipt) {
        return { valid: false, error: 'Transaction not found on blockchain' };
      }


      // Check transaction was successful (status 1)
      if (receipt.status !== 'success') {
        return { valid: false, error: 'Transaction failed on blockchain' };
      }

      const transferEvents = parseEventLogs({
        abi: [transferSingleEvent],
        logs: receipt.logs,
        eventName: "TransferSingle",
      });

      const expectedFrom = getAddress(expectedFromWallet);
      const expectedTo = this.getVaultWalletAddress();
      const contractAddress = this.getContractAddress();
      const foundValidTransfer = transferEvents.find((event) => {
        if (getAddress(event.address) !== contractAddress) {
          return false;
        }

        const { from, to, value } = event.args;
        return getAddress(from) === expectedFrom
          && getAddress(to) === expectedTo
          && value >= BigInt(TICKETS_PER_LESSON);
      });

      if (!foundValidTransfer) {
        return { valid: false, error: 'No valid ticket transfer from student to vault found in transaction' };
      }

      const tokenId = foundValidTransfer.args.id?.toString();
      const tier = (await this.getTickets()).find(ticket => ticket.tokenId === tokenId)?.tier;
      if (!tier) return { valid: false, error: 'Transfer is not for a recognized lesson ticket' };
      return { valid: true, tokenId, tier };
    } catch (error: any) {
      console.error('[TicketService] Error verifying transaction:', error);
      return { valid: false, error: `Verification failed: ${error.message}` };
    }
  }

  async recoverUnbookedTransfer(studentId: string, txHash: string, slotId: string, reservationId: string): Promise<{
    status: 'booked' | 'refunded' | 'processing'; bookingId?: string; refundTxHash?: string;
  }> {
    const session = getDriver().session();
    try {
      const student = await session.run(
        `MATCH (s:Student {id: $studentId})
         RETURN s.externalWalletAddress AS external, s.smartWalletAddress AS smart`,
        { studentId }
      );
      const wallet = student.records[0]?.get('external') || student.records[0]?.get('smart');
      if (!wallet) throw new Error('Student wallet not found');

      const booked = await session.run(
        `MATCH (b:Booking {studentId: $studentId, ticketTransferTxHash: $txHash})
         RETURN b.bookingId AS bookingId`,
        { studentId, txHash }
      );
      if (booked.records.length) {
        return { status: 'booked', bookingId: booked.records[0]!.get('bookingId') };
      }
      // A booking request may still be committing after the client times out.
      const activeHold = await session.run(
        `MATCH (s:TimeSlot {slotId: $slotId, status: 'pending', pendingBy: $studentId,
                            reservationId: $reservationId})
         WHERE s.pendingUntil > datetime()
         RETURN s.slotDate AS date, s.slotTime AS time,
                s.attendanceMarked AS attendanceMarked`,
        { slotId, studentId, reservationId }
      );
      if (activeHold.records.length) {
        const hold = activeHold.records[0]!;
        const startMs = attendanceStartMs({ date: hold.get('date'), time: hold.get('time') });
        if (canReserveForBooking(startMs, Date.now(), hold.get('attendanceMarked') === 'present')) {
          return { status: 'processing' };
        }
      }
      const recorded = await session.run(
        `MATCH (t:TicketTransaction {transferTxId: $txHash}) RETURN t.id AS id`, { txHash }
      );
      if (recorded.records.length) throw new Error('This ticket transfer is already linked to a transaction');

      const priorRecovery = await session.run(
        `MATCH (r:TicketRecovery {txHash: $txHash})
         RETURN r.status AS status, r.refundTxHash AS refundTxHash`, { txHash }
      );
      if (priorRecovery.records.length) {
        const row = priorRecovery.records[0]!;
        if (row.get('status') === 'refunded') {
          return { status: 'refunded', refundTxHash: row.get('refundTxHash') || undefined };
        }
        return { status: 'processing' };
      }

      const verification = await this.verifyTicketTransfer(txHash, wallet);
      if (!verification.valid) throw new Error(verification.error || 'Ticket transfer could not be verified');

      if (isMockTicketMode && txHash.startsWith('mock-ticket-')) {
        const tier = verification.tier;
        if (!tier) throw new Error('Mock ticket tier is missing');
        const property = tier === 'basic' ? 'basic' : tier === 'premium' ? 'premium' : 'trial';
        const restored = await session.executeWrite(async tx => tx.run(
          `MATCH (transfer:MockTicketTransfer {transactionHash: $txHash,
                                               studentId: $studentId, status: 'pending'})
           MATCH (balance:MockTicketBalance {walletAddress: $wallet})
           WHERE NOT EXISTS { MATCH (:Booking {ticketTransferTxHash: $txHash}) }
           SET transfer.status = 'refunded', transfer.refundedAt = datetime(),
               balance.${property} = coalesce(balance.${property}, 0) + transfer.quantity,
               balance.updatedAt = datetime()
           CREATE (r:TicketRecovery {txHash: $txHash, studentId: $studentId,
                                     status: 'refunded', createdAt: datetime(), completedAt: datetime()})
           RETURN r.txHash AS txHash`,
          { txHash, studentId, wallet: wallet.toLowerCase() }
        ));
        if (!restored.records.length) throw new Error('Ticket was already used or recovered');
        return { status: 'refunded' };
      }

      if (!verification.tokenId) throw new Error('Ticket token ID could not be verified');
      const claimed = await session.executeWrite(async tx => tx.run(
        `MATCH (s:Student {id: $studentId})
         WHERE NOT EXISTS { MATCH (:Booking {ticketTransferTxHash: $txHash}) }
           AND NOT EXISTS { MATCH (:TicketRecovery {txHash: $txHash}) }
         CREATE (r:TicketRecovery {txHash: $txHash, studentId: $studentId,
                                   walletAddress: $wallet, tokenId: $tokenId,
                                   status: 'processing', createdAt: datetime()})
         RETURN r.txHash AS txHash`,
        { txHash, studentId, wallet, tokenId: verification.tokenId }
      ));
      if (!claimed.records.length) throw new Error('Ticket transfer is already booked or being recovered');
      try {
        const refundTxHash = await this.enqueueTicketTransfer({
          from: this.getVaultWalletAddress(), to: wallet,
          tokenId: verification.tokenId, quantity: TICKETS_PER_LESSON,
          walletAddress: this.getVaultWalletAddress()
        });
        await session.run(
          `MATCH (r:TicketRecovery {txHash: $txHash})
           SET r.status = 'refunded', r.refundTxHash = $refundTxHash,
               r.completedAt = datetime()`,
          { txHash, refundTxHash }
        );
        return { status: 'refunded', refundTxHash };
      } catch (error) {
        await session.run(
          `MATCH (r:TicketRecovery {txHash: $txHash})
           SET r.status = 'failed', r.error = $error`,
          { txHash, error: error instanceof Error ? error.message : String(error) }
        );
        throw new Error('Ticket recovery needs support review; keep your transfer hash');
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Record a ticket deduction that was done on the frontend
   * This is called after the frontend successfully transfers the ticket to the vault
   * It verifies the transaction on-chain and records it in the database
   */
  async recordTicketDeduction(input: RecordTicketDeductionInput): Promise<TicketTransaction> {
    const { studentId, studentWallet, tutorId, bookingId, slotId, tier = 'basic', transferTxHash } = input;
    const transactionId = uuidv4();
    const createdAt = new Date().toISOString();


    // Verify the transaction on-chain if hash is provided
    if (transferTxHash) {
      const verification = await this.verifyTicketTransfer(transferTxHash, studentWallet);
      if (!verification.valid) {
        console.error(`[TicketService] ❌ Transaction verification failed: ${verification.error}`);
        throw new Error(`Invalid ticket transfer: ${verification.error}`);
      }
    } else {
      console.warn(`[TicketService] ⚠️ No transaction hash provided - cannot verify`);
    }

    // Get the token ID for this tier (for record keeping)
    const tickets = await this.getTickets();
    const ticket = tickets.find(t => t.tier === tier);
    const tokenId = ticket?.tokenId || 'unknown';

    const driver = getDriver();
    const session = driver.session();

    try {
      // Create completed transaction record in Memgraph
      await session.run(`
        CREATE (t:TicketTransaction {
          id: $id,
          studentId: $studentId,
          studentWallet: $studentWallet,
          tutorId: $tutorId,
          bookingId: $bookingId,
          slotId: $slotId,
          tokenId: $tokenId,
          tier: $tier,
          quantity: $quantity,
          type: 'booking',
          status: 'completed',
          transferTxId: $transferTxId,
          reason: 'Lesson booking (frontend transfer)',
          createdAt: $createdAt,
          completedAt: $completedAt
        })
      `, {
        id: transactionId,
        studentId,
        studentWallet,
        tutorId,
        bookingId,
        slotId,
        tokenId,
        tier,
        quantity: TICKETS_PER_LESSON,
        transferTxId: transferTxHash || `frontend_${transactionId}`,
        createdAt,
        completedAt: createdAt,
      });

      // Link to Student node
      await session.run(`
        MATCH (t:TicketTransaction {id: $transactionId})
        MATCH (s:Student {id: $studentId})
        MERGE (s)-[:MADE_TRANSACTION]->(t)
      `, { transactionId, studentId });

      if (isMockTicketMode && transferTxHash?.startsWith('mock-ticket-')) {
        await session.run(`
          MATCH (transfer:MockTicketTransfer {transactionHash: $transferTxHash, status: 'pending'})
          SET transfer.status = 'used', transfer.bookingId = $bookingId, transfer.usedAt = datetime()
        `, { transferTxHash, bookingId });
      }


      return {
        id: transactionId,
        studentId,
        studentWallet,
        tutorId,
        bookingId,
        slotId,
        tokenId,
        tier,
        quantity: TICKETS_PER_LESSON,
        type: 'booking',
        status: 'completed',
        transferTxId: transferTxHash || `frontend_${transactionId}`,
        reason: 'Lesson booking (frontend transfer)',
        createdAt,
        completedAt: createdAt,
      };
    } catch (error) {
      console.error('[TicketService] Error recording ticket deduction:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  async consumeMockTicket(params: {
    walletAddress: string;
    studentId: string;
    tier: TicketTier;
    quantity: number;
  }): Promise<{ transactionHash: string; balance: Awaited<ReturnType<TicketService['getWalletTicketBalance']>> }> {
    if (!isMockTicketMode) {
      throw new Error('Mock ticket transfers are disabled');
    }

    const { walletAddress, studentId, tier, quantity } = params;
    const wallet = walletAddress.toLowerCase();
    const property = tier === 'basic' ? 'basic' : tier === 'premium' ? 'premium' : 'trial';
    const transactionHash = `mock-ticket-${uuidv4()}`;
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (balance:MockTicketBalance {walletAddress: $wallet})
        WHERE coalesce(balance.${property}, 0) >= $quantity
        SET balance.${property} = balance.${property} - $quantity,
            balance.updatedAt = datetime()
        CREATE (transfer:MockTicketTransfer {
          transactionHash: $transactionHash,
          walletAddress: $wallet,
          studentId: $studentId,
          tier: $tier,
          quantity: $quantity,
          status: 'pending',
          createdAt: datetime()
        })
        RETURN balance.${property} AS remaining
      `, { wallet, studentId, tier, quantity, transactionHash });

      if (result.records.length === 0) {
        throw new Error(`Insufficient ${tier} tickets`);
      }

      await session.run(`
        MATCH (student:Student {id: $studentId})
        SET student.externalWalletAddress = $wallet
      `, { studentId, wallet });
    } finally {
      await session.close();
    }

    return {
      transactionHash,
      balance: await this.getWalletTicketBalance(wallet),
    };
  }

  /**
   * Transfer a trial ticket to a newly registered user
   * This is called automatically after successful registration
   */
  async transferTrialTicketToNewUser(userWallet: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    try {
      
      // Get all tickets to find the trial ticket
      const tickets = await this.getTickets();
      const trialTicket = tickets.find(t => t.tier === 'trial');
      
      if (!trialTicket) {
        return { success: false, error: 'No trial tickets available' };
      }
      
      // Check vault balance for trial tickets
      const vaultWallet = this.getVaultWalletAddress();
      const vaultBalance = await this.readTicketBalance(vaultWallet, trialTicket.tokenId);
      
      if (vaultBalance < 1) {
        return { success: false, error: 'No trial tickets available in vault' };
      }
      
      const transactionId = await this.enqueueTicketTransfer({
        from: vaultWallet,
        to: userWallet,
        tokenId: trialTicket.tokenId,
        quantity: 1,
        walletAddress: vaultWallet,
      });

      // Send notification about the welcome gift
      await this.sendAdminNotification(
        'minting_success',
        'Welcome Trial Ticket Sent',
        `1 Trial ticket sent to new user ${userWallet.slice(0, 6)}...${userWallet.slice(-4)}`,
        {
          transactionId,
          tier: 'trial',
          quantity: 1,
          buyerWallet: userWallet,
          action: 'welcome_gift',
        }
      );
      
      return { success: true, transactionId };
    } catch (error: any) {
      console.error('[TicketService] Error transferring trial ticket:', error);
      return { success: false, error: error.message || 'Failed to transfer trial ticket' };
    }
  }
}

export const ticketService = new TicketService();
