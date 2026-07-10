import os
import re
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from google.cloud import bigquery

# ─── Config ───────────────────────────────────────────────────────────────────

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "devikaexim")
DATASET_ID = os.getenv("BQ_DATASET", "market")
TABLE_ID = os.getenv("BQ_TABLE", "chilli_prices")

# ─── BigQuery client ──────────────────────────────────────────────────────────

def get_bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID)

# ─── Parser (ported from admin-parser JS) ─────────────────────────────────────

VARIANT_MAP = {
    'teja': 'TEJA', 'teja fatki': 'TEJA FATKI', '341': '341',
    '341 deshawali': '341 DESHAWALI', 'armour': 'Armour', 'armoor': 'Armour',
    'armoor (top gun)': 'Armour (Top Gun)', '334': '334', '334 s.10': '334 S.10',
    'shark & sharp': 'Shark & Sharp', 'shark': 'Shark',
    'syngenta ballary': 'Syngenta ballary', 'syngenta desavali': 'Syngenta desavali',
    'syzinta byadgi': 'Syngenta ballary', 'romi': 'ROMI', 'romi 26': 'ROMI 26',
    'no.5': 'NO 5', 'no 5': 'NO 5', '2043': '2043', 'dd': 'DD',
    'bullet': 'Bullet', 'bangaram': 'Bangaram', '355 byadgi': '355 byadgi',
    'classic': 'Classic', 'fatki': 'FATKI', 'deluxe': 'DELUXE',
}

HISTORICAL_VARIETY_MAP = {
    'TEJA': 'Teja',
    '341': '341',
    'ARMOUR': 'Armoor',
    'ARMOUR (TOP GUN)': 'Armoor',
    '334': '334/Sannam',
    '334 S.10': '334/S10',
    'SHARK': '334/Sannam',
    'SHARK & SHARP': '334/Sannam',
    'SYNGENTA BALLARY': '334/Sannam',
    'SYNGENTA DESAVALI': '334/Sannam',
    'BYADGI': 'Byadgi',
    '355 BYADGI': 'Byadgi',
    'DD': 'DD',
    'BULLET': 'DD',
    'BANGARAM': 'DD',
    'ROMI': 'DD',
    'NO 5': 'DD',
    '2043': 'DD',
    'FATKI': '334/S10',
    'SEED': 'Seed',
    'GANESH ARMOUR': 'Armoor',
}

def normalize_variety(raw: str) -> str:
    lower = raw.lower().strip()
    return VARIANT_MAP.get(lower, raw.strip().upper())


def parse_price_range(text: str) -> Optional[Dict[str, Any]]:
    cleaned = re.sub(r'[^\d/]', '', text).strip()
    parts = [int(p.strip()) for p in cleaned.split('/') if p.strip().isdigit()]
    if not parts:
        return None
    if len(parts) == 1:
        return {'min': parts[0], 'max': parts[0]}
    if len(parts) == 2:
        return {'min': min(parts), 'max': max(parts)}
    sorted_parts = sorted(parts)
    return {'min': sorted_parts[0], 'max': sorted_parts[-1], 'mid': sorted_parts[1]}


def detect_category(line: str) -> str:
    upper = line.upper()
    if 'NON AC' in upper or 'NONAC' in upper:
        return 'NON AC'
    if 'AC ' in upper or 'A/C' in upper:
        return 'AC'
    return 'AC'


def extract_note(line: str) -> Optional[str]:
    notes = [
        'Deluxe Qlts not available', 'No Deluxe',
        'Deluxe Less Qlts in market', 'General market',
        'GOOD SALES VERY LESS DELUXE QUALITIES'
    ]
    lower = line.lower()
    for note in notes:
        if note.lower() in lower:
            return note
    return None


