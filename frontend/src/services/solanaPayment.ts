/**
 * Solana Payment Service
 * 
 * Handles creating USDC transfer transactions for pop402 payments.
 * Based on pop402-gallery reference implementation.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// USDC mint address on Solana mainnet
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// Solana RPC endpoint
// IMPORTANT: Set VITE_SOLANA_RPC_URL in your .env for production.
// The official mainnet-beta endpoint is used as a fallback.
// For higher rate limits use a dedicated provider: Helius, QuickNode, or Alchemy.
const RPC_ENDPOINT = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Log RPC endpoint being used (helpful for debugging)
console.log('[SolanaPayment] Using RPC endpoint:', RPC_ENDPOINT.includes('api-key') ? RPC_ENDPOINT.split('?')[0] + '?api-key=***' : RPC_ENDPOINT);

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
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  
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
 * Returns:
 *   - A number >= 0 when the call succeeds (0 means the USDC token account
 *     genuinely does not exist for this wallet yet).
 *   - null when the RPC call fails (network error, rate-limit, etc.) so the
 *     caller can show "--" rather than a misleading "$0.00".
 *
 * @param walletAddress - Wallet public key (base58 string)
 */
export async function getUSDCBalance(walletAddress: string): Promise<number | null> {
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const pubkey = new PublicKey(walletAddress);

  try {
    // Use getParsedTokenAccountsByOwner — more robust than getAccount:
    // - No need to derive ATA address first
    // - Returns empty array (not an error) when wallet has no USDC
    // - Returns pre-parsed balance data (no manual decimal math)
    // - Catches USDC in any token account, not just the ATA
    const response = await connection.getParsedTokenAccountsByOwner(pubkey, {
      mint: USDC_MINT,
    });

    if (response.value.length === 0) {
      console.log('[SolanaPayment] No USDC token account found — balance is $0.00');
      return 0;
    }

    // Sum balances across all USDC token accounts (usually just one ATA)
    let totalBalance = 0;
    for (const account of response.value) {
      const uiAmount = account.account.data.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof uiAmount === 'number') {
        totalBalance += uiAmount;
      }
    }

    console.log('[SolanaPayment] USDC balance:', totalBalance);
    return totalBalance;
  } catch (error: any) {
    console.error('[SolanaPayment] RPC error fetching USDC balance:', error);
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
