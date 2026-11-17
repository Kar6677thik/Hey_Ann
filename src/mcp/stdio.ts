import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Board } from '../core/board.ts';
import { buildMcpServer } from './server.ts';
import { getWallet } from '../core/wallet.ts';

// stdout carries the protocol; never log to it.
console.log = console.error;

const board = new Board();
// Register the wallet's after-commit hook so card changes made over stdio still reconcile credit.
getWallet(board);
const server = buildMcpServer(board, { client: 'local' });
await server.connect(new StdioServerTransport());
