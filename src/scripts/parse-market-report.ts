export interface MarketReport {
  report_date: string;
  market: string;
  state: string;
  arrivals: {
    non_ac?: string;
    ac?: string;
  };
  prices: Array<{
    category: string;
    variety: string;
    min: number;
    max: number;
    mid?: number;
    note?: string;
  }>;
  summary: string[];
  market_status?: string;
}

const VARIANT_MAP: Record<string, string> = {
  'teja': 'TEJA',
  '341': '341',
  'armour': 'Armour',
  'armoor': 'Armour',
  '334': '334',
  'shark': 'Shark',
  'syngenta ballary': 'Syngenta ballary',
  'syngenta desavali': 'Syngenta desavali',
  'romi 26': 'ROMI 26',
  'no 5': 'NO 5',
  '2043': '2043',
  'dd': 'DD',
  'bullet': 'Bullet',
  'bangaram': 'Bangaram',
  '355 byadgi': '355 byadgi',
  'seed': 'SEED',
  'ganesh armour': 'Ganesh Armour',
};

function normalizeVariety(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (VARIANT_MAP[lower]) return VARIANT_MAP[lower];
  return raw.trim().toUpperCase();
}

function parsePriceRange(text: string): { min: number; max: number; mid?: number } | null {
  const cleaned = text.replace(/[^\d/]/g, '').trim();
  const parts = cleaned.split('/').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
  if (parts.length === 0) return null;
  if (parts.length === 1) return { min: parts[0], max: parts[0] };
  if (parts.length === 2) return { min: Math.min(...parts), max: Math.max(...parts) };
  if (parts.length >= 3) {
    const sorted = [...parts].sort((a, b) => a - b);
    return { min: sorted[0], max: sorted[sorted.length - 1], mid: sorted[1] };
  }
  return null;
}

function detectCategory(line: string): string {
  const upper = line.toUpperCase();
  if (upper.includes('NON AC') || upper.includes('NONAC')) return 'NON AC';
  if (upper.includes('AC ')) return 'AC';
  return 'Unknown';
}

function extractNote(line: string): string | undefined {
  const notes = ['Deluxe Qlts not available', 'No Deluxe', 'Deluxe Less Qlts in market', 'General market'];
  for (const note of notes) {
    if (line.toLowerCase().includes(note.toLowerCase())) return note;
  }
  return undefined;
}

export function parseMarketReport(raw: string): MarketReport {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  const result: MarketReport = {
    report_date: '',
    market: 'Guntur',
    state: 'Andhra Pradesh',
    arrivals: {},
    prices: [],
    summary: [],
  };

  let currentCategory = 'Unknown';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = line.replace(/^[*•💥🪷🌶️🗒️]+/, '').trim();

    if (!clean || clean === 'TMPMIRCHI MARKET REPORTS' || clean === 'BHARAT') continue;

    if (clean.match(/\d{2}\.\d{2}\.\d{4}/)) {
      result.report_date = clean.match(/\d{2}\.\d{2}\.\d{4}/)?.[0] || result.report_date;
      continue;
    }

    if (clean.match(/^(ANDHRA|ANDHRA PRADESH|GUNTUR)$/i)) {
      if (clean.match(/ANDHRA/i)) result.state = 'Andhra Pradesh';
      if (clean.match(/GUNTUR/i)) result.market = 'Guntur';
      continue;
    }

    if (clean.match(/ARRIVALS/i)) {
      const numMatch = clean.match(/([\d,]+)\s*bags/i);
      const num = numMatch ? numMatch[1] : '';
      if (clean.match(/NON.?AC/i)) {
        result.arrivals.non_ac = num ? `${num} bags approx` : clean;
      } else if (clean.match(/^AC\s/i)) {
        result.arrivals.ac = num ? `${num} bags approx` : clean;
      } else if (!result.arrivals.ac && clean.match(/AC/i)) {
        result.arrivals.ac = num ? `${num} bags approx` : clean;
      }
      continue;
    }

    if (clean.match(/MARKET\s+(STEADY|WEAK|UP|DOWN)/i)) {
      result.market_status = clean.match(/STEADY|WEAK|UP|DOWN/i)?.[0] || 'Unknown';
      continue;
    }

    if (clean.endsWith('👈')) {
      const text = clean.replace('👈', '').trim();
      if (text) result.summary.push(text);
      continue;
    }

    const compactClean = clean.replace(/[\s,]/g, '');
    const hasPriceRange = /[\d]+\/[\d]+/.test(compactClean) || /^\d+$/.test(compactClean);
    const isPriceLine = clean.includes('QLTS') || clean.includes('QLTY') || clean.includes('TALU');

    if (hasPriceRange && isPriceLine) {
      currentCategory = detectCategory(clean);
      const priceMatch = clean.match(/([\d,]+\/[\d,]+(?:\/[\d,]+)*)\s*$/);
      const varietyRaw = priceMatch
        ? clean.slice(0, clean.length - priceMatch[0].length).trim().replace(/[^\w\s&().\-/]/g, '').trim()
        : clean.replace(/\s*(QLTS?|QLTY|TALU)\s*$/i, '').trim();
      const variety = normalizeVariety(varietyRaw);
      const prices = parsePriceRange(priceMatch ? priceMatch[1] : clean);
      const note = extractNote(clean);

      if (prices && variety) {
        result.prices.push({
          category: currentCategory,
          variety,
          ...prices,
          note,
        });
      }
      continue;
    }
  }

  if (!result.report_date) {
    const dateMatch = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dateMatch) result.report_date = dateMatch[0];
  }

  return result;
}

export function marketReportToJson(raw: string): string {
  const report = parseMarketReport(raw);
  return JSON.stringify(report, null, 2);
}
