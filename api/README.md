# Devika Exim Market API

FastAPI service that parses Telegram market reports and stores them in BigQuery.

## Local development

```bash
python -m venv .venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8080
```

## Google Cloud setup

1. Create a GCP project (or use existing)
2. Enable BigQuery API
3. Create a service account with `BigQuery Data Editor` role
4. Download the service account JSON key
5. Build and deploy to Cloud Run (see below)

## Deploy to Cloud Run

```bash
gcloud run deploy devikaexim-market-api \
  --source api/ \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GCP_PROJECT_ID=devikaexim,BQ_DATASET=market,BQ_TABLE=chilli_prices \
  --set-secrets GCP_KEY_PATH=projects/devikaexim/secrets/bq-key:latest
```

## Endpoints

- `GET /health` — health check
- `POST /api/reports` — ingest a Telegram report
- `GET /api/prices/latest` — fetch latest prices

## Frontend config

After deployment, set the API URL in your Astro site:

```bash
# .env file in project root
PUBLIC_API_URL=https://devikaexim-market-api-xxx.run.app
```