def parse_market_report(raw: str) -> Dict[str, Any]:
    lines = [l.strip() for l in raw.split('\n') if l.strip()]
    result = {
        'report_date': '',
        'market': 'Guntur',
        'state': 'Andhra Pradesh',
        'arrivals': {},
        'prices': [],
        'summary': [],
        'market_status': '',
    }

    for line in lines:
        clean = re.sub(r'^[*•💥🪷🌶️🗒️()]+', '', line).strip()
        clean = re.sub(r'[*]+$', '', clean).strip()

        if not clean or clean in ('TMPMIRCHI MARKET REPORTS', 'BHARAT'):
            continue

        if re.search(r'\d{2}[.\-]\d{2}[.\-]\d{4}', clean):
            result['report_date'] = re.search(r'\d{2}[.\-]\d{2}[.\-]\d{4}', clean).group(0)
            continue

        if re.match(r'^(ANDHRA|ANDHRA PRADESH|GUNTUR)$', clean, re.I):
            if 'ANDHRA' in clean.upper():
                result['state'] = 'Andhra Pradesh'
            if 'GUNTUR' in clean.upper():
                result['market'] = 'Guntur'
            continue

        if 'ARRIVALS' in clean.upper():
            num_match = re.search(r'([\d,]+)[/]?[\d,]*\s*bags', clean, re.I)
            num = num_match.group(1) if num_match else ''
            if re.search(r'NON.?AC', clean, re.I):
                result['arrivals']['non_ac'] = f'{num} bags approx' if num else clean
            elif re.search(r'AC', clean, re.I):
                result['arrivals']['ac'] = f'{num} bags approx' if num else clean
            continue

        if re.search(r'MARKET\s+(STEADY|WEAK|UP|DOWN)', clean, re.I):
            match = re.search(r'STEADY|WEAK|UP|DOWN', clean, re.I)
            if match:
                result['market_status'] = match.group(0)
            continue

        if '👈' in clean:
            text = clean.replace('👈', '').strip()
            if text:
                result['summary'].append(text)
            continue

        has_price_range = bool(re.search(r'[\d,]+\/[\d,]+', clean) or re.search(r'^\d+$', re.sub(r'[^\d]', '', clean)))
        if has_price_range:
            category = detect_category(clean)
            variety_raw = ''
            price_part = ''

            if ':' in clean:
                parts = clean.split(':')
                variety_raw = parts[0].strip()
                price_part = ':'.join(parts[1:]).strip()
            elif re.match(r'^[A-Za-z0-9 &().\-]+\s+\d', clean):
                m = re.match(r'^(.+?)(\s+\d.*)$', clean)
                if m:
                    variety_raw = m.group(1).strip()
                    price_part = m.group(2).strip()
                else:
                    variety_raw = clean
                    price_part = ''
            else:
                variety_raw = clean
                price_part = ''

            variety = normalize_variety(variety_raw)
            prices = parse_price_range(price_part or clean)
            note = extract_note(clean)

            is_known = variety_raw.lower() in VARIANT_MAP
            looks_like = 1 < len(variety_raw) < 30 and not re.match(
                r'^(DELUXE SOME|MOSTLY|MARKET|GOOD SALES|LESS DELUXE|TEJA DELUXE|DELUXE)$', variety_raw, re.I
            )

            if prices and variety and (is_known or looks_like):
                result['prices'].append({
                    'category': category,
                    'variety': variety,
                    **prices,
                    'note': note,
                })
            elif prices:
                result['summary'].append(clean)
            continue

        if re.match(r'^(DELUXE|MOSTLY|MARKET|TEJA DELUXE)\s', clean, re.I):
            result['summary'].append(clean)
            continue

    if not result['report_date']:
        date_match = re.search(r'(\d{2})[.\-](\d{2})[.\-](\d{4})', raw)
        if date_match:
            result['report_date'] = date_match.group(0)

    return result


# ─── BigQuery helpers ─────────────────────────────────────────────────────────

def ensure_table(client: bigquery.Client):
    dataset_ref = client.dataset(DATASET_ID)
    table_ref = dataset_ref.table(TABLE_ID)
    try:
        client.get_table(table_ref)
    except Exception:
        schema = [
            bigquery.SchemaField('report_date', 'STRING', mode='REQUIRED'),
            bigquery.SchemaField('market', 'STRING'),
            bigquery.SchemaField('state', 'STRING'),
            bigquery.SchemaField('arrivals', 'STRING'),
            bigquery.SchemaField('category', 'STRING'),
            bigquery.SchemaField('variety', 'STRING'),
            bigquery.SchemaField('min_price', 'INT64'),
            bigquery.SchemaField('max_price', 'INT64'),
            bigquery.SchemaField('mid_price', 'INT64'),
            bigquery.SchemaField('note', 'STRING'),
            bigquery.SchemaField('market_status', 'STRING'),
            bigquery.SchemaField('summary_text', 'STRING'),
            bigquery.SchemaField('ingested_at', 'TIMESTAMP', mode='REQUIRED'),
        ]
        table = bigquery.Table(table_ref, schema=schema)
        client.create_table(table)
        print(f"Created table {TABLE_ID}")


