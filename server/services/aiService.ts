import {
  AiCommandSuggestion,
  AiConfig,
  AiLogDiagnosis,
  CommandRiskLevel,
  Pm2Process,
  ServerConfig,
} from '@shared/types';

function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizeRisk(val: unknown): CommandRiskLevel {
  if (val === 'safe' || val === 'caution' || val === 'destructive') {
    return val;
  }
  return 'caution';
}

export class AiService {
  private async callModel(
    config: AiConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const model = config.model?.trim();
    if (!model) {
      throw new Error('AI model name is not configured in Settings.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);

    try {
      if (config.provider === 'gemini') {
        if (!config.apiKey) {
          throw new Error('Gemini API key is required in Settings.');
        }
        const base =
          config.baseUrl?.trim() ||
          'https://generativelanguage.googleapis.com/v1beta';
        const url = `${base.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        });

        const data = (await res.json()) as {
          error?: { message?: string };
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };

        if (!res.ok) {
          throw new Error(
            data.error?.message || `Gemini HTTP ${res.status}`,
          );
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Gemini returned an empty response.');
        }
        return text;
      }

      // OpenAI or OpenAI-compatible (OpenRouter, Groq, Ollama, LM Studio)
      const defaultBase = 'https://api.openai.com/v1';
      const base = (config.baseUrl?.trim() || defaultBase).replace(/\/$/, '');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      } else if (config.provider === 'openai') {
        throw new Error('OpenAI API key is required in Settings.');
      }

      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      const data = (await res.json()) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
      };

      if (!res.ok) {
        throw new Error(data.error?.message || `AI API HTTP ${res.status}`);
      }

      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('AI provider returned an empty response.');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildServerContextSummary(
    server: ServerConfig,
    processes: Pm2Process[],
  ): string {
    const procLines = processes
      .slice(0, 20)
      .map(
        (p) =>
          `- ${p.name} (id=${p.pm_id}, status=${p.status}, mode=${p.execMode}, cpu=${p.cpu}%, mem=${Math.round(p.memory / 1048576)}MB, restarts=${p.restarts}, cwd=${p.cwd})`,
      )
      .join('\n');

    return [
      `Server Name: ${server.name}`,
      `Environment: ${server.environment}`,
      `SSH User: ${server.username}`,
      `PM2 Mode: ${server.pm2Mode}${server.pm2TargetUser ? ` (target user: ${server.pm2TargetUser})` : ''}`,
      `Default CWD: ${server.defaultCwd || '/'}`,
      `PM2 Processes (${processes.length}):`,
      procLines || '(none)',
    ].join('\n');
  }

  public async suggestCommand(
    config: AiConfig,
    userTask: string,
    server: ServerConfig,
    processes: Pm2Process[],
    language: 'en' | 'ar' = 'en',
  ): Promise<AiCommandSuggestion> {
    const langInstruction =
      language === 'ar'
        ? 'Write explanation and warnings in clear Arabic (Egyptian/simple technical Arabic), while keeping the bash command in exact Linux syntax.'
        : 'Write explanation and warnings in concise English.';

    const systemPrompt = `You are a senior Linux DevOps and PM2 assistant inside WatchPM2.
You translate the user's request into a single accurate, non-interactive Linux/PM2 bash command.
NEVER fabricate execution results. The user will review and manually approve the command before execution.
${langInstruction}
Respond ONLY with valid JSON matching this schema:
{
  "explanation": "string explaining clearly what the command does",
  "command": "single bash command (can chain with &&)",
  "risk": "safe" | "caution" | "destructive",
  "warnings": ["optional warning strings, especially for production impact or data loss"],
  "targetCwd": "optional working directory path"
}
Classification rules:
- "safe": read-only inspection (ps, df, free, pm2 status, pm2 logs --nostream, tail, grep, ss, netstat, nginx -t).
- "caution": service reload/restart, npm install, pm2 scale, pm2 save, writing temp files.
- "destructive": pm2 delete, pm2 stop, rm, kill -9, reboot, modifying system configs or dropping data.`;

    const context = this.buildServerContextSummary(server, processes);
    const raw = await this.callModel(
      config,
      systemPrompt,
      `Context:\n${context}\n\nTask:\n${userTask}`,
    );

    try {
      const obj = extractJsonObject(raw);
      return {
        explanation: String(obj.explanation || 'Suggested command'),
        command: String(obj.command || '').trim(),
        risk: normalizeRisk(obj.risk),
        warnings: Array.isArray(obj.warnings)
          ? obj.warnings.map(String).filter(Boolean)
          : [],
        targetCwd:
          typeof obj.targetCwd === 'string' && obj.targetCwd.trim()
            ? obj.targetCwd.trim()
            : undefined,
      };
    } catch {
      return {
        explanation: raw.slice(0, 400),
        command: 'pm2 status',
        risk: 'safe',
        warnings: ['Could not parse structured JSON from model; review carefully.'],
      };
    }
  }

  public async analyzeLogs(
    config: AiConfig,
    processName: string,
    logs: string,
    server: ServerConfig,
    processes: Pm2Process[],
    language: 'en' | 'ar' = 'en',
  ): Promise<AiLogDiagnosis> {
    const langInstruction =
      language === 'ar'
        ? 'Write summary, rootCause, and steps in clear Arabic while keeping technical identifiers, errors, and bash commands intact.'
        : 'Write summary, rootCause, and steps in concise technical English.';

    const systemPrompt = `You are a senior Node.js and PM2 SRE diagnosing process error logs.
${langInstruction}
Respond ONLY with valid JSON matching:
{
  "summary": "1-2 sentence overview",
  "rootCause": "likely technical root cause",
  "severity": "info" | "warning" | "critical",
  "steps": ["step 1", "step 2", "step 3"],
  "suggestedCommand": {
    "explanation": "what this remediation/diagnostic command does",
    "command": "bash command",
    "risk": "safe" | "caution" | "destructive",
    "warnings": ["optional warning"]
  }
}`;

    const context = this.buildServerContextSummary(server, processes);
    const trimmedLogs = logs.slice(-9000);
    const raw = await this.callModel(
      config,
      systemPrompt,
      `Context:\n${context}\n\nTarget Process: ${processName}\n\nRecent Logs:\n${trimmedLogs}`,
    );

    const obj = extractJsonObject(raw);
    const sev =
      obj.severity === 'critical' ||
      obj.severity === 'warning' ||
      obj.severity === 'info'
        ? obj.severity
        : 'warning';

    const sug =
      obj.suggestedCommand && typeof obj.suggestedCommand === 'object'
        ? (obj.suggestedCommand as Record<string, unknown>)
        : null;

    return {
      summary: String(obj.summary || 'Log analysis complete.'),
      rootCause: String(obj.rootCause || 'See steps for further inspection.'),
      severity: sev,
      steps: Array.isArray(obj.steps) ? obj.steps.map(String) : [],
      suggestedCommand:
        sug && typeof sug.command === 'string' && sug.command.trim()
          ? {
              explanation: String(sug.explanation || ''),
              command: sug.command.trim(),
              risk: normalizeRisk(sug.risk),
              warnings: Array.isArray(sug.warnings)
                ? sug.warnings.map(String)
                : [],
            }
          : undefined,
    };
  }

  public async testConnection(config: AiConfig): Promise<string> {
    const raw = await this.callModel(
      config,
      'Respond with JSON: {"ok": true, "message": "connected"}',
      'Ping test',
    );
    return raw.slice(0, 120);
  }
}

export const aiService = new AiService();
