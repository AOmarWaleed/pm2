const SHORTCUTS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface ParsedField {
  any: boolean;
  values: Set<number>;
}

function parseTokenValue(
  raw: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  wrap7To0 = false,
): number | null {
  const lower = raw.trim().toLowerCase();
  let num: number;
  if (names && lower in names) {
    num = names[lower];
  } else if (/^\d+$/.test(lower)) {
    num = Number.parseInt(lower, 10);
  } else {
    return null;
  }
  if (wrap7To0 && num === 7) num = 0;
  if (num < min || num > max) return null;
  return num;
}

function parseField(
  expr: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  wrap7To0 = false,
): ParsedField | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  if (trimmed === '*') {
    const all = new Set<number>();
    for (let i = min; i <= max; i++) all.add(i);
    return { any: true, values: all };
  }

  const values = new Set<number>();
  const parts = trimmed.split(',');

  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/');
    if (part.split('/').length > 2) return null;

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number.parseInt(stepPart, 10);
      if (step < 1) return null;
    }

    if (rangePart === '*') {
      for (let v = min; v <= max; v += step) {
        values.add(wrap7To0 && v === 7 ? 0 : v);
      }
      continue;
    }

    if (rangePart.includes('-')) {
      const [aStr, bStr] = rangePart.split('-');
      if (rangePart.split('-').length !== 2) return null;
      const start = parseTokenValue(aStr, min, max, names, false);
      const end = parseTokenValue(bStr, min, max, names, false);
      if (start === null || end === null || start > end) return null;
      for (let v = start; v <= end; v += step) {
        values.add(wrap7To0 && v === 7 ? 0 : v);
      }
      continue;
    }

    const single = parseTokenValue(rangePart, min, max, names, wrap7To0);
    if (single === null) return null;
    if (stepPart !== undefined) {
      for (let v = single; v <= max; v += step) {
        values.add(wrap7To0 && v === 7 ? 0 : v);
      }
    } else {
      values.add(single);
    }
  }

  return values.size > 0 ? { any: false, values } : null;
}

interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dom: ParsedField;
  month: ParsedField;
  dow: ParsedField;
}

function parseCron(rawExpr: string): ParsedCron | null {
  const trimmed = rawExpr.trim();
  const normalized = SHORTCUTS[trimmed.toLowerCase()] || trimmed;
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) return null;

  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12, MONTH_NAMES);
  const dow = parseField(fields[4], 0, 7, DOW_NAMES, true);

  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow };
}

export function validateCronExpression(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return 'Schedule expression is required.';
  if (trimmed.toLowerCase() === '@reboot') return null;
  if (!parseCron(trimmed)) {
    return 'Invalid cron expression. Use 5 fields (min hour dom month dow) or @hourly/@daily/@weekly/@monthly/@reboot.';
  }
  return null;
}

export function describeCron(expr: string): string {
  const trimmed = expr.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '@reboot') return 'At system startup';
  if (lower === '@hourly') return 'Every hour (minute 0)';
  if (lower === '@daily' || lower === '@midnight') return 'Daily at 00:00';
  if (lower === '@weekly') return 'Weekly on Sun at 00:00';
  if (lower === '@monthly') return 'Monthly on day 1 at 00:00';
  if (lower === '@yearly' || lower === '@annually') return 'Yearly on Jan 1 at 00:00';

  const normalized = SHORTCUTS[lower] || trimmed;
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return trimmed;

  const [m, h, dom, mon, dow] = parts;

  if (m === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every minute';
  }
  if (/^\*\/(\d+)$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    const step = m.slice(2);
    return `Every ${step} minutes`;
  }
  if (/^\d+$/.test(m) && /^\*\/(\d+)$/.test(h) && dom === '*' && mon === '*' && dow === '*') {
    const step = h.slice(2);
    return `Every ${step} hours at :${m.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*' && /^\d$/.test(dow)) {
    const dayIdx = Number.parseInt(dow, 10) % 7;
    return `Every ${DOW_LABELS[dayIdx]} at ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    return `Monthly on day ${dom} at ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }

  return trimmed;
}

export function getNextCronRuns(
  expr: string,
  count = 3,
  fromDate = new Date(),
): number[] {
  const trimmed = expr.trim();
  if (trimmed.toLowerCase() === '@reboot') return [];
  const parsed = parseCron(trimmed);
  if (!parsed) return [];

  const results: number[] = [];
  const cursor = new Date(fromDate.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limitMs = fromDate.getTime() + 366 * 24 * 60 * 60 * 1000;

  while (results.length < count && cursor.getTime() <= limitMs) {
    const month = cursor.getMonth() + 1;
    if (!parsed.month.values.has(month)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const dom = cursor.getDate();
    const dow = cursor.getDay();
    const dayMatches =
      parsed.dom.any && parsed.dow.any
        ? true
        : parsed.dom.any
          ? parsed.dow.values.has(dow)
          : parsed.dow.any
            ? parsed.dom.values.has(dom)
            : parsed.dom.values.has(dom) || parsed.dow.values.has(dow);

    if (!dayMatches) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = cursor.getHours();
    if (!parsed.hour.values.has(hour)) {
      cursor.setHours(hour + 1, 0, 0, 0);
      continue;
    }

    const minute = cursor.getMinutes();
    if (parsed.minute.values.has(minute)) {
      results.push(cursor.getTime());
    }
    cursor.setMinutes(minute + 1);
  }

  return results;
}
