/**
 * Dev helper: create a fresh wallet and print its addresses (mainnet + testnet BTC).
 * Usage:  npx tsx scripts/new-wallet.ts            -> new random phrase
 *         npx tsx scripts/new-wallet.ts "<phrase>" -> addresses for an existing phrase
 * Use ONLY for test wallets. Never paste a real seed phrase into a terminal.
 */
import { deriveAccounts, generateMnemonic } from '../src/index.js';

const phrase = process.argv[2] ?? generateMnemonic();
const a = deriveAccounts(phrase);
const t = deriveAccounts(phrase, { bitcoinNetwork: 'testnet' });
console.log('\nTEST seed phrase (do not use for real funds):\n  ' + phrase + '\n');
console.log('Bitcoin            ', a.bitcoin.address);
console.log('Bitcoin (testnet)  ', t.bitcoin.address);
console.log('ETH / BSC / Polygon', a.evm.address);
console.log('Tron               ', a.tron.address);
console.log('Solana             ', a.solana.address, '\n');
