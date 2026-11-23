import crypto from 'node:crypto';
import { ClientChannel } from 'ssh2';
import {
  describeCron,
  getNextCronRuns,
  validateCronExpression,
} from '@shared/cronUtils';
import {
  CronActiveRun,
  CronJobInput,
  CronJobItem,
  CronRunRecord,
  ServerConfig,
} from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import { buildShellCommand, shellEscape } from '../ssh/shellHelpers';
import { sshPool } from '../ssh/sshPool';
import { metricsService } from './metricsService';
import { sftpService } from './sftpService';

const WATCHPM2_META_PREFIX = '# watchpm2:';
const PAUSED_PREFIX = '# [watchpm2-paused] ';

const CRON_WRAPPER_SCRIPT = `#!/usr/bin/env bash
set -u
JOB_ID="\${1:-unknown}"
B64_CMD="\${2:-}"
JOB_NAME="\${3:-$JOB_ID}"
TRIGGER="\${4:-schedule}"

WATCH_DIR="$HOME/.watchpm2"
RUN_DIR="$WATCH_DIR/cron-runs"
LOG_DIR="$WATCH_DIR/cron-logs/$JOB_ID"
mkdir -p "$RUN_DIR" "$LOG_DIR"

now_ms() {
  local t
  t=$(date +%s%3N 2>/dev/null || true)
  case "$t" in
    *[!0-9]*|'') echo "$(($(date +%s) * 1000))" ;;
    *) echo "$t" ;;
  esac
}

json_esc() {
  printf '%s' "$1" | tr '\\n\\r\\t' '   ' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'
}

START_MS=$(now_ms)
RUN_ID="run-\${START_MS}-$$"
LOG_FILE="$LOG_DIR/\${RUN_ID}.log"
ACTIVE_FILE="$RUN_DIR/\${JOB_ID}.active"
JSONL_FILE="$RUN_DIR/\${JOB_ID}.jsonl"

printf '{"runId":"%s","pid":%s,"startedAt":%s,"logFile":"%s"}\\n' \\
  "$(json_esc "$RUN_ID")" "$$" "$START_MS" "$(json_esc "$LOG_FILE")" > "$ACTIVE_FILE"

EXIT_CODE=0
FINALIZED=0
finalize() {
  if [ "$FINALIZED" -eq 1 ]; then return; fi
  FINALIZED=1
  local rc="$1"
  local end_ms
  end_ms=$(now_ms)
  local dur=$((end_ms - START_MS))
  if [ "$dur" -lt 0 ]; then dur=0; fi
  local st="success"
  if [ "$rc" -ne 0 ]; then st="failed"; fi
  rm -f "$ACTIVE_FILE"
  printf '{"runId":"%s","jobId":"%s","jobName":"%s","status":"%s","exitCode":%s,"startedAt":%s,"finishedAt":%s,"durationMs":%s,"logFile":"%s","trigger":"%s"}\\n' \\
    "$(json_esc "$RUN_ID")" "$(json_esc "$JOB_ID")" "$(json_esc "$JOB_NAME")" "$st" "$rc" "$START_MS" "$end_ms" "$dur" "$(json_esc "$LOG_FILE")" "$(json_esc "$TRIGGER")" >> "$JSONL_FILE"
  if [ "$(wc -l < "$JSONL_FILE" 2>/dev/null || echo 0)" -gt 100 ]; then
    tail -n 60 "$JSONL_FILE" > "$JSONL_FILE.tmp" && mv "$JSONL_FILE.tmp" "$JSONL_FILE"
  fi
  ls -1t "$LOG_DIR"/*.log 2>/dev/null | tail -n +31 | xargs -r rm -f 2>/dev/null || true
}

trap 'finalize 130; exit 130' INT TERM

CMD=$(printf '%s' "$B64_CMD" | base64 -d 2>/dev/null || printf '%s' "$B64_CMD" | base64 --decode 2>/dev/null)
set +e
bash -lc "$CMD" > "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

finalize "$EXIT_CODE"
exit "$EXIT_CODE"
`;

interface ParsedCrontabLine {
  lineIndex: number;
  rawLine: string;
  metaLineIndex?: number;
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  tracked: boolean;
}

