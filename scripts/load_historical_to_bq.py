import json
import os
from google.cloud import bigquery
from google.oauth2 import service_account

INPUT_FILE = r'C:\Users\gurub\projects\devikaexim\dist\historical_prices.json'
PROJECT_ID = 'devikaexim'
DATASET_ID = 'market'
TABLE_ID = 'historical_prices'

def get_bq_client():
    creds_path = os.path.join(os.path.dirname(__file__), '..', 'api', 'service-account.json')
    if os.path.exists(creds_path):
        credentials = service_account.Credentials.from_service_account_file(creds_path)
        return bigquery.Client(project=PROJECT_ID, credentials=credentials)
    return bigquery.Client(project=PROJECT_ID)

def ensure_table(client):
    dataset_ref = client.dataset(DATASET_ID)
    table_ref = dataset_ref.table(TABLE_ID)
    try:
        client.get_table(table_ref)
        print(f"Table {TABLE_ID} already exists")
        return
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
        print(f"Created table {TABLE_ID}")

def load_data(client):
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        rows = json.load(f)
    
    print(f"Loading {len(rows)} rows into BigQuery...")
    
    job_config = bigquery.LoadJobConfig(
        schema=[
            bigquery.SchemaField('date', 'DATE'),
            bigquery.SchemaField('variety', 'STRING'),
            bigquery.SchemaField('grade', 'STRING'),
            bigquery.SchemaField('min_price', 'INT64'),
            bigquery.SchemaField('max_price', 'INT64'),
        ],
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition='WRITE_TRUNCATE',
    )
    
    # Convert to newline-delimited JSON
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False, encoding='utf-8') as tmp:
        for row in rows:
            tmp.write(json.dumps(row) + '\n')
        tmp_path = tmp.name
    
    with open(tmp_path, 'rb') as source_file:
        load_job = client.load_table_from_file(
            source_file,
            f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}",
            job_config=job_config
        )
    
    load_job.result()
    print(f"Loaded {load_job.output_rows} rows")
    
    os.unlink(tmp_path)

def main():
    client = get_bq_client()
    ensure_table(client)
    load_data(client)
    print("Done!")

if __name__ == '__main__':
    main()
