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
  'teja fatki': 'TEJA FATKI',
  '341': '341',
  '341 deshawali': '341 DESHAWALI',
  'armour': 'Armour',
  'armoor': 'Armour',
  'armoor (top gun)': 'Armour (Top Gun)',
  '334': '334',
  '334 s.10': '334 S.10',
  's10': '334 S.10',
  '273': '334',
  'shark': 'Shark',
  'syngenta ballary': 'Syngenta ballary',
  'syngenta desavali': 'Syngenta desavali',
  'romi 26': 'ROMI 26',
  'no 5': 'NO 5',
  'no5': 'NO 5',
  '2043': '2043',
  'dd': 'DD',
  'bullet': 'Bullet',
  'bangaram': 'Bangaram',
  '355 byadgi': '355 byadgi',
  '5531 byd': '355 byadgi',
  'byd': 'Byadgi',
  'byadgi': 'Byadgi',
  'classic': 'Classic',
  'fatki': 'FATKI',
  'deluxe': 'DELUXE',
  'ganesh armour': 'Ganesh Armour',
  'all fatkis': 'All Fatkis',
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
  if (parts.length === 2) return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) };
  const sorted = [...parts].sort((a, b) => a - b);
  return { min: sorted[0], max: sorted[sorted.length - 1], mid: sorted[1] };
}

