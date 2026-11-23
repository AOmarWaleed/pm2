import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  PlugZap,
  Server as ServerIcon,
  X,
  XCircle,
} from 'lucide-react';
import {
  AuthMethod,
  EnvironmentTag,
  Pm2ExecutionMode,
  ServerDetectResult,
  ServerInput,
  ServerPublicConfig,
} from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

interface ServerModalProps {
  open: boolean;
  editingServer?: ServerPublicConfig | null;
  onClose: () => void;
}

export const ServerModal: React.FC<ServerModalProps> = ({
  open,
  editingServer,
  onClose,
}) => {
  const { t } = useI18n();
  const { refreshServers, pushToast } = useApp();

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [environment, setEnvironment] = useState<EnvironmentTag>('production');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('privateKey');
  const [privateKeyPath, setPrivateKeyPath] = useState('~/.ssh/id_ed25519');
  const [privateKeyContent, setPrivateKeyContent] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [password, setPassword] = useState('');
  const [pm2Mode, setPm2Mode] = useState<Pm2ExecutionMode>('direct');
  const [pm2TargetUser, setPm2TargetUser] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');
  const [pm2Path, setPm2Path] = useState('');
  const [pm2Home, setPm2Home] = useState('');
  const [defaultCwd, setDefaultCwd] = useState('');
  const [notes, setNotes] = useState('');

  const [testing, setTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<ServerDetectResult | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProbeResult(null);
    setError('');
    if (editingServer) {
      setName(editingServer.name);
      setHost(editingServer.host);
      setPort(editingServer.port);
      setUsername(editingServer.username);
      setEnvironment(editingServer.environment);
      setAuthMethod(editingServer.authMethod);
      setPrivateKeyPath(editingServer.privateKeyPath || '');
      setPrivateKeyContent('');
      setPassphrase('');
      setPassword('');
      setPm2Mode(editingServer.pm2Mode);
      setPm2TargetUser(editingServer.pm2TargetUser || '');
      setSudoPassword('');
      setPm2Path(editingServer.pm2Path || '');
      setPm2Home(editingServer.pm2Home || '');
      setDefaultCwd(editingServer.defaultCwd || '');
      setNotes(editingServer.notes || '');
    } else {
      setName('');
      setHost('');
      setPort(22);
      setUsername('ubuntu');
      setEnvironment('production');
      setAuthMethod('privateKey');
      setPrivateKeyPath('~/.ssh/id_ed25519');
      setPrivateKeyContent('');
      setPassphrase('');
      setPassword('');
      setPm2Mode('direct');
      setPm2TargetUser('');
      setSudoPassword('');
      setPm2Path('');
      setPm2Home('');
      setDefaultCwd('');
      setNotes('');
    }
  }, [open, editingServer]);

  if (!open) return null;

  const buildPayload = (): ServerInput => ({
    name: name.trim() || host.trim(),
    host: host.trim(),
    port: Number(port) || 22,
    username: username.trim(),
    environment,
    authMethod,
    privateKeyPath: privateKeyPath.trim() || undefined,
    privateKeyContent: privateKeyContent.trim() || undefined,
    passphrase: passphrase || undefined,
    password: password || undefined,
    pm2Mode,
    pm2TargetUser:
      pm2Mode === 'sudo-user' ? pm2TargetUser.trim() || undefined : undefined,
    sudoPassword: sudoPassword || undefined,
    pm2Path: pm2Path.trim() || undefined,
    pm2Home: pm2Home.trim() || undefined,
    defaultCwd: defaultCwd.trim() || undefined,
    notes: notes.trim() || undefined,
  });

  const handleTest = async () => {
    setError('');
    setTesting(true);
    setProbeResult(null);
    try {
      const res = await api.testServerConnection({
        ...buildPayload(),
        existingId: editingServer?.id,
      });
      setProbeResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!host.trim() || !username.trim()) {
      setError('Host and SSH username are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingServer) {
        await api.updateServer(editingServer.id, payload);
        pushToast({ variant: 'success', title: 'Server updated' });
      } else {
        await api.createServer(payload);
        pushToast({ variant: 'success', title: 'Server added' });
      }
      await refreshServers();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
              <ServerIcon className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {editingServer
                ? t.serverModal.editTitle
                : t.serverModal.addTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.serverModal.name}
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-api-01"
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.serverModal.environment}
              </label>
              <select
                value={environment}
                onChange={(e) =>
                  setEnvironment(e.target.value as EnvironmentTag)
                }
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="production">{t.env.production}</option>
                <option value="staging">{t.env.staging}</option>
                <option value="development">{t.env.development}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.serverModal.host}
              </label>
              <input
                dir="ltr"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.50 or api.example.com"
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.serverModal.port}
              </label>
              <input
                dir="ltr"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.serverModal.username}
              </label>
              <input
                dir="ltr"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="deploy"
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>

          {/* Auth Method */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/60">
            <label className="mb-2 block font-semibold text-zinc-800 dark:text-zinc-200">
              {t.serverModal.authMethod}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthMethod('privateKey')}
                className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                  authMethod === 'privateKey'
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                    : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'
                }`}
              >
                {t.serverModal.privateKey}
              </button>
              <button
                type="button"
                onClick={() => setAuthMethod('password')}
                className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                  authMethod === 'password'
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                    : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'
                }`}
              >
                {t.serverModal.password}
              </button>
            </div>

            {authMethod === 'privateKey' ? (
              <div className="mt-3 space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                      {t.serverModal.keyPath}
                    </label>
                    <input
                      dir="ltr"
                      value={privateKeyPath}
                      onChange={(e) => setPrivateKeyPath(e.target.value)}
                      placeholder="~/.ssh/id_ed25519"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                      {t.serverModal.passphrase}
                    </label>
                    <input
                      dir="ltr"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder={
                        editingServer?.hasPassphrase
                          ? t.serverModal.secretSavedHint
                          : 'Optional'
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                    {t.serverModal.keyContent}
                  </label>
                  <textarea
                    dir="ltr"
                    rows={3}
                    value={privateKeyContent}
                    onChange={(e) => setPrivateKeyContent(e.target.value)}
                    placeholder={
                      editingServer?.hasPrivateKeyContent
                        ? t.serverModal.secretSavedHint
                        : '-----BEGIN OPENSSH PRIVATE KEY-----'
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-[11px] text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                  {t.serverModal.password}
                </label>
                <input
                  dir="ltr"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    editingServer?.hasPassword
                      ? t.serverModal.secretSavedHint
                      : '••••••••'
                  }
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
            )}
          </div>

          {/* PM2 Execution Mode */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/60">
            <label className="mb-2 block font-semibold text-zinc-800 dark:text-zinc-200">
              {t.serverModal.pm2Mode}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  ['direct', t.serverModal.modeDirect],
                  ['sudo', t.serverModal.modeSudo],
                  ['sudo-user', t.serverModal.modeSudoUser],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPm2Mode(mode)}
                  className={`rounded-lg border px-2.5 py-2 text-start font-medium transition ${
                    pm2Mode === mode
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                      : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {pm2Mode !== 'direct' && (
              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {pm2Mode === 'sudo-user' && (
                  <div>
                    <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                      {t.serverModal.targetUser}
                    </label>
                    <input
                      dir="ltr"
                      value={pm2TargetUser}
                      onChange={(e) => setPm2TargetUser(e.target.value)}
                      placeholder="nodeapp"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                    {t.serverModal.sudoPassword}
                  </label>
                  <input
                    dir="ltr"
                    type="password"
                    value={sudoPassword}
                    onChange={(e) => setSudoPassword(e.target.value)}
                    placeholder={
                      editingServer?.hasSudoPassword
                        ? t.serverModal.secretSavedHint
                        : 'Optional'
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                  {t.serverModal.pm2Path}
                </label>
                <input
                  dir="ltr"
                  value={pm2Path}
                  onChange={(e) => setPm2Path(e.target.value)}
                  placeholder="/usr/local/bin/pm2"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                  {t.serverModal.pm2Home}
                </label>
                <input
                  dir="ltr"
                  value={pm2Home}
                  onChange={(e) => setPm2Home(e.target.value)}
                  placeholder="/home/deploy/.pm2"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-zinc-600 dark:text-zinc-400">
                  {t.serverModal.defaultCwd}
                </label>
                <input
                  dir="ltr"
                  value={defaultCwd}
                  onChange={(e) => setDefaultCwd(e.target.value)}
                  placeholder="/home/deploy/app"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>
          </div>

          {probeResult && (
            <div
              dir="ltr"
              className={`rounded-xl border p-3 ${
                probeResult.reachable
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {probeResult.reachable ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-500" />
                )}
                <span>
                  {probeResult.reachable
                    ? `Connected: ${probeResult.hostname} (${probeResult.osName})`
                    : `Unreachable: ${probeResult.error}`}
                </span>
              </div>
              {probeResult.reachable && (
                <div className="mt-1.5 grid grid-cols-2 gap-1 font-mono text-[11px] sm:grid-cols-4">
                  <span>Node: {probeResult.nodeVersion || 'N/A'}</span>
                  <span>PM2: {probeResult.pm2Version || 'Not found'}</span>
                  <span>Apps: {probeResult.processCount ?? '—'}</span>
                  <span className="truncate">{probeResult.pm2Path || ''}</span>
                </div>
              )}
              {probeResult.hint && (
                <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-300">
                  {probeResult.hint}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-600 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button
              type="button"
              disabled={testing}
              onClick={handleTest}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5 text-emerald-500" />
              )}
              <span>
                {testing ? t.serverModal.testing : t.serverModal.testConnection}
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-300 px-3.5 py-2 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t.serverModal.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {t.serverModal.save}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
