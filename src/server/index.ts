import { serve } from '@hono/node-server';
import { Board } from '../core/board.ts';
import { backupIfDue } from '../core/db.ts';
import { getWallet } from '../core/wallet.ts';
import { loadConfig } from './config.ts';
import { Owner } from './owner.ts';
import { tokenVerifier } from './oauth.ts';
import { createServers } from './http.ts';
import { fileKeys, rewardVerifier, rewardsServer } from './rewards.ts';

// Fail fast on bad configuration: a deployed instance must never start half-secured.
const cfg = loadConfig();
const board = new Board();
const wallet = getWallet(board);
const owner = cfg.credentialFile ? Owner.fromFile(cfg.credentialFile, board) : null;
const verifyToken = cfg.oauth ? tokenVerifier(cfg.oauth) : null;

const { ui, mcp } = createServers(board, cfg, { owner, verifyToken });
const rewards = cfg.rewardsPort ? rewardsServer(board, rewardVerifier(fileKeys(cfg.rewardsJwksFile!))) : null;

const runBackup = () => {
  try {
    backupIfDue(board.db, board.dbPath);
  } catch (e: any) {
    console.error(`[hey-ann] Backup failed: ${e.message}`);
  }
};
setTimeout(runBackup, 60_000).unref();
setInterval(runBackup, 3600_000).unref();
// The wallet's clock: daily allowance, no-plan forfeits and closing finished days (all idempotent).
const tickWallet = () => { try { wallet.tick(); } catch (e: any) { console.error(`[hey-ann] Wallet tick failed: ${e.message}`); } };
setTimeout(tickWallet, 5_000).unref();
setInterval(tickWallet, 60_000).unref();

const servers = [
  serve({ fetch: ui.fetch, port: cfg.port, hostname: cfg.host }, () => {
    console.log(`Hey Ann   ${cfg.publicOrigin ?? `http://localhost:${cfg.port}`}  (listening on ${cfg.host}:${cfg.port})`);
    if (owner) console.log('Login     password (remembered 30 days per device)');
    if (!cfg.deployed && !cfg.oauth) console.log(`MCP HTTP  http://localhost:${cfg.port}/mcp  (bearer token: Settings > Connect AI)`);
  }),
];
if (mcp && cfg.mcpPort) {
  servers.push(serve({ fetch: mcp.fetch, port: cfg.mcpPort, hostname: cfg.host }, () => {
    console.log(`MCP       ${cfg.oauth!.resource}  (Orbit Identity OAuth; listening on ${cfg.host}:${cfg.mcpPort})`);
  }));
}

if (rewards && cfg.rewardsPort) {
  servers.push(serve({ fetch: rewards.fetch, port: cfg.rewardsPort, hostname: cfg.host }, () => {
    console.log(`Rewards   POST /internal/rewards  (Socrates' signed study events; listening on ${cfg.host}:${cfg.rewardsPort})`);
  }));
}

// Kubernetes stops the pod with SIGTERM: stop accepting requests, then close SQLite cleanly.
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  let open = servers.length;
  const done = () => {
    try { board.close(); } catch {}
    process.exit(0);
  };
  for (const s of servers) s.close(() => { if (--open === 0) done(); });
  // Open SSE streams keep the server from closing; don't wait for them.
  setTimeout(done, 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
