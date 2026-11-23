import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { FileEntry, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { formatBytes } from '@/utils/format';

export const FileManagerView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { filesDirByServer, confirmDanger, pushToast, connectServer } =
    useApp();

  const [currentDir, setCurrentDir] = useState(
    filesDirByServer[server.id] || server.defaultCwd || '/home/deploy/app',
  );
  const [pathInput, setPathInput] = useState(currentDir);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingDir, setLoadingDir] = useState(false);

  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(
    async (dir: string) => {
      if (server.connectionStatus !== 'connected') return;
      setLoadingDir(true);
      try {
        const res = await api.listFiles(server.id, dir);
        setCurrentDir(res.path);
        setPathInput(res.path);
        setEntries(res.entries);
      } catch (err) {
        pushToast({
          variant: 'error',
          title: 'Failed to list directory',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoadingDir(false);
      }
    },
    [server.id, server.connectionStatus, pushToast],
  );

  useEffect(() => {
    const incoming = filesDirByServer[server.id];
    if (incoming) {
      void loadDirectory(incoming);
    } else {
      void loadDirectory(currentDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.connectionStatus, filesDirByServer[server.id]]);

  const openFile = async (filePath: string) => {
    setLoadingFile(true);
    try {
      const res = await api.readFile(server.id, filePath);
      setOpenFilePath(res.path);
      setFileContent(res.content);
      setSavedContent(res.content);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Cannot open file',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingFile(false);
    }
  };

  const handleSaveFile = useCallback(async () => {
    if (!openFilePath) return;
    setSavingFile(true);
    try {
      await api.writeFile(server.id, openFilePath, fileContent);
      setSavedContent(fileContent);
      pushToast({ variant: 'success', title: `Saved ${openFilePath}` });
      await loadDirectory(currentDir);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSavingFile(false);
    }
  }, [openFilePath, fileContent, server.id, currentDir, loadDirectory, pushToast]);

  const goUp = () => {
    if (currentDir === '/') return;
    const parts = currentDir.split('/').filter(Boolean);
    parts.pop();
    void loadDirectory('/' + parts.join('/'));
  };

  const handleNewFolder = async () => {
    const name = window.prompt('New folder name:');
    if (!name?.trim()) return;
    const target = `${currentDir === '/' ? '' : currentDir}/${name.trim()}`;
    try {
      await api.mkdir(server.id, target);
      await loadDirectory(currentDir);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Create folder failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleNewFile = async () => {
    const name = window.prompt('New file name:');
    if (!name?.trim()) return;
    const target = `${currentDir === '/' ? '' : currentDir}/${name.trim()}`;
    try {
      await api.writeFile(server.id, target, '');
      await loadDirectory(currentDir);
      await openFile(target);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Create file failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleRename = async (entry: FileEntry) => {
    const nextName = window.prompt('Rename to:', entry.name);
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    const parent =
      entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
    const nextPath = `${parent === '/' ? '' : parent}/${nextName.trim()}`;
    try {
      await api.renameFile(server.id, entry.path, nextPath);
      await loadDirectory(currentDir);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Rename failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    const ok = await confirmDanger({
      title: `Delete ${entry.isDirectory ? 'Folder' : 'File'}`,
      description: `Permanently delete "${entry.path}" on ${server.name}?`,
      environment: server.environment,
      requireExactMatch:
        server.environment === 'production' ? entry.name : undefined,
    });
    if (!ok) return;
    try {
      await api.removeFile(server.id, entry.path, entry.isDirectory);
      if (openFilePath === entry.path) {
        setOpenFilePath(null);
      }
      await loadDirectory(currentDir);
      pushToast({ variant: 'info', title: `Deleted ${entry.name}` });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const target = `${currentDir === '/' ? '' : currentDir}/${file.name}`;
    try {
      await api.uploadFile(server.id, target, file);
      pushToast({ variant: 'success', title: `Uploaded ${file.name}` });
      await loadDirectory(currentDir);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Upload failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (server.connectionStatus !== 'connected') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <Folder className="h-8 w-8 text-zinc-400" />
        <p className="mt-3 text-xs text-zinc-500">
          {t.overview.disconnectedHint}
        </p>
        <button
          onClick={() => void connectServer(server.id)}
          className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          {t.fleet.connect}
        </button>
      </div>
    );
  }

  const isDirty = openFilePath !== null && fileContent !== savedContent;

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {t.files.title}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => void handleNewFolder()}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>{t.files.newFolder}</span>
          </button>
          <button
            onClick={() => void handleNewFile()}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span>{t.files.newFile}</span>
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            onChange={(e) => void handleUpload(e)}
            className="hidden"
          />
          <button
            onClick={() => uploadInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{t.files.upload}</span>
          </button>
        </div>
      </div>

      {/* Path Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadDirectory(pathInput.trim() || '/');
        }}
        className="mt-3 flex items-center gap-2"
      >
        <button
          type="button"
          onClick={goUp}
          title={t.files.up}
          className="rounded-xl border border-zinc-200 bg-white p-2 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <input
          dir="ltr"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 font-mono text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={() => void loadDirectory(currentDir)}
          title={t.files.refresh}
          className="rounded-xl border border-zinc-200 bg-white p-2 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loadingDir ? 'animate-spin' : ''}`}
          />
        </button>
      </form>

      {/* Quick Shortcuts */}
      <div dir="ltr" className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {[
          server.defaultCwd || '/home/deploy/app',
          '/etc/nginx/sites-enabled',
          '/var/log/pm2',
          '/',
        ].map((shortcut) => (
          <button
            key={shortcut}
            onClick={() => void loadDirectory(shortcut)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-zinc-600 hover:border-emerald-500/40 hover:text-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
          >
            {shortcut}
          </button>
        ))}
      </div>

      {/* Split Browser + Editor */}
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="overflow-y-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/80 lg:col-span-5">
          {entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              Empty directory
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {entries.map((entry) => (
                <div
                  key={entry.path}
                  className={`group flex items-center justify-between gap-2 px-3 py-2 text-xs transition hover:bg-zinc-50 dark:hover:bg-zinc-950/60 ${
                    openFilePath === entry.path ? 'bg-emerald-500/10' : ''
                  }`}
                >
                  <button
                    onClick={() =>
                      entry.isDirectory
                        ? void loadDirectory(entry.path)
                        : void openFile(entry.path)
                    }
                    dir="ltr"
                    className="flex min-w-0 flex-1 items-center gap-2 text-start"
                  >
                    {entry.isDirectory ? (
                      <Folder className="h-4 w-4 shrink-0 text-amber-400" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-sky-400" />
                    )}
                    <span className="truncate font-mono text-zinc-900 dark:text-zinc-100">
                      {entry.name}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {!entry.isDirectory && (
                      <span
                        dir="ltr"
                        className="me-1 font-mono text-[10px] text-zinc-400"
                      >
                        {formatBytes(entry.size)}
                      </span>
                    )}
                    {!entry.isDirectory && (
                      <a
                        href={api.getDownloadUrl(server.id, entry.path)}
                        title={t.files.download}
                        className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      onClick={() => void handleRename(entry)}
                      title={t.files.rename}
                      className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => void handleDelete(entry)}
                      title={t.files.delete}
                      className="rounded p-1 text-zinc-400 opacity-0 hover:bg-rose-500/15 hover:text-rose-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inline Editor */}
        <div className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 lg:col-span-7">
          {openFilePath ? (
            <>
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    dir="ltr"
                    className="truncate font-mono text-xs font-medium text-zinc-200"
                  >
                    {openFilePath}
                  </span>
                  {isDirty && (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      {t.files.unsaved}
                    </span>
                  )}
                </div>
                <button
                  disabled={!isDirty || savingFile}
                  onClick={() => void handleSaveFile()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  {savingFile ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>{t.files.save}</span>
                </button>
              </div>
              {loadingFile ? (
                <div className="flex flex-1 items-center justify-center text-zinc-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <textarea
                  dir="ltr"
                  spellCheck={false}
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault();
                      void handleSaveFile();
                    }
                  }}
                  className="flex-1 resize-none bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100 outline-none"
                />
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-zinc-500">
              {t.files.selectFile}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
