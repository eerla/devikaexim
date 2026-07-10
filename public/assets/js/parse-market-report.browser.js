const VARIANT_MAP = {
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
  'shark & sharp': 'Shark & Sharp',
  'shark': 'Shark',
  'syngenta ballary': 'Syngenta ballary',
  'syngenta desavali': 'Syngenta desavali',
  'syzinta byadgi': 'Syngenta ballary',
  'romi': 'ROMI',
  'romi 26': 'ROMI 26',
  'no.5': 'NO 5',
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
  'all fatkis': 'All Fatkis'
};

function normalizeVariety(raw) {
  var lower = raw.toLowerCase().trim();
  return VARIANT_MAP[lower] || raw.trim().toUpperCase();
}

function parsePriceRange(text) {
  var cleaned = text.replace(/[^\d/]/g, '').trim();
  var parts = cleaned.split('/').map(function(p) { return parseInt(p.trim(), 10); }).filter(function(n) { return !isNaN(n); });
  if (parts.length === 0) return null;
  if (parts.length === 1) return { min: parts[0], max: parts[0] };
  if (parts.length === 2) return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) };
  var sorted = parts.slice().sort(function(a, b) { return a - b; });
  return { min: sorted[0], max: sorted[sorted.length - 1], mid: sorted[1] };
}

function parsePriceRangeFromText(text) {
  var cleaned = text.replace(/[\s,]/g, '');
  var match = cleaned.match(/(\d+)\s*[\/\-]\s*(\d+)/);
  if (match) {
    var min = parseInt(match[1], 10);
    var max = parseInt(match[2], 10);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  var single = cleaned.match(/(\d+)/);
  if (single) {
    return { min: parseInt(single[1], 10), max: parseInt(single[1], 10) };
  }
  return null;
}

function detectCategory(line) {
  var upper = line.toUpperCase();
  if (upper.indexOf('NON AC') !== -1 || upper.indexOf('NONAC') !== -1) return 'NON AC';
  if (upper.indexOf('AC ') !== -1 || upper.indexOf('A/C') !== -1) return 'AC';
  return 'AC';
}

function extractNote(line) {
  var notes = ['Deluxe Qlts not available', 'No Deluxe', 'Deluxe Less Qlts in market', 'General market', 'GOOD SALES VERY LESS DELUXE QUALITIES'];
  for (var i = 0; i < notes.length; i++) {
    if (line.toLowerCase().indexOf(notes[i].toLowerCase()) !== -1) return notes[i];
  }
  return undefined;
}

function parseMarketReport(raw) {
  var lines = raw.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return !!l; });
  var result = {
    report_date: '',
    market: 'Guntur',
    state: 'Andhra Pradesh',
    arrivals: {},
    prices: [],
    summary: []
  };
  var currentCategory = 'AC';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var clean = line.replace(/^[*•💥🪷🌶️🗒️()]+/, '').replace(/[*]+$/g, '').trim();
    if (!clean || clean === 'TMPMIRCHI MARKET REPORTS' || clean === 'BHARAT') continue;

    // Flexible date: 9-7-2026 or 06.07.2026
    var dateMatch = clean.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
    if (dateMatch) {
      result.report_date = dateMatch[0];
      continue;
    }
    if (clean.match(/^(ANDHRA|ANDHRA PRADESH|GUNTUR)$/i)) {
      if (/ANDHRA/i.test(clean)) result.state = 'Andhra Pradesh';
      if (/GUNTUR/i.test(clean)) result.market = 'Guntur';
      continue;
    }
    if (clean.match(/ARRIVALS/i)) {
      var numMatch = clean.match(/([\d,]+)[/]?[\d,]*\s*bags/i);
      var num = numMatch ? numMatch[1] : '';
      if (/NON.?AC/i.test(clean)) {
        result.arrivals.non_ac = num ? num + ' bags approx' : clean;
      } else if (/A?\/?\s*C/i.test(clean)) {
        result.arrivals.ac = num ? num + ' bags approx' : clean;
      } else if (!result.arrivals.ac) {
        result.arrivals.ac = num ? num + ' bags approx' : clean;
      }
      continue;
    }
    if (clean.match(/MARKET\s+(STEADY|WEAK|UP|DOWN)/i)) {
      var sm = clean.match(/STEADY|WEAK|UP|DOWN/i);
      if (sm) result.market_status = sm[0];
      continue;
    }
    if (clean.indexOf('👈') !== -1) {
      var text = clean.replace('👈', '').trim();
      if (text) result.summary.push(text);
      continue;
    }

    var compactClean = clean.replace(/[\s,]/g, '');
    var hasPriceRange = /[\d]+\/[\d]+/.test(compactClean) || /[\d]+\-[\d]+/.test(compactClean) || /^\d+$/.test(compactClean.replace(/[^\d]/g, ''));
    
    if (hasPriceRange) {
      currentCategory = detectCategory(clean);
      var varietyRaw = '';
      var pricePart = '';
      
      if (clean.indexOf('=') !== -1) {
        var eqParts = clean.split('=');
        varietyRaw = eqParts[0].trim();
        pricePart = eqParts.slice(1).join('=').trim();
      } else if (clean.indexOf(':') !== -1) {
        var parts = clean.split(':');
        varietyRaw = parts[0].trim();
        pricePart = parts.slice(1).join(':').trim();
      } else {
        var priceMatch = clean.match(/([\d,]+\/[\d,]+(?:\/[\d,]+)*|[\d]+\-[\d]+)\s*$/);
        if (priceMatch) {
          pricePart = priceMatch[1].trim();
          varietyRaw = clean.slice(0, clean.length - priceMatch[0].length).trim();
        } else {
          varietyRaw = clean;
          pricePart = '';
        }
      }
      
      varietyRaw = varietyRaw.replace(/[^\w\s&().\-/]/g, '').trim();
      var variety = normalizeVariety(varietyRaw);
      var prices = parsePriceRangeFromText(pricePart || clean);
      var note = extractNote(clean);
      
      var isKnownVariety = VARIANT_MAP[varietyRaw.toLowerCase()] !== undefined;
      var looksLikeVariety = varietyRaw.length > 1 && varietyRaw.length < 30 && !/^(DELUXE SOME|MOSTLY|MARKET|GOOD SALES|LESS DELUXE|TEJA DELUXE)/i.test(varietyRaw);
      
      if (prices && variety && (isKnownVariety || looksLikeVariety)) {
        result.prices.push({ category: currentCategory, variety: variety, min: prices.min, max: prices.max, mid: prices.mid, note: note });
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
    var dateMatch = raw.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
    if (dateMatch) result.report_date = dateMatch[0];
  }
  return result;
}

function downloadJson(filename, content) {
  var blob = new Blob([content], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.parseMarketReport = parseMarketReport;
window.downloadJson = downloadJson;
