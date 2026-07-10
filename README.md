# July Service Dashboard

Cloud Run dashboard for July service progress, trade mix, weekly pace, and July trade year-over-year comparisons. Dashboard state is stored in Firestore with per-field transaction locks so multiple viewers can update the same period safely.

## Run locally

```sh
npm ci
gcloud auth application-default login
npm start
```

Open `http://127.0.0.1:8080/`. Override the port with `PORT=5173 npm start`.

The server uses Application Default Credentials locally. In Cloud Run it uses the service identity assigned to the service. The Firestore project and database default to `polarpath-fsm` and `service-call-dashboard`; override them with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_FIRESTORE_DATABASE_ID` when needed.

## Deploy

Deploy the Node server from the repository root:

```sh
gcloud run deploy service-call-dashboard \
  --project=polarpath-fsm \
  --region=us-central1 \
  --source=. \
  --service-account=service-call-dashboard-run@polarpath-fsm.iam.gserviceaccount.com \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=polarpath-fsm,GOOGLE_FIRESTORE_DATABASE_ID=service-call-dashboard \
  --allow-unauthenticated
```

Smoke-test `/`, `/api/dashboard-state?period=2026-07`, and `/healthz` after deployment. The service is currently public, including its write endpoint, so do not expose the URL outside the intended team until application-level write authentication is added.
