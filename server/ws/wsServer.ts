import { Server as HttpServer } from 'node:http';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { WsClientMessage, WsServerMessage } from '@shared/types';
import { isAllowedLocalOrigin } from '../middleware/auth';
import { alertService } from '../services/alertService';
import { logStreamService } from '../services/logStreamService';
import { metricsService } from '../services/metricsService';
import { scriptService } from '../services/scriptService';
import { terminalService } from '../services/terminalService';
import { vaultStore } from '../vault/vaultStore';

interface ClientState {
  ws: WebSocket;
  subscribedServers: Set<string>;
  logStreams: Set<string>;
  terminalSessions: Set<string>;
}

export function attachWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientState>();

  const send = (ws: WebSocket, msg: WsServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const unsubTelemetry = metricsService.onTelemetry((snapshot) => {
    for (const c of clients) {
      if (c.subscribedServers.has(snapshot.serverId)) {
        send(c.ws, { type: 'telemetry:update', snapshot });
      }
    }
  });

  const unsubAlerts = alertService.onAlertFired((event) => {
    for (const c of clients) {
      send(c.ws, { type: 'alert:fired', event });
    }
  });

  const unsubLock = vaultStore.onLocked(() => {
    for (const c of clients) {
      for (const sid of c.logStreams) logStreamService.stopStream(sid);
      for (const tid of c.terminalSessions) terminalService.closeSession(tid);
      c.logStreams.clear();
      c.terminalSessions.clear();
      c.subscribedServers.clear();
      send(c.ws, { type: 'vault:locked' });
      c.ws.close(4001, 'Vault locked');
    }
  });

  wss.on('close', () => {
    unsubTelemetry();
    unsubAlerts();
    unsubLock();
  });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const origin = request.headers.origin;
      if (!isAllowedLocalOrigin(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const parsedUrl = new URL(
        request.url || '/',
        `http://${request.headers.host || '127.0.0.1'}`,
      );
      if (parsedUrl.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const token = parsedUrl.searchParams.get('token');
      if (!vaultStore.isValidToken(token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const state: ClientState = {
      ws,
      subscribedServers: new Set(),
      logStreams: new Set(),
      terminalSessions: new Set(),
    };
    clients.add(state);

    ws.on('message', (raw) => {
      if (vaultStore.getState() !== 'unlocked') {
        send(ws, { type: 'vault:locked' });
        return;
      }
      vaultStore.touchActivity();

      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString('utf8')) as WsClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'telemetry:subscribe') {
        for (const id of msg.serverIds) {
          if (!state.subscribedServers.has(id)) {
            state.subscribedServers.add(id);
            metricsService.addSubscription(id);
            const srv = vaultStore.getServer(id);
            if (srv) {
              send(ws, {
                type: 'telemetry:update',
                snapshot: metricsService.getSnapshot(srv),
              });
            }
          }
        }
      } else if (msg.type === 'telemetry:unsubscribe') {
        for (const id of msg.serverIds) {
          if (state.subscribedServers.has(id)) {
            state.subscribedServers.delete(id);
            metricsService.removeSubscription(id);
          }
        }
      } else if (msg.type === 'logs:start') {
        const srv = vaultStore.getServer(msg.serverId);
        if (!srv) {
          send(ws, {
            type: 'logs:error',
            streamId: msg.streamId,
            message: 'Server not found.',
          });
          return;
        }
        state.logStreams.add(msg.streamId);
        void logStreamService.startStream({
          streamId: msg.streamId,
          server: srv,
          processName: msg.processName,
          lines: msg.lines,
          onChunk: (source, line) => {
            send(ws, {
              type: 'logs:chunk',
              streamId: msg.streamId,
              serverId: srv.id,
              source,
              line,
              timestamp: Date.now(),
            });
          },
          onError: (message) => {
            send(ws, { type: 'logs:error', streamId: msg.streamId, message });
          },
        });
      } else if (msg.type === 'logs:stop') {
        state.logStreams.delete(msg.streamId);
        logStreamService.stopStream(msg.streamId);
      } else if (msg.type === 'terminal:open') {
        const srv = vaultStore.getServer(msg.serverId);
        if (!srv) {
          send(ws, {
            type: 'terminal:closed',
            sessionId: msg.sessionId,
            reason: 'Server not found.',
          });
          return;
        }
        state.terminalSessions.add(msg.sessionId);
        void terminalService.openSession({
          sessionId: msg.sessionId,
          server: srv,
          cols: msg.cols,
          rows: msg.rows,
          initialCwd: msg.initialCwd,
          onData: (data) => {
            send(ws, { type: 'terminal:data', sessionId: msg.sessionId, data });
          },
          onClosed: (reason) => {
            state.terminalSessions.delete(msg.sessionId);
            send(ws, {
              type: 'terminal:closed',
              sessionId: msg.sessionId,
              reason,
            });
          },
        });
      } else if (msg.type === 'terminal:input') {
        terminalService.sendInput(msg.sessionId, msg.data);
      } else if (msg.type === 'terminal:resize') {
        terminalService.resize(msg.sessionId, msg.cols, msg.rows);
      } else if (msg.type === 'terminal:close') {
        state.terminalSessions.delete(msg.sessionId);
        terminalService.closeSession(msg.sessionId);
      } else if (msg.type === 'script:run') {
        const srv = vaultStore.getServer(msg.serverId);
        if (!srv) {
          send(ws, {
            type: 'script:output',
            runId: msg.runId,
            stream: 'stderr',
            chunk: 'Server not found.\n',
          });
          send(ws, {
            type: 'script:done',
            runId: msg.runId,
            exitCode: 1,
            status: 'failed',
          });
          return;
        }
        void scriptService.runScript({
          runId: msg.runId,
          server: srv,
          scriptId: msg.scriptId,
          name: msg.name,
          command: msg.command,
          cwd: msg.cwd,
          onOutput: (stream, chunk) => {
            send(ws, {
              type: 'script:output',
              runId: msg.runId,
              stream,
              chunk,
            });
          },
          onDone: (exitCode, status) => {
            send(ws, {
              type: 'script:done',
              runId: msg.runId,
              exitCode,
              status,
            });
          },
        });
      } else if (msg.type === 'script:cancel') {
        scriptService.cancelRun(msg.runId);
      }
    });

    ws.on('close', () => {
      clients.delete(state);
      for (const id of state.subscribedServers) {
        metricsService.removeSubscription(id);
      }
      for (const sid of state.logStreams) {
        logStreamService.stopStream(sid);
      }
      for (const tid of state.terminalSessions) {
        terminalService.closeSession(tid);
      }
    });
  });

  return wss;
}