def write_report(client: bigquery.Client, report: Dict[str, Any]) -> int:
    ensure_table(client)
    rows_to_insert = []
    now = datetime.utcnow().isoformat()
    arrivals_str = str(report.get('arrivals', {}))

    if report['prices']:
        for price in report['prices']:
            rows_to_insert.append({
                'report_date': report['report_date'],
                'market': report['market'],
                'state': report['state'],
                'arrivals': arrivals_str,
                'category': price['category'],
                'variety': price['variety'],
                'min_price': price['min'],
                'max_price': price['max'],
                'mid_price': price.get('mid'),
                'note': price.get('note'),
                'market_status': report.get('market_status', ''),
                'summary_text': '',
                'ingested_at': now,
            })
        for s in report.get('summary', []):
            rows_to_insert.append({
                'report_date': report['report_date'],
                'market': report['market'],
                'state': report['state'],
                'arrivals': arrivals_str,
                'category': 'SUMMARY',
                'variety': '',
                'min_price': None,
                'max_price': None,
                'mid_price': None,
                'note': None,
                'market_status': report.get('market_status', ''),
                'summary_text': s,
                'ingested_at': now,
            })
    else:
        rows_to_insert.append({
            'report_date': report['report_date'],
            'market': report['market'],
            'state': report['state'],
            'arrivals': arrivals_str,
            'category': 'REPORT',
            'variety': '',
            'min_price': None,
            'max_price': None,
            'mid_price': None,
            'note': None,
            'market_status': report.get('market_status', ''),
            'summary_text': ' | '.join(report.get('summary', [])),
            'ingested_at': now,
        })

    table_ref = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"
    errors = client.insert_rows_json(table_ref, rows_to_insert)
    if errors:
        raise Exception(f"BigQuery insert errors: {errors}")

    historical_count = write_historical_report(client, report)

    return {
        'chilli_prices_count': len(rows_to_insert),
        'historical_count': historical_count,
    }


def ensure_historical_table(client: bigquery.Client):
    dataset_ref = client.dataset(DATASET_ID)
    table_ref = dataset_ref.table('historical_prices')
    try:
        client.get_table(table_ref)
    except Exception:
        schema = [
            bigquery.SchemaField('date', 'DATE', mode='REQUIRED'),
            bigquery.SchemaField('variety', 'STRING', mode='REQUIRED'),
            bigquery.SchemaField('grade', 'STRING', mode='REQUIRED'),
            bigquery.SchemaField('min_price', 'INT64'),
            bigquery.SchemaField('max_price', 'INT64'),
        ]
        table = bigquery.Table(table_ref, schema=schema)
        client.create_table(table)
        print("Created table historical_prices")


def write_historical_report(client: bigquery.Client, report: Dict[str, Any]) -> int:
    ensure_historical_table(client)
    rows_to_insert = []

    date_str = report.get('report_date', '')
    iso_date = None
    if date_str:
        for fmt in ('%d.%m.%Y', '%m.%d.%Y', '%Y-%m-%d'):
            try:
                iso_date = datetime.strptime(date_str, fmt).strftime('%Y-%m-%d')
                break
            except ValueError:
                continue

    if not iso_date:
        return 0

    for price in report.get('prices', []):
        variety_raw = price.get('variety', '').strip()
        historical_variety = HISTORICAL_VARIETY_MAP.get(variety_raw)
        if not historical_variety:
            continue

        grade = 'Best'
        note = (price.get('note') or '').lower()
        if 'medium best' in note:
            grade = 'Medium Best'
        elif 'medium' in note:
            grade = 'Medium'
        elif 'deluxe' in note:
            grade = 'Deluxe'

        rows_to_insert.append({
            'date': iso_date,
            'variety': historical_variety,
            'grade': grade,
            'min_price': price.get('min'),
            'max_price': price.get('max'),
        })

    if rows_to_insert:
        table_ref = f"{PROJECT_ID}.{DATASET_ID}.historical_prices"
        errors = client.insert_rows_json(table_ref, rows_to_insert)
        if errors:
            raise Exception(f"BigQuery historical insert errors: {errors}")

    return len(rows_to_insert)