function stableJobId(seed: string): string {
  return (
    'cron-' +
    crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10)
  );
}

function deriveJobName(command: string): string {
  const clean = command.trim().split(/\s+/)[0] || 'cron-job';
  const base = clean.split('/').pop() || clean;
  return base.slice(0, 32) || 'cron-job';
}

function parseTrackedWrapperCommand(
  cmdPart: string,
): { jobId: string; rawCommand: string; jobName?: string } | null {
  const match = cmdPart.match(
    /cron-run\.sh\s+['"]?([A-Za-z0-9_-]+)['"]?\s+['"]([A-Za-z0-9+/=]+)['"](?:\s+['"]([^'"]*)['"])?/,
  );
  if (!match) return null;
  try {
    const rawCommand = Buffer.from(match[2], 'base64').toString('utf8');
    return {
      jobId: match[1],
      rawCommand,
      jobName: match[3] || undefined,
    };
  } catch {
    return null;
  }
}

function splitScheduleAndCommand(
  body: string,
): { schedule: string; command: string } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('@')) {
    const m = trimmed.match(/^(@\S+)\s+(.+)$/);
    if (!m) return null;
    if (validateCronExpression(m[1]) !== null) return null;
    return { schedule: m[1], command: m[2].trim() };
  }

  const m = trimmed.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
  if (!m) return null;
  if (validateCronExpression(m[1]) !== null) return null;
  return { schedule: m[1], command: m[2].trim() };
}

function parseUserCrontab(raw: string): {
  lines: string[];
  jobs: ParsedCrontabLine[];
} {
  const lines = raw.split(/\r?\n/);
  const jobs: ParsedCrontabLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    let enabled = true;
    let body = trimmed;

    if (trimmed.startsWith(PAUSED_PREFIX.trim())) {
      enabled = false;
      body = trimmed.slice(PAUSED_PREFIX.trim().length).trim();
    } else if (trimmed.startsWith('#')) {
      continue;
    }

    const parsed = splitScheduleAndCommand(body);
    if (!parsed) continue;

    // Check previous line for watchpm2 metadata comment
    let metaLineIndex: number | undefined;
    let metaId: string | undefined;
    let metaName: string | undefined;

    if (i > 0 && lines[i - 1].trim().startsWith(WATCHPM2_META_PREFIX)) {
      metaLineIndex = i - 1;
      const metaRaw = lines[i - 1].trim().slice(WATCHPM2_META_PREFIX.length);
      const idMatch = metaRaw.match(/\bid=([^\s]+)/);
      const nameMatch = metaRaw.match(/\bname=(.+)$/);
      if (idMatch) metaId = idMatch[1].trim();
      if (nameMatch) metaName = nameMatch[1].trim();
    }

    const wrapped = parseTrackedWrapperCommand(parsed.command);
    const actualCommand = wrapped ? wrapped.rawCommand : parsed.command;
    const id =
      wrapped?.jobId || metaId || stableJobId(`${parsed.schedule}:${actualCommand}:${i}`);
    const name =
      metaName || wrapped?.jobName || deriveJobName(actualCommand);

    jobs.push({
      lineIndex: i,
      rawLine: line,
      metaLineIndex,
      id,
      name,
      schedule: parsed.schedule,
      command: actualCommand,
      enabled,
      tracked: Boolean(wrapped),
    });
  }

  return { lines, jobs };
}

