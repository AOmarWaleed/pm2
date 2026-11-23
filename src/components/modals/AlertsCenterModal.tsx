import React, { useState } from 'react';
import {
  Bell,
  CheckCheck,
  Plus,
  Send,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import {
  AlertRuleType,
  AlertSeverity,
  WebhookProvider,
} from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { formatTimeAgo } from '@/utils/format';

export const AlertsCenterModal: React.FC = () => {
  const { t } = useI18n();
  const {
    showAlertsModal,
    setShowAlertsModal,
    alertRules,
    alertEvents,
    webhooks,
    refreshAlerts,
    browserNotifEnabled,
    setBrowserNotifEnabled,
    pushToast,
  } = useApp();

  const [tab, setTab] = useState<'history' | 'rules' | 'webhooks'>('history');

  // New Rule form
  const [ruleName, setRuleName] = useState('');
  const [ruleType, setRuleType] = useState<AlertRuleType>('high_cpu');
  const [ruleThreshold, setRuleThreshold] = useState(85);
  const [ruleCooldown, setRuleCooldown] = useState(180);

  // New Webhook form
  const [whName, setWhName] = useState('');
  const [whProvider, setWhProvider] = useState<WebhookProvider>('discord');
  const [whUrl, setWhUrl] = useState('');
  const [whTgToken, setWhTgToken] = useState('');
  const [whTgChat, setWhTgChat] = useState('');
  const [whMinSev, setWhMinSev] = useState<AlertSeverity>('warning');

  if (!showAlertsModal) return null;

  const toggleBrowserNotifs = async () => {
    if (!browserNotifEnabled && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        pushToast({
          variant: 'warning',
          title: 'Browser notification permission denied',
        });
        return;
      }
    }
    setBrowserNotifEnabled(!browserNotifEnabled);
  };

  const handleAckAll = async () => {
    await api.acknowledgeAlerts();
    await refreshAlerts();
  };

  const handleClear = async () => {
    await api.clearAlertEvents();
    await refreshAlerts();
  };

  const handleToggleRule = async (id: string) => {
    const rule = alertRules.find((r) => r.id === id);
    if (!rule) return;
    await api.saveAlertRule({ ...rule, enabled: !rule.enabled });
    await refreshAlerts();
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) return;
    await api.saveAlertRule({
      name: ruleName.trim(),
      type: ruleType,
      enabled: true,
      threshold: Number(ruleThreshold) || 1,
      cooldownSeconds: Number(ruleCooldown) || 120,
      environmentFilter: 'all',
    });
    setRuleName('');
    await refreshAlerts();
  };

  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim()) return;
    await api.saveWebhook({
      name: whName.trim(),
      provider: whProvider,
      enabled: true,
      url: whProvider === 'telegram' ? undefined : whUrl.trim(),
      telegramBotToken:
        whProvider === 'telegram' ? whTgToken.trim() : undefined,
      telegramChatId: whProvider === 'telegram' ? whTgChat.trim() : undefined,
      minSeverity: whMinSev,
    });
    setWhName('');
    setWhUrl('');
    setWhTgToken('');
    setWhTgChat('');
    await refreshAlerts();
    pushToast({ variant: 'success', title: 'Webhook added' });
  };

  const handleTestWebhook = async (id: string) => {
    try {
      await api.testWebhook(id);
      pushToast({ variant: 'success', title: 'Test alert delivered!' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Webhook test failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t.alerts.title}
            </h2>
          </div>
          <button
            onClick={() => setShowAlertsModal(false)}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
          <div className="flex gap-1.5">
            {(
              [
                ['history', t.alerts.historyTab],
                ['rules', t.alerts.rulesTab],
                ['webhooks', t.alerts.webhooksTab],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  tab === k
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => void toggleBrowserNotifs()}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              browserNotifEnabled
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
                : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
            }`}
          >
            {browserNotifEnabled
              ? `✓ ${t.alerts.browserNotif}`
              : t.alerts.enableNotif}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {tab === 'history' && (
            <div className="space-y-3">
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => void handleAckAll()}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] dark:border-zinc-700"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>{t.alerts.ackAll}</span>
                </button>
                <button
                  onClick={() => void handleClear()}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] text-rose-500 dark:border-zinc-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t.alerts.clearHistory}</span>
                </button>
              </div>

              {alertEvents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 py-10 text-center text-zinc-500 dark:border-zinc-800">
                  {t.alerts.noEvents}
                </div>
              ) : (
                alertEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className={`rounded-xl border p-3 ${
                      ev.severity === 'critical'
                        ? 'border-rose-500/30 bg-rose-500/5'
                        : 'border-amber-500/30 bg-amber-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {ev.serverName} • {ev.ruleName}
                      </span>
                      <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                        {formatTimeAgo(ev.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                      {ev.message}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'rules' && (
            <div className="space-y-4">
              <div className="space-y-2">
                {alertRules.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 px-3.5 py-2.5 dark:border-zinc-800"
                  >
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {r.name}
                      </div>
                      <div dir="ltr" className="font-mono text-[11px] text-zinc-500">
                        type={r.type} • threshold={r.threshold} • cooldown=
                        {r.cooldownSeconds}s
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleToggleRule(r.id)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                          r.enabled
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-zinc-500/15 text-zinc-500'
                        }`}
                      >
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={async () => {
                          await api.deleteAlertRule(r.id);
                          await refreshAlerts();
                        }}
                        className="rounded p-1 text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleAddRule}
                className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-6"
              >
                <input
                  required
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Rule name"
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 sm:col-span-2"
                />
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="process_down">process_down</option>
                  <option value="restart_spike">restart_spike</option>
                  <option value="high_cpu">high_cpu (%)</option>
                  <option value="high_memory">high_memory (MB)</option>
                </select>
                <input
                  dir="ltr"
                  type="number"
                  value={ruleThreshold}
                  onChange={(e) => setRuleThreshold(Number(e.target.value))}
                  placeholder="Threshold"
                  title="Threshold"
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
                />
                <input
                  dir="ltr"
                  type="number"
                  value={ruleCooldown}
                  onChange={(e) => setRuleCooldown(Number(e.target.value))}
                  placeholder="Cooldown (s)"
                  title="Cooldown (seconds)"
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t.alerts.addRule}</span>
                </button>
              </form>
            </div>
          )}

          {tab === 'webhooks' && (
            <div className="space-y-4">
              <div className="space-y-2">
                {webhooks.map((wh) => (
                  <div
                    key={wh.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 px-3.5 py-2.5 dark:border-zinc-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <Webhook className="h-4 w-4 text-emerald-500" />
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {wh.name} ({wh.provider})
                        </div>
                        <div dir="ltr" className="font-mono text-[11px] text-zinc-500">
                          {wh.provider === 'telegram'
                            ? `chat_id: ${wh.telegramChatId}`
                            : wh.url}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleTestWebhook(wh.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <Send className="h-3 w-3" />
                        <span>{t.alerts.testWebhook}</span>
                      </button>
                      <button
                        onClick={async () => {
                          await api.deleteWebhook(wh.id);
                          await refreshAlerts();
                        }}
                        className="rounded p-1 text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleAddWebhook}
                className="space-y-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    required
                    value={whName}
                    onChange={(e) => setWhName(e.target.value)}
                    placeholder="Channel Name"
                    className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <select
                    value={whProvider}
                    onChange={(e) =>
                      setWhProvider(e.target.value as WebhookProvider)
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="discord">Discord Webhook</option>
                    <option value="slack">Slack Webhook</option>
                    <option value="telegram">Telegram Bot</option>
                    <option value="custom">Custom JSON Webhook</option>
                  </select>
                  <select
                    value={whMinSev}
                    onChange={(e) =>
                      setWhMinSev(e.target.value as AlertSeverity)
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="info">Min: Info</option>
                    <option value="warning">Min: Warning</option>
                    <option value="critical">Min: Critical</option>
                  </select>
                </div>

                {whProvider === 'telegram' ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      dir="ltr"
                      required
                      value={whTgToken}
                      onChange={(e) => setWhTgToken(e.target.value)}
                      placeholder="Telegram Bot Token"
                      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      dir="ltr"
                      required
                      value={whTgChat}
                      onChange={(e) => setWhTgChat(e.target.value)}
                      placeholder="Telegram Chat ID"
                      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
                ) : (
                  <input
                    dir="ltr"
                    required
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
                  />
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-500"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t.alerts.addWebhook}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