def fetch_latest_prices(client: bigquery.Client) -> dict:
    query = f"""
        SELECT
          report_date,
          market,
          state,
          arrivals,
          category,
          variety,
          min_price,
          max_price,
          mid_price,
          note,
          market_status,
          summary_text
        FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
        WHERE report_date = (
          SELECT MAX(report_date) FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
        )
        ORDER BY category, variety
    """
    results = client.query(query).result()
    rows = [dict(row.items()) for row in results]

    if not rows:
      return {
        'report_date': '', 'market': 'Guntur', 'state': 'Andhra Pradesh',
        'arrivals': {}, 'prices': [], 'summary': [], 'market_status': ''
      }

    first = rows[0]
    report = {
      'report_date': first.get('report_date', ''),
      'market': first.get('market', 'Guntur'),
      'state': first.get('state', 'Andhra Pradesh'),
      'arrivals': {},
      'prices': [],
      'summary': [],
      'market_status': first.get('market_status', ''),
    }

    for row in rows:
      if row.get('category') == 'SUMMARY':
        text = row.get('summary_text', '')
        if text:
          report['summary'].append(text)
        continue

      arrivals_raw = row.get('arrivals') or '{}'
      if isinstance(arrivals_raw, str):
        try:
          report['arrivals'] = eval(arrivals_raw)
        except Exception:
          report['arrivals'] = {}

      if row.get('category') in ('AC', 'NON AC') and row.get('variety'):
        report['prices'].append({
          'category': row.get('category', ''),
          'variety': row.get('variety', ''),
          'min': row.get('min_price') or 0,
          'max': row.get('max_price') or 0,
          'mid': row.get('mid_price'),
          'note': row.get('note'),
        })

    return report

# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="Devika Exim Market API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PriceItem(BaseModel):
    category: str
    variety: str
    min: Optional[int] = None
    max: Optional[int] = None
    mid: Optional[int] = None
    note: Optional[str] = None


class ParsedReport(BaseModel):
    report_date: str
    market: str = 'Guntur'
    state: str = 'Andhra Pradesh'
    arrivals: Dict[str, Any] = Field(default_factory=dict)
    prices: List[PriceItem] = Field(default_factory=list)
    summary: List[str] = Field(default_factory=list)
    market_status: str = ''


class ReportRequest(BaseModel):
    raw_text: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/reports")
def ingest_report(request: ReportRequest):
    if not request.raw_text.strip():
        raise HTTPException(status_code=400, detail="raw_text is required")

    try:
        report = parse_market_report(request.raw_text)
        if not report['report_date']:
            raise HTTPException(status_code=400, detail="Could not parse report date")
        client = get_bq_client()
        result = write_report(client, report)
        return {
            "status": "ok",
            "report_date": report['report_date'],
            "prices_count": len(report['prices']),
            "summary_count": len(report['summary']),
            "rows_written": result['chilli_prices_count'],
            "historical_rows_written": result['historical_count'],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prices/history")
def get_price_history(variety: str = 'Teja', days: int = 90):
    try:
        client = get_bq_client()
        query = f"""
            SELECT date, variety, grade, min_price, max_price
            FROM `{PROJECT_ID}.{DATASET_ID}.historical_prices`
            WHERE variety = @variety
              AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            ORDER BY date ASC, grade ASC
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("variety", "STRING", variety),
                bigquery.ScalarQueryParameter("days", "INT64", days),
            ]
        )
        results = client.query(query, job_config=job_config).result()
        rows = [dict(row.items()) for row in results]
        return {"variety": variety, "days": days, "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prices/varieties")
def get_varieties():
    try:
        client = get_bq_client()
        query = f"""
            SELECT DISTINCT variety, grade
            FROM `{PROJECT_ID}.{DATASET_ID}.historical_prices`
            ORDER BY variety, grade
        """
        results = client.query(query).result()
        rows = [dict(row.items()) for row in results]
        return {"varieties": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prices/trends")
def get_price_trends():
    try:
        client = get_bq_client()
        query = f"""
            WITH monthly AS (
              SELECT
                FORMAT_DATE('%Y-%m', date) AS month,
                variety,
                grade,
                AVG((min_price + max_price) / 2) AS avg_price
              FROM `{PROJECT_ID}.{DATASET_ID}.historical_prices`
              WHERE variety IN ('Teja', '334/Sannam', 'Byadgi', '341', 'DD', 'Armoor')
                AND grade = 'Best'
              GROUP BY month, variety, grade
            )
            SELECT month, variety, grade, avg_price
            FROM monthly
            ORDER BY month ASC, variety ASC
        """
        results = client.query(query).result()
        rows = [dict(row.items()) for row in results]
        return {"data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prices/latest")
def get_latest_prices():
    try:
        client = get_bq_client()
        report_dict = report.dict()
        result = write_report(client, report_dict)
        return {
            "status": "ok",
            "report_date": report.report_date,
            "prices_count": len(report.prices),
            "summary_count": len(report.summary),
            "rows_written": result['chilli_prices_count'],
            "historical_rows_written": result['historical_count'],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
