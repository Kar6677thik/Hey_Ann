import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Board } from '../core/board.ts';
import { buildMcpServer } from './server.ts';

// stdout carries the protocol; never log to it.
console.log = console.error;

const board = new Board();
const server = buildMcpServer(board, { client: 'local' });
await server.connect(new StdioServerTransport());