function buildWrappedLine(
  jobId: string,
  name: string,
  schedule: string,
  command: string,
  enabled: boolean,
  tracked: boolean,
): [string, string] {
  const safeName = name.replace(/[\r\n'"]/g, ' ').trim() || jobId;
  const metaLine = `${WATCHPM2_META_PREFIX}id=${jobId} name=${safeName}`;
  const execPart = tracked
    ? `"$HOME/.watchpm2/cron-run.sh" ${shellEscape(jobId)} ${shellEscape(Buffer.from(command, 'utf8').toString('base64'))} ${shellEscape(safeName)}`
    : command;
  const cronLine = `${enabled ? '' : PAUSED_PREFIX}${schedule} ${execPart}`;
  return [metaLine, cronLine];
}

interface ActiveCronRunHandle {
  cancel: () => void;
}

class CronService {
  private activeManualRuns = new Map<string, ActiveCronRunHandle>();

  private async ensureWrapperInstalled(server: ServerConfig): Promise<void> {
    const b64 = Buffer.from(CRON_WRAPPER_SCRIPT, 'utf8').toString('base64');
    const cmd = [
      'mkdir -p "$HOME/.watchpm2/cron-runs" "$HOME/.watchpm2/cron-logs"',
      `printf '%s' ${shellEscape(b64)} | (base64 -d 2>/dev/null || base64 --decode) > "$HOME/.watchpm2/cron-run.sh"`,
      'chmod 700 "$HOME/.watchpm2/cron-run.sh"',
    ].join(' && ');

    const built = buildShellCommand(server, cmd, {
      useSudoIfConfigured: server.pm2Mode !== 'direct',
    });
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(
        res.stderr.trim() || 'Failed to install cron tracking wrapper on server.',
      );
    }
  }

  private async readUserCrontab(server: ServerConfig): Promise<string> {
    const built = buildShellCommand(server, 'crontab -l 2>/dev/null || true', {
      useSudoIfConfigured: server.pm2Mode !== 'direct',
    });
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    return res.stdout || '';
  }

  private async writeUserCrontab(
    server: ServerConfig,
    content: string,
  ): Promise<void> {
    const cleanContent = content.endsWith('\n') ? content : `${content}\n`;
    const b64 = Buffer.from(cleanContent, 'utf8').toString('base64');
    const cmd = `printf '%s' ${shellEscape(b64)} | (base64 -d 2>/dev/null || base64 --decode) | crontab -`;
    const built = buildShellCommand(server, cmd, {
      useSudoIfConfigured: server.pm2Mode !== 'direct',
    });
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || 'Failed to update crontab.');
    }
  }

  public async listCronJobs(server: ServerConfig): Promise<CronJobItem[]> {
    if (server.isDemo) {
      return demoBackend.listCronJobs();
    }

    const probeInner = [
      'echo "===USER_CRONTAB==="; crontab -l 2>/dev/null || true',
      'echo "===ACTIVE==="; for f in "$HOME"/.watchpm2/cron-runs/*.active; do [ -f "$f" ] || continue; cat "$f"; done',
      'echo "===JSONL==="; for f in "$HOME"/.watchpm2/cron-runs/*.jsonl; do [ -f "$f" ] || continue; tail -n 15 "$f"; done',
      'echo "===SYS_CRON==="; if [ -r /etc/crontab ]; then sed "s/^/FILE:\\/etc\\/crontab|/" /etc/crontab; fi; for f in /etc/cron.d/*; do [ -r "$f" ] && [ -f "$f" ] && sed "s|^|FILE:$f\\||" "$f"; done',
      'echo "===TIMERS==="; systemctl list-timers --all --no-pager --plain --no-legend 2>/dev/null || true',
      'echo "===SYSLOG==="; (journalctl -u cron -u crond -n 80 --no-pager -o short-iso 2>/dev/null || tail -n 80 /var/log/syslog 2>/dev/null || tail -n 80 /var/log/cron 2>/dev/null) | grep -iE "CRON|CROND" | tail -n 60 || true',
    ].join('; ');

    const built = buildShellCommand(server, probeInner, {
      useSudoIfConfigured: server.pm2Mode !== 'direct',
    });

    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
      timeoutMs: 15000,
    });

    const sections = new Map<string, string[]>();
    let current = '';
    for (const line of res.stdout.split(/\r?\n/)) {
      const m = line.match(/^===([A-Z_]+)===$/);
      if (m) {
        current = m[1];
        sections.set(current, []);
      } else if (current) {
        sections.get(current)!.push(line);
      }
    }

    // Parse active runs
    const activeByJob = new Map<string, CronActiveRun>();
    for (const line of sections.get('ACTIVE') || []) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as CronActiveRun & { logFile?: string };
        // Extract jobId from logFile path if available or match below
        if (obj.logFile) {
          const m = obj.logFile.match(/cron-logs\/([^/]+)\//);
          if (m) activeByJob.set(m[1], obj);
        }
      } catch {
        // ignore malformed active file
      }
    }

    // Parse tracked JSONL history
    const runsByJob = new Map<string, CronRunRecord[]>();
    for (const line of sections.get('JSONL') || []) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t) as CronRunRecord;
        const arr = runsByJob.get(rec.jobId) || [];
        arr.unshift(rec);
        runsByJob.set(rec.jobId, arr.slice(0, 15));
      } catch {
        // ignore malformed jsonl line
      }
    }

    // Parse syslog fallback starts
    const syslogLines = (sections.get('SYSLOG') || []).filter((l) =>
      l.includes('CMD ('),
    );

    const items: CronJobItem[] = [];

    // 1. User Crontab
    const userRaw = (sections.get('USER_CRONTAB') || []).join('\n');
    const parsedUser = parseUserCrontab(userRaw);
    for (const job of parsedUser.jobs) {
      const activeRun = activeByJob.get(job.id);
      let recentRuns = runsByJob.get(job.id) || [];

      if (!job.tracked && recentRuns.length === 0) {
        // Best-effort match in syslog
        const firstToken = job.command.trim().split(/\s+/)[0] || '';
        const matched = syslogLines
          .filter((sl) => firstToken && sl.includes(firstToken))
          .slice(-5)
          .reverse()
          .map((sl, idx): CronRunRecord => {
            const tsMatch = sl.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*)/);
            const ts = tsMatch ? Date.parse(tsMatch[1]) || Date.now() : Date.now();
            return {
              runId: `syslog-${job.id}-${idx}`,
              jobId: job.id,
              jobName: job.name,
              status: 'unknown',
              exitCode: null,
              startedAt: ts,
              finishedAt: null,
              durationMs: null,
              trigger: 'syslog',
              outputPreview: sl,
            };
          });
        recentRuns = matched;
      }

      items.push({
        id: job.id,
        name: job.name,
        source: 'user-crontab',
        sourceFile: `${server.pm2TargetUser || server.username} crontab`,
        schedule: job.schedule,
        scheduleHuman: describeCron(job.schedule),
        nextRuns: job.enabled ? getNextCronRuns(job.schedule, 3) : [],
        command: job.command,
        rawLine: job.rawLine,
        user: server.pm2TargetUser || server.username,
        enabled: job.enabled,
        tracked: job.tracked,
        editable: true,
        activeRun,
        lastRun: recentRuns[0],
        recentRuns,
      });
    }

    // 2. System Cron (/etc/crontab, /etc/cron.d/*)
    for (const line of sections.get('SYS_CRON') || []) {
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const file = line.slice(5, sep);
      const rawContent = line.slice(sep + 1).trim();
      if (!rawContent || rawContent.startsWith('#') || /^[A-Za-z_]+=/.test(rawContent)) {
        continue;
      }
      // System crons have user field: <schedule> <user> <command>
      let schedule = '';
      let rest = '';
      if (rawContent.startsWith('@')) {
        const m = rawContent.match(/^(@\S+)\s+(\S+)\s+(.+)$/);
        if (m && validateCronExpression(m[1]) === null) {
          schedule = m[1];
          rest = `${m[2]}:::${m[3]}`;
        }
      } else {
        const m = rawContent.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\S+)\s+(.+)$/);
        if (m && validateCronExpression(m[1]) === null) {
          schedule = m[1];
          rest = `${m[2]}:::${m[3]}`;
        }
      }
      if (!schedule || !rest) continue;
      const [sysUser, sysCmd] = rest.split(':::');
      const id = stableJobId(`sys:${file}:${schedule}:${sysCmd}`);
      items.push({
        id,
        name: deriveJobName(sysCmd),
        source: 'system-cron',
        sourceFile: file,
        schedule,
        scheduleHuman: describeCron(schedule),
        nextRuns: getNextCronRuns(schedule, 3),
        command: sysCmd,
        rawLine: rawContent,
        user: sysUser,
        enabled: true,
        tracked: false,
        editable: false,
        recentRuns: [],
      });
    }

    // 3. Systemd Timers
    for (const line of sections.get('TIMERS') || []) {
      const t = line.trim();
      if (!t) continue;
      const timerMatch = t.match(/([a-zA-Z0-9_.@-]+\.timer)\s+([a-zA-Z0-9_.@-]+\.service)?$/);
      if (!timerMatch) continue;
      const unitName = timerMatch[1];
      const nextPart = t.split(/\s{2,}/)[0] || '';
      const parsedNext = Date.parse(nextPart);
      items.push({
        id: stableJobId(`timer:${unitName}`),
        name: unitName,
        source: 'systemd-timer',
        sourceFile: 'systemd',
        schedule: nextPart || 'systemd timer',
        scheduleHuman: 'Managed by systemd timer',
        nextRuns: Number.isNaN(parsedNext) ? [] : [parsedNext],
        command: `systemctl start ${timerMatch[2] || unitName}`,
        rawLine: t,
        enabled: !t.includes('n/a'),
        tracked: false,
        editable: false,
        recentRuns: [],
      });
    }

    // 4. PM2 cron_restart processes
    const pm2Procs = metricsService.getLatestProcesses(server.id);
    for (const p of pm2Procs) {
      if (!p.cronRestart) continue;
      items.push({
        id: `pm2-cron-${p.name}`,
        name: `PM2: ${p.name}`,
        source: 'pm2-cron',
        sourceFile: 'PM2 runtime',
        schedule: p.cronRestart,
        scheduleHuman: describeCron(p.cronRestart),
        nextRuns: getNextCronRuns(p.cronRestart, 3),
        command: `pm2 restart ${p.name}`,
        rawLine: `cron_restart: "${p.cronRestart}"`,
        enabled: p.status === 'online',
        tracked: false,
        editable: false,
        recentRuns: [],
      });
    }

    return items;
  }

  public async createCronJob(
    server: ServerConfig,
    input: CronJobInput,
  ): Promise<void> {
    const err = validateCronExpression(input.schedule);
    if (err) throw new Error(err);
    if (!input.name.trim() || !input.command.trim()) {
      throw new Error('Job name and command are required.');
    }

    if (server.isDemo) {
      demoBackend.createCronJob(input);
      return;
    }

    const tracked = input.tracked !== false;
    const enabled = input.enabled !== false;
    if (tracked) {
      await this.ensureWrapperInstalled(server);
    }

    const jobId = `cron-${crypto.randomUUID().slice(0, 8)}`;
    const existingRaw = await this.readUserCrontab(server);
    const existingLines = existingRaw ? existingRaw.split(/\r?\n/) : [];
    while (
      existingLines.length > 0 &&
      existingLines[existingLines.length - 1] === ''
    ) {
      existingLines.pop();
    }

    const [metaLine, cronLine] = buildWrappedLine(
      jobId,
      input.name.trim(),
      input.schedule.trim(),
      input.command.trim(),
      enabled,
      tracked,
    );
    existingLines.push(metaLine, cronLine);
    await this.writeUserCrontab(server, existingLines.join('\n'));
  }

  public async updateCronJob(
    server: ServerConfig,
    jobId: string,
    input: CronJobInput,
  ): Promise<void> {
    const err = validateCronExpression(input.schedule);
    if (err) throw new Error(err);

    if (server.isDemo) {
      demoBackend.updateCronJob(jobId, input);
      return;
    }

    const raw = await this.readUserCrontab(server);
    const { lines, jobs } = parseUserCrontab(raw);
    const target = jobs.find((j) => j.id === jobId);
    if (!target) throw new Error('Cron job not found in user crontab.');

    const tracked = input.tracked ?? target.tracked;
    const enabled = input.enabled ?? target.enabled;
    if (tracked) {
      await this.ensureWrapperInstalled(server);
    }

    const [metaLine, cronLine] = buildWrappedLine(
      jobId,
      input.name.trim(),
      input.schedule.trim(),
      input.command.trim(),
      enabled,
      tracked,
    );

    lines[target.lineIndex] = cronLine;
    if (target.metaLineIndex !== undefined) {
      lines[target.metaLineIndex] = metaLine;
    } else {
      lines.splice(target.lineIndex, 0, metaLine);
    }
    await this.writeUserCrontab(server, lines.join('\n'));
  }

  public async toggleCronEnabled(
    server: ServerConfig,
    jobId: string,
    enabled: boolean,
  ): Promise<void> {
    if (server.isDemo) {
      demoBackend.toggleCronEnabled(jobId, enabled);
      return;
    }

    const raw = await this.readUserCrontab(server);
    const { lines, jobs } = parseUserCrontab(raw);
    const target = jobs.find((j) => j.id === jobId);
    if (!target) throw new Error('Cron job not found in user crontab.');

    const [metaLine, cronLine] = buildWrappedLine(
      target.id,
      target.name,
      target.schedule,
      target.command,
      enabled,
      target.tracked,
    );
    lines[target.lineIndex] = cronLine;
    if (target.metaLineIndex !== undefined) {
      lines[target.metaLineIndex] = metaLine;
    } else {
      lines.splice(target.lineIndex, 0, metaLine);
    }
    await this.writeUserCrontab(server, lines.join('\n'));
  }

  public async toggleCronTracking(
    server: ServerConfig,
    jobId: string,
    tracked: boolean,
  ): Promise<void> {
    if (server.isDemo) {
      demoBackend.toggleCronTracking(jobId, tracked);
      return;
    }

    if (tracked) {
      await this.ensureWrapperInstalled(server);
    }

    const raw = await this.readUserCrontab(server);
    const { lines, jobs } = parseUserCrontab(raw);
    const target = jobs.find((j) => j.id === jobId);
    if (!target) throw new Error('Cron job not found in user crontab.');

    const [metaLine, cronLine] = buildWrappedLine(
      target.id,
      target.name,
      target.schedule,
      target.command,
      target.enabled,
      tracked,
    );
    lines[target.lineIndex] = cronLine;
    if (target.metaLineIndex !== undefined) {
      lines[target.metaLineIndex] = metaLine;
    } else {
      lines.splice(target.lineIndex, 0, metaLine);
    }
    await this.writeUserCrontab(server, lines.join('\n'));
  }

  public async deleteCronJob(
    server: ServerConfig,
    jobId: string,
  ): Promise<void> {
    if (server.isDemo) {
      demoBackend.deleteCronJob(jobId);
      return;
    }

    const raw = await this.readUserCrontab(server);
    const { lines, jobs } = parseUserCrontab(raw);
    const target = jobs.find((j) => j.id === jobId);
    if (!target) throw new Error('Cron job not found in user crontab.');

    if (target.metaLineIndex !== undefined) {
      lines.splice(target.lineIndex, 1);
      lines.splice(target.metaLineIndex, 1);
    } else {
      lines.splice(target.lineIndex, 1);
    }
    await this.writeUserCrontab(server, lines.join('\n'));
  }

  public async readRunLog(
    server: ServerConfig,
    logFile: string,
  ): Promise<{ content: string; path: string }> {
    if (server.isDemo) {
      return demoBackend.readCronRunLog(logFile);
    }

    try {
      const res = await sftpService.readFile(server, logFile);
      return { content: res.content, path: res.path };
    } catch {
      const built = buildShellCommand(
        server,
        `tail -c 524288 ${shellEscape(logFile)} 2>/dev/null || echo "Log file not found."`,
        { useSudoIfConfigured: server.pm2Mode !== 'direct' },
      );
      const execRes = await sshPool.exec(server, built.command, {
        stdinInput: built.stdinInput,
      });
      return { content: execRes.stdout, path: logFile };
    }
  }

  public async runJobNow(params: {
    runId: string;
    server: ServerConfig;
    jobId: string;
    onOutput: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => void;
    onDone: (record: CronRunRecord) => void;
  }): Promise<void> {
    if (params.server.isDemo) {
      demoBackend.runCronNow(params);
      return;
    }

    const jobs = await this.listCronJobs(params.server);
    const job = jobs.find((j) => j.id === params.jobId);
    if (!job) {
      const failRec: CronRunRecord = {
        runId: params.runId,
        jobId: params.jobId,
        jobName: params.jobId,
        status: 'failed',
        exitCode: 1,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0,
        trigger: 'manual',
        outputPreview: 'Cron job not found.',
      };
      params.onOutput('stderr', 'Cron job not found.\n');
      params.onDone(failRec);
      return;
    }

    const startedAt = Date.now();
    let outputBuf = '';
    let cancelled = false;
    let channel: ClientChannel | null = null;

    params.onOutput(
      'system',
      `[${new Date(startedAt).toISOString()}] Running "${job.name}" manually...\n$ ${job.command}\n`,
    );

    const built = buildShellCommand(params.server, job.command, {
      useSudoIfConfigured: params.server.pm2Mode !== 'direct',
    });

    try {
      channel = await sshPool.spawnStream(params.server, built.command, {
        stdinInput: built.stdinInput,
        onStdout: (chunk) => {
          outputBuf += chunk;
          params.onOutput('stdout', chunk);
        },
        onStderr: (chunk) => {
          outputBuf += chunk;
          params.onOutput('stderr', chunk);
        },
        onClose: (code) => {
          this.activeManualRuns.delete(params.runId);
          const finishedAt = Date.now();
          const exitCode = cancelled ? 130 : (code ?? 0);
          const record: CronRunRecord = {
            runId: params.runId,
            jobId: job.id,
            jobName: job.name,
            status: exitCode === 0 ? 'success' : 'failed',
            exitCode,
            startedAt,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
            trigger: 'manual',
            outputPreview: outputBuf.slice(-4000),
          };
          if (job.editable && job.tracked) {
            void this.persistManualRunToServer(
              params.server,
              record,
              outputBuf,
            ).then((logFile) => {
              if (logFile) record.logFile = logFile;
              params.onDone(record);
            });
          } else {
            params.onDone(record);
          }
        },
        onError: (err) => {
          outputBuf += `\n${err.message}\n`;
          params.onOutput('stderr', `\n${err.message}\n`);
        },
      });

      this.activeManualRuns.set(params.runId, {
        cancel: () => {
          cancelled = true;
          if (channel) {
            try {
              channel.signal('INT');
              channel.close();
            } catch {
              // ignore
            }
          }
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const finishedAt = Date.now();
      params.onOutput('stderr', `${msg}\n`);
      params.onDone({
        runId: params.runId,
        jobId: job.id,
        jobName: job.name,
        status: 'failed',
        exitCode: 1,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        trigger: 'manual',
        outputPreview: msg,
      });
    }
  }

  private async persistManualRunToServer(
    server: ServerConfig,
    record: CronRunRecord,
    fullOutput: string,
  ): Promise<string | undefined> {
    try {
      const logDir = `$HOME/.watchpm2/cron-logs/${record.jobId}`;
      const logFile = `${logDir}/${record.runId}.log`;
      const jsonlFile = `$HOME/.watchpm2/cron-runs/${record.jobId}.jsonl`;
      const outB64 = Buffer.from(fullOutput, 'utf8').toString('base64');
      const recLine = JSON.stringify({ ...record, logFile });
      const recB64 = Buffer.from(`${recLine}\n`, 'utf8').toString('base64');

      const cmd = [
        `mkdir -p "${logDir}" "$HOME/.watchpm2/cron-runs"`,
        `printf '%s' ${shellEscape(outB64)} | (base64 -d 2>/dev/null || base64 --decode) > "${logFile}"`,
        `printf '%s' ${shellEscape(recB64)} | (base64 -d 2>/dev/null || base64 --decode) >> "${jsonlFile}"`,
      ].join(' && ');

      const built = buildShellCommand(server, cmd, {
        useSudoIfConfigured: server.pm2Mode !== 'direct',
      });
      await sshPool.exec(server, built.command, {
        stdinInput: built.stdinInput,
      });
      return logFile;
    } catch {
      return undefined;
    }
  }

  public cancelRun(runId: string): void {
    this.activeManualRuns.get(runId)?.cancel();
  }
}

export const cronService = new CronService();
