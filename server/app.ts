import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { validateOrigin } from './middleware/auth';
import { filesRouter } from './routes/filesRoutes';
import {
  aiRouter,
  alertsRouter,
  scriptsRouter,
} from './routes/miscRoutes';
import { pm2Router } from './routes/pm2Routes';
import { serverRouter } from './routes/serverRoutes';
import { vaultRouter } from './routes/vaultRoutes';
import { metricsService } from './services/metricsService';
import { demoBackend } from './ssh/demoBackend';
import { attachWsServer } from './ws/wsServer';

export function createWatchPm2Server() {
  const app = express();
  app.disable('x-powered-by');
  app.use(validateOrigin);
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'WatchPM2', version: '1.0.0' });
  });

  app.use('/api/vault', vaultRouter);
  app.use('/api/servers', serverRouter);
  app.use('/api/servers/:id/pm2', pm2Router);
  app.use('/api/servers/:id/files', filesRouter);
  app.use('/api/scripts', scriptsRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/ai', aiRouter);

  const clientDistDir = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(path.join(clientDistDir, 'index.html'))) {
    app.use(express.static(clientDistDir));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = attachWsServer(httpServer);

  const unsubCrash = demoBackend.onCrashSimulated(() => {
    void metricsService.pollServer('demo-server');
  });

  return {
    app,
    httpServer,
    wss,
    start(port = Number(process.env.PORT) || 4321, host = '127.0.0.1') {
      metricsService.start();
      return new Promise<{ port: number; host: string }>((resolve) => {
        httpServer.listen(port, host, () => {
          const addr = httpServer.address();
          const actualPort =
            typeof addr === 'object' && addr ? addr.port : port;
          resolve({ port: actualPort, host });
        });
      });
    },
    close() {
      unsubCrash();
      metricsService.stop();
      wss.close();
      return new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