function parsePriceRangeFromText(text: string): { min: number; max: number } | null {
  const cleaned = text.replace(/[\s,]/g, '');
  const match = cleaned.match(/(\d+)\s*[\/\-]\s*(\d+)/);
  if (match) {
    const min = parseInt(match[1], 10);
    const max = parseInt(match[2], 10);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  const single = cleaned.match(/(\d+)/);
  if (single) {
    return { min: parseInt(single[1], 10), max: parseInt(single[1], 10) };
  }
  return null;
}

function toQuintal(prices: { min: number; max: number } | null): { min: number; max: number } | null {
  if (!prices) return null;
  const threshold = 1000;
  const min = prices.min < threshold ? prices.min * 100 : prices.min;
  const max = prices.max < threshold ? prices.max * 100 : prices.max;
  return { min, max };
}

function detectCategory(line: string): string {
  const upper = line.toUpperCase();
  if (upper.includes('NON AC') || upper.includes('NONAC')) return 'NON AC';
  if (upper.includes('AC ') || upper.includes('A/C')) return 'AC';
  return 'AC';
}

function extractNote(line: string): string | undefined {
  const notes = ['Deluxe Qlts not available', 'No Deluxe', 'Deluxe Less Qlts in market', 'General market', 'GOOD SALES VERY LESS DELUXE QUALITIES'];
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

  let currentCategory = 'AC';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = line.replace(/^[*•💥🪷🌶️🗒️]+/, '').trim();

    if (!clean || clean === 'TMPMIRCHI MARKET REPORTS' || clean === 'BHARAT') continue;

    const dateMatch = clean.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
    if (dateMatch) {
      result.report_date = dateMatch[0];
      continue;
    }

    if (clean.match(/^(ANDHRA|ANDHRA PRADESH|GUNTUR)$/i)) {
      if (clean.match(/ANDHRA/i)) result.state = 'Andhra Pradesh';
      if (clean.match(/GUNTUR/i)) result.market = 'Guntur';
      continue;
    }

    if (clean.match(/ARRIVALS/i)) {
      const numMatch = clean.match(/([\d,]+)\/[\d,]*\s*bags/i);
      const num = numMatch ? numMatch[1] : '';
      if (clean.match(/NON.?AC/i)) {
        result.arrivals.non_ac = num ? `${num} bags approx` : clean;
      } else if (clean.match(/A?\/?\s*C/i)) {
        result.arrivals.ac = num ? `${num} bags approx` : clean;
      } else if (!result.arrivals.ac) {
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
    let hasPriceRange = /[\d]+\/[\d]+/.test(compactClean) || /[\d]+\-[\d]+/.test(compactClean) || /^\d+$/.test(compactClean.replace(/[^\d]/g, ''));

    if (!hasPriceRange && clean.length > 1 && clean.length < 30 && !/^(DELUXE SOME|MOSTLY|MARKET|GOOD SALES|LESS DELUXE|TEJA DELUXE)/i.test(clean)) {
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextClean = nextLine.replace(/^[*•💥🪷🌶️🗒️]+/, '').trim();
        const nextCompact = nextClean.replace(/[\s,]/g, '');
        const nextHasPrice = /[\d]+\/[\d]+/.test(nextCompact) || /[\d]+\-[\d]+/.test(nextCompact);
        const nextNotHeader = !nextClean.match(/^(ANDHRA|ANDHRA PRADESH|GUNTUR|ARRIVALS|MARKET\s+(STEADY|WEAK|UP|DOWN))/i);

        if (nextHasPrice && nextNotHeader && !/^[*•💥🪷🌶️🗒️()]+$/.test(nextLine)) {
          const combined = clean + ' ' + nextClean;
          const combinedCompact = combined.replace(/[\s,]/g, '');
          hasPriceRange = /[\d]+\/[\d]+/.test(combinedCompact) || /[\d]+\-[\d]+/.test(combinedCompact);

          if (hasPriceRange) {
            currentCategory = detectCategory(combined);
            let varietyRaw = '';
            let pricePart = '';

            if (combined.includes('=')) {
              const eqParts = combined.split('=');
              varietyRaw = eqParts[0].trim();
              pricePart = eqParts.slice(1).join('=').trim();
            } else {
              const priceMatch2 = combined.match(/([\d,]+\/[\d,]+(?:\/[\d,]+)*|[\d]+\-[\d]+)\s*$/);
              if (priceMatch2) {
                pricePart = priceMatch2[1].trim();
                varietyRaw = combined.slice(0, combined.length - priceMatch2[0].length).trim();
              }
            }

            varietyRaw = varietyRaw.replace(/[^\w\s&().\-/]/g, '').trim();
            const variety = normalizeVariety(varietyRaw);
            const prices = toQuintal(parsePriceRangeFromText(pricePart || combined));
            const note = extractNote(combined);

            const isKnownVariety = VARIANT_MAP[varietyRaw.toLowerCase()] !== undefined;
            const looksLikeVariety = varietyRaw.length > 1 && varietyRaw.length < 30 && !/^(DELUXE SOME|MOSTLY|MARKET|GOOD SALES|LESS DELUXE|TEJA DELUXE)/i.test(varietyRaw);

            if (prices && variety && (isKnownVariety || looksLikeVariety)) {
              result.prices.push({
                category: currentCategory,
                variety,
                ...prices,
                note,
              });
            } else if (prices && variety) {
              result.summary.push(combined.replace(/^\*+|\*+$/g, '').trim());
            }
            i++;
            continue;
          }
        }
      }
    }

    if (hasPriceRange) {
      currentCategory = detectCategory(clean);
      let varietyRaw = '';
      let pricePart = '';

      if (clean.includes('=')) {
        const eqParts = clean.split('=');
        varietyRaw = eqParts[0].trim();
        pricePart = eqParts.slice(1).join('=').trim();
      } else if (clean.includes(':')) {
        const parts = clean.split(':');
        varietyRaw = parts[0].trim();
        pricePart = parts.slice(1).join(':').trim();
      } else {
        const priceMatch = clean.match(/([\d,]+\/[\d,]+(?:\/[\d,]+)*|[\d]+\-[\d]+)\s*$/);
        if (priceMatch) {
          pricePart = priceMatch[1].trim();
          varietyRaw = clean.slice(0, clean.length - priceMatch[0].length).trim();
        } else {
          varietyRaw = clean;
          pricePart = '';
        }
      }

      varietyRaw = varietyRaw.replace(/[^\w\s&().\-/]/g, '').trim();
      const variety = normalizeVariety(varietyRaw);
      let prices = toQuintal(parsePriceRangeFromText(pricePart || clean));
      const note = extractNote(clean);

      if (!prices && varietyRaw.length > 1 && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextClean = nextLine.replace(/^[*•💥🪷🌶️🗒️]+/, '').trim();
        const nextCompact = nextClean.replace(/[\s,]/g, '');
        const nextHasPrice = /[\d]+\/[\d]+/.test(nextCompact) || /[\d]+\-[\d]+/.test(nextCompact);
        const nextNotHeader = !nextClean.match(/^(ANDHRA|ANDHRA PRADESH|GUNTUR|ARRIVALS|MARKET\s+(STEADY|WEAK|UP|DOWN))/i);

        if (nextHasPrice && nextNotHeader && !/^[*•💥🪷🌶️🗒️()]+$/.test(nextLine)) {
          prices = toQuintal(parsePriceRangeFromText(nextClean));
          i++;
        }
      }

      const isKnownVariety = VARIANT_MAP[varietyRaw.toLowerCase()] !== undefined;
      const looksLikeVariety = varietyRaw.length > 1 && varietyRaw.length < 30 && !/^(DELUXE SOME|MOSTLY|MARKET|GOOD SALES|LESS DELUXE|TEJA DELUXE)/i.test(varietyRaw);

      if (prices && variety && (isKnownVariety || looksLikeVariety)) {
        result.prices.push({
          category: currentCategory,
          variety,
          ...prices,
          note,
        });
      } else if (prices && variety) {
        result.summary.push(clean.replace(/^\*+|\*+$/g, '').trim());
      }
      continue;
    }

    if (clean.match(/^(DELUXE|MOSTLY|MARKET|TEJA DELUXE)\s/i)) {
      result.summary.push(clean.replace(/^\*+|\*+$/g, '').trim());
      continue;
    }
  }

  if (!result.report_date) {
    const dateMatch = raw.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
    if (dateMatch) result.report_date = dateMatch[0];
  }

  return result;
}

export function marketReportToJson(raw: string): string {
  const report = parseMarketReport(raw);
  return JSON.stringify(report, null, 2);
}
