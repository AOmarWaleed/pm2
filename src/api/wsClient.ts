import { WsClientMessage, WsServerMessage } from '@shared/types';
import { getVaultToken } from './client';

type MessageListener = (msg: WsServerMessage) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageListener>();
  private queue: WsClientMessage[] = [];
  private reconnectTimer: number | null = null;
  private intentionalClose = false;
  private activeSubscriptions = new Set<string>();

  public connect(): void {
    const token = getVaultToken();
    if (!token) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.intentionalClose = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.activeSubscriptions.size > 0) {
        this.send({
          type: 'telemetry:subscribe',
          serverIds: [...this.activeSubscriptions],
        });
      }
      const pending = [...this.queue];
      this.queue = [];
      for (const msg of pending) {
        this.send(msg);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as WsServerMessage;
        for (const listener of this.listeners) {
          listener(msg);
        }
      } catch {
        // ignore malformed frame
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose && getVaultToken()) {
        this.reconnectTimer = window.setTimeout(() => {
          this.connect();
        }, 2000);
      }
    };
  }

  public disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  public send(msg: WsClientMessage): void {
    if (msg.type === 'telemetry:subscribe') {
      for (const id of msg.serverIds) this.activeSubscriptions.add(id);
    } else if (msg.type === 'telemetry:unsubscribe') {
      for (const id of msg.serverIds) this.activeSubscriptions.delete(id);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  public subscribe(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const wsClient = new WsClient();
