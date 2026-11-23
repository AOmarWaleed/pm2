import { createWatchPm2Server } from './app';
import { sshPool } from './ssh/sshPool';

const server = createWatchPm2Server();

server.start().then(({ host, port }) => {
  console.log(`[WatchPM2] Listening strictly on http://${host}:${port}`);
});

const shutdown = async () => {
  sshPool.disconnectAll();
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
