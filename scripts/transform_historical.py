import json
import csv
import re
from datetime import datetime

INPUT_FILE = r'C:\Users\gurub\projects\devikaexim\src\data\gunturmirchi_sheet_data.json'
OUTPUT_FILE = r'C:\Users\gurub\projects\devikaexim\dist\historical_prices.json'

def parse_date(date_str):
    """Parse dates like 5/16/2019 or 6/24/2026 to ISO format."""
    date_str = date_str.strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(date_str, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return date_str

def normalize_price(val):
    """Convert price string to number, or None."""
    if not val or val.strip() in ('', 'Market Closed', '-', 'N/A'):
        return None
    cleaned = re.sub(r'[^\d]', '', val.strip())
    if not cleaned:
        return None
    return int(cleaned)

def split_variety_grade(header):
    """Split column header like 'Teja Medium Best' into (variety, grade)."""
    header = header.strip()
    
    # Fatki patterns
    fatki_match = re.match(r'^(.+?)\s+(Fatki|Fatki\s*S10|S10)\s+(Medium|Best|Medium Best)$', header, re.I)
    if fatki_match:
        variety = fatki_match.group(1).strip()
        grade = fatki_match.group(3).strip()
        return variety, grade
    
    # Seed patterns
    if re.match(r'^Seed\s+Variety', header, re.I):
        grade = re.sub(r'^Seed\s+Variety\s*', '', header, flags=re.I).strip()
        return 'Seed', grade
    
    # Standard patterns: "Teja Medium Best", "334/Sannam Medium", "Byadgi Medum"
    grade_match = re.match(r'^(.+?)\s+(Medium|Best|Medium Best|Deluxe)$', header, re.I)
    if grade_match:
        variety = grade_match.group(1).strip()
        grade = grade_match.group(2).strip()
        return variety, grade
    
    # Fallback: just use the whole thing as variety
    return header, 'Standard'

def transform_consolidated(values):
    """Transform Consolidated Prices sheet rows."""
    rows = []
    headers = values[0]
    data_rows = values[1:]
    
    for row in data_rows:
        if not row or not row[0]:
            continue
        date = parse_date(row[0])
        for i in range(1, len(headers)):
            if i >= len(row):
                continue
            variety, grade = split_variety_grade(headers[i])
            price = normalize_price(row[i])
            if price is not None:
                rows.append({
                    'date': date,
                    'variety': variety,
                    'grade': grade,
                    'min_price': price,
                    'max_price': price,
                })
    return rows

def transform_fatki(values):
    """Transform Fatki Table sheet rows."""
    rows = []
    headers = values[0]
    data_rows = values[1:]
    
    for row in data_rows:
        if not row or not row[0]:
            continue
        date = parse_date(row[0])
        for i in range(1, len(headers)):
            if i >= len(row):
                continue
            variety, grade = split_variety_grade(headers[i])
            price = normalize_price(row[i])
            if price is not None:
                rows.append({
                    'date': date,
                    'variety': variety,
                    'grade': grade,
                    'min_price': price,
                    'max_price': price,
                })
    return rows

def main():
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    all_rows = []
    
    for range_info in data['valueRanges']:
        range_name = range_info['range']
        values = range_info['values']
        
        if not values or len(values) < 2:
            continue
        
        if 'Consolidated Prices' in range_name:
            all_rows.extend(transform_consolidated(values))
        elif 'Fatki Table' in range_name:
            all_rows.extend(transform_fatki(values))
        # Skip Daily Snapshot - it's just text index, not numeric prices
    
    # Deduplicate by date+variety+grade (keep last occurrence)
    seen = {}
    for row in all_rows:
        key = (row['date'], row['variety'], row['grade'])
        seen[key] = row
    
    unique_rows = list(seen.values())
    unique_rows.sort(key=lambda r: (r['date'], r['variety'], r['grade']))
    
    print(f"Total rows: {len(all_rows)}")
    print(f"Unique rows: {len(unique_rows)}")
    print(f"Date range: {unique_rows[0]['date']} to {unique_rows[-1]['date']}")
    print(f"Varieties: {sorted(set(r['variety'] for r in unique_rows))}")
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(unique_rows, f, indent=2)
    
    print(f"Saved to {OUTPUT_FILE}")

if __name__ == '__main__':
    main()
