import React, { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Plus, Terminal as TerminalIcon, X } from 'lucide-react';
import { ServerPublicConfig } from '@shared/types';
import { wsClient } from '@/api/wsClient';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

interface TermTab {
  sessionId: string;
  label: string;
  initialCwd?: string;
}

const TerminalInstance: React.FC<{
  server: ServerPublicConfig;
  sessionId: string;
  initialCwd?: string;
  active: boolean;
}> = ({ server, sessionId, initialCwd, active }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || server.connectionStatus !== 'connected') return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#10b981',
        selectionBackground: 'rgba(16, 185, 129, 0.25)',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    wsClient.send({
      type: 'terminal:open',
      sessionId,
      serverId: server.id,
      cols: term.cols || 100,
      rows: term.rows || 30,
      initialCwd,
    });

    const dataDispose = term.onData((data) => {
      wsClient.send({ type: 'terminal:input', sessionId, data });
    });

    const unsubWs = wsClient.subscribe((msg) => {
      if (msg.type === 'terminal:data' && msg.sessionId === sessionId) {
        term.write(msg.data);
      } else if (
        msg.type === 'terminal:closed' &&
        msg.sessionId === sessionId
      ) {
        term.writeln(
          `\r\n\x1b[33m[Session closed${msg.reason ? `: ${msg.reason}` : ''}]\x1b[0m`,
        );
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        wsClient.send({
          type: 'terminal:resize',
          sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        // ignore layout transitions
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      unsubWs();
      dataDispose.dispose();
      wsClient.send({ type: 'terminal:close', sessionId });
      term.dispose();
    };
  }, [server.id, server.connectionStatus, sessionId, initialCwd]);

  useEffect(() => {
    if (active && fitRef.current && termRef.current) {
      try {
        fitRef.current.fit();
        termRef.current.focus();
      } catch {
        // ignore
      }
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className={`h-full w-full overflow-hidden rounded-b-2xl bg-zinc-950 ${
        active ? 'block' : 'hidden'
      }`}
    />
  );
};

export const SshTerminalView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { terminalCwdByServer, connectServer } = useApp();

  const [tabs, setTabs] = useState<TermTab[]>(() => [
    {
      sessionId: `term-${server.id}-${Date.now()}`,
      label: 'Shell 1',
      initialCwd: terminalCwdByServer[server.id] || server.defaultCwd,
    },
  ]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].sessionId);

  const addTab = (cwd?: string) => {
    const id = `term-${server.id}-${Date.now()}`;
    const label = `Shell ${tabs.length + 1}`;
    setTabs((prev) => [...prev, { sessionId: id, label, initialCwd: cwd }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((item) => item.sessionId !== id);
      if (next.length === 0) {
        const fresh: TermTab = {
          sessionId: `term-${server.id}-${Date.now()}`,
          label: 'Shell 1',
          initialCwd: server.defaultCwd,
        };
        setActiveId(fresh.sessionId);
        return [fresh];
      }
      if (activeId === id) {
        setActiveId(next[next.length - 1].sessionId);
      }
      return next;
    });
  };

  if (server.connectionStatus !== 'connected') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <TerminalIcon className="h-8 w-8 text-zinc-400" />
        <p className="mt-3 text-xs text-zinc-500">{t.terminal.disconnected}</p>
        <button
          onClick={() => void connectServer(server.id)}
          className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          {t.fleet.connect}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {t.terminal.title}
        </h1>
        <button
          onClick={() => addTab(server.defaultCwd)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t.terminal.newTab}</span>
        </button>
      </div>

      <div className="mt-3 flex flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-xl">
        <div
          dir="ltr"
          className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/90 px-2 py-1.5"
        >
          {tabs.map((tab) => (
            <div
              key={tab.sessionId}
              onClick={() => setActiveId(tab.sessionId)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-mono transition ${
                activeId === tab.sessionId
                  ? 'bg-zinc-800 text-emerald-300'
                  : 'text-zinc-400 hover:bg-zinc-800/50'
              }`}
            >
              <TerminalIcon className="h-3 w-3" />
              <span>{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.sessionId);
                }}
                className="rounded p-0.5 hover:bg-zinc-700 hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="relative min-h-0 flex-1">
          {tabs.map((tab) => (
            <TerminalInstance
              key={tab.sessionId}
              server={server}
              sessionId={tab.sessionId}
              initialCwd={tab.initialCwd}
              active={tab.sessionId === activeId}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
