/**
 * Solana Payment Service
 * 
 * Handles creating USDC transfer transactions for pop402 payments.
 * Based on pop402-gallery reference implementation.
 *
 * All Solana RPC calls are proxied through the backend to avoid browser
 * CORS restrictions from public RPC endpoints (api.mainnet-beta.solana.com
 * returns 403 to browser requests).
 */

import { API_BASE } from './api';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// USDC mint address on Solana mainnet
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// Solana RPC proxy — routes through our backend to avoid CORS 403s.
// The backend at /api/v1/me/wallet/rpc forwards allowed methods to Solana RPC.
const RPC_PROXY_PATH = '/api/v1/me/wallet/rpc';

// Auth token for the RPC proxy (set before purchase flow begins)
let _authToken: string | null = null;

/**
 * Set the auth token used for RPC proxy requests.
 * Must be called before createUSDCTransferTransaction.
 */
export function setAuthToken(token: string) {
  _authToken = token;
}

/**
 * Build the full RPC proxy URL at call time.
 * Connection requires an absolute URL (http/https). When API_BASE is empty
 * (same-origin deployment), we resolve against the current page origin.
 */
function getRpcProxyUrl(): string {
  if (API_BASE) return `${API_BASE}${RPC_PROXY_PATH}`;
  if (typeof window !== 'undefined') return `${window.location.origin}${RPC_PROXY_PATH}`;
  return `http://localhost:3000${RPC_PROXY_PATH}`;
}

/**
 * Create a Connection that routes through our backend RPC proxy.
 * Requires setAuthToken() to have been called first.
 */
function createProxiedConnection(): Connection {
  const url = getRpcProxyUrl();
  if (!_authToken) {
    console.warn('[SolanaPayment] No auth token set for RPC proxy — calls may fail');
  }
  console.log('[SolanaPayment] Creating proxied connection to:', url);
  return new Connection(url, {
    commitment: 'confirmed',
    httpHeaders: _authToken ? { Authorization: `Bearer ${_authToken}` } : {},
  });
}

/**
 * Create a USDC transfer transaction
 * 
 * @param fromWallet - Sender's wallet public key (base58 string)
 * @param toWallet - Recipient's wallet public key (base58 string) 
 * @param amountUSDC - Amount in USDC (e.g., 10 for $10)
 * @returns Transaction object and Connection for signing
 */
export async function createUSDCTransferTransaction(
  fromWallet: string,
  toWallet: string,
  amountUSDC: number
): Promise<{ transaction: Transaction; connection: Connection }> {
  const connection = createProxiedConnection();
  
  const fromPubkey = new PublicKey(fromWallet);
  const toPubkey = new PublicKey(toWallet);
  
  // Convert USDC amount to smallest units (6 decimals)
  const amount = Math.round(amountUSDC * Math.pow(10, USDC_DECIMALS));
  
  console.log('[SolanaPayment] Creating USDC transfer:', {
    from: fromWallet,
    to: toWallet,
    amountUSDC,
    amountRaw: amount,
  });
  
  // Get the associated token accounts for sender and recipient
  const fromTokenAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    fromPubkey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const toTokenAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    toPubkey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  console.log('[SolanaPayment] Token accounts:', {
    from: fromTokenAccount.toBase58(),
    to: toTokenAccount.toBase58(),
  });
  
  // Create the transaction
  const transaction = new Transaction();
  
  // Following pop402-gallery pattern: Always add CreateATA instruction
  // The instruction will be a no-op if the account already exists (using idempotent version)
  // This ensures consistent transaction structure for verification
  let needsCreateAta = false;
  try {
    await getAccount(connection, toTokenAccount);
    console.log('[SolanaPayment] Recipient token account exists');
  } catch (error) {
    needsCreateAta = true;
    console.log('[SolanaPayment] Will create recipient token account');
  }
  
  // Add CreateATA instruction if needed (following reference pattern)
  if (needsCreateAta) {
    // Use idempotent create (won't fail if account exists)
    const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
    const createAtaData = Buffer.from([1]); // CreateIdempotent instruction
    
    const createAtaInstruction = new TransactionInstruction({
      keys: [
        { pubkey: fromPubkey, isSigner: true, isWritable: true },
        { pubkey: toTokenAccount, isSigner: false, isWritable: true },
        { pubkey: toPubkey, isSigner: false, isWritable: false },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      data: createAtaData,
    });
    transaction.add(createAtaInstruction);
  }
  
  // Add TransferChecked instruction (opcode 12) - this is what pop402 expects
  // Reference: pop402-gallery uses opcode 12 with amount + decimals
  // Instruction data format: [opcode(1), amount(8), decimals(1)]
  const instructionData = Buffer.alloc(10);
  instructionData[0] = 12; // TransferChecked opcode
  // Set amount as little-endian u64
  instructionData.writeBigUInt64LE(BigInt(amount), 1);
  instructionData[9] = USDC_DECIMALS; // decimals
  
  const transferInstruction = new TransactionInstruction({
    keys: [
      { pubkey: fromTokenAccount, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: toTokenAccount, isSigner: false, isWritable: true },
      { pubkey: fromPubkey, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data: instructionData,
  });
  transaction.add(transferInstruction);
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = fromPubkey;
  
  console.log('[SolanaPayment] Transaction created with blockhash:', blockhash);
  
  return { transaction, connection };
}

/**
 * Add a signature to a transaction and serialize it
 * 
 * @param transaction - The transaction to sign
 * @param signature - The signature bytes
 * @param publicKey - The signer's public key
 * @returns Base64 encoded signed transaction
 */
export function addSignatureAndSerialize(
  transaction: Transaction,
  signature: Uint8Array,
  publicKey: string
): string {
  const pubkey = new PublicKey(publicKey);
  transaction.addSignature(pubkey, Buffer.from(signature));
  
  // Serialize the full signed transaction
  const serialized = transaction.serialize();
  
  // Return as base64
  return Buffer.from(serialized).toString('base64');
}

/**
 * Get USDC balance for a wallet.
 *
 * Calls the backend API which proxies the Solana RPC call server-side,
 * avoiding browser CORS restrictions from public RPC endpoints.
 *
 * Returns:
 *   - A number >= 0 when the call succeeds (0 means the USDC token account
 *     genuinely does not exist for this wallet yet).
 *   - null when the call fails so the caller can show "--" rather than
 *     a misleading "$0.00".
 *
 * @param walletAddress - Wallet public key (base58 string)
 * @param authToken - JWT auth token for the backend API
 */
export async function getUSDCBalance(walletAddress: string, authToken: string): Promise<number | null> {
  try {
    const response = await fetch(
      `${API_BASE}/api/v1/me/wallet/balance?address=${encodeURIComponent(walletAddress)}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    if (!response.ok) {
      console.error('[SolanaPayment] Balance API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    const balance = data.balance;

    if (typeof balance === 'number') {
      console.log('[SolanaPayment] USDC balance:', balance);
      return balance;
    }

    console.warn('[SolanaPayment] Balance API returned null (RPC error)');
    return null;
  } catch (error: any) {
    console.error('[SolanaPayment] Error fetching USDC balance:', error?.message || error);
    return null;
  }
}

export const solanaPayment = {
  createUSDCTransferTransaction,
  addSignatureAndSerialize,
  getUSDCBalance,
  USDC_MINT: USDC_MINT.toBase58(),
  USDC_DECIMALS,
};

export default solanaPayment;
