# MediCare AI Clinic — Demo Backend

## Run locally

From the project root, create and activate a virtual environment, install the
Python dependencies, then start the server:

```powershell
py -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

## How the application works

1. Visitors open the clinic website and can browse services, doctors,
   illustrative clinic hours, and appointment availability.
2. The guided booking flow collects a service, doctor preference, date, time
   period, name, and phone number. It checks live availability before showing
   a slot and submits the appointment only after the visitor confirms.
3. The AI chat uses Groq for clinic information and booking guidance. It can
   call server-side tools to list services, list doctors, and check
   availability. Chat does not create appointments; visitors complete
   bookings through the guided flow.
4. The triage endpoint provides conservative clinic-routing suggestions only.
   It does not diagnose conditions or provide treatment advice.
5. Appointment records are stored in SQLite. The admin dashboard allows an
   authorized administrator to view, filter, export, complete, or cancel
   appointments.
6. `/health` checks that the application and database are available. The
   frontend is served by FastAPI, while static files are loaded from `static/`
   and page templates from `templates/`.

The included `render.yaml` can be used to deploy the application on Render.
Render deployments must provide `GROQ_API_KEY`, `MEDICARE_ADMIN_EMAIL`, and
`MEDICARE_ADMIN_PASSWORD`. The free Render plan has an ephemeral filesystem,
so SQLite appointments can be lost when the service restarts or redeploys.

Set a Groq API key in PowerShell before starting the server to enable the
chatbot:

```powershell
$env:GROQ_API_KEY = "your-groq-api-key"
$env:GROQ_MODEL = "openai/gpt-oss-120b"
python -m uvicorn app.main:app --reload
```

Create an API key in the Groq Console and keep it in the server environment.
Never put the key in HTML or JavaScript, commit it to source control, or share
it in chat. The app defaults to `openai/gpt-oss-120b`; `GROQ_MODEL` can
select another Groq model that supports tool calling.

Open <http://127.0.0.1:8000>. The health endpoint is available at
<http://127.0.0.1:8000/health>.

Interactive API documentation is available at <http://127.0.0.1:8000/docs>.

## Backend features

- `GET /api/services` and `GET /api/doctors` return the demo clinic catalog.
- `GET /api/availability?date=YYYY-MM-DD&doctor_id=sarah-chen&period=afternoon`
  returns unbooked slots in India Standard Time.
- `POST /api/appointments` validates and stores a booking in SQLite. The
  response includes a demo booking token; no SMS or external notification is
  sent. Duplicate doctor/time bookings are rejected.
- `POST /api/triage` returns conservative, rule-based clinic-routing
  suggestions. Submitted symptom text is not stored. It is not a diagnosis or
  medical advice.
- `POST /api/chat` sends the current conversation to Groq. The assistant can
  call server-side tools for services, doctors, and live appointment
  availability. It checks availability before returning a suggested slot;
  visitors still complete bookings through the appointment form.
- `GET /api/admin/appointments` lists appointments with optional `date`,
  `doctor_id`, and `status` filters. `PATCH
  /api/admin/appointments/{id}/status` marks an appointment completed or
  cancelled, and `GET /api/admin/appointments.csv` exports the filtered list.
  These endpoints require a bearer token from `POST /api/admin/login`.
- `GET /health` checks the application and database.

The SQLite database is created at `data/medicare.db` by default. Set
`MEDICARE_DATABASE_PATH` to use a different local database file.

For local demo use, open **Admin Login** and sign in with
`admin@example.com` / `DemoAdminPassword2026!`. Successful login opens the
dedicated `/admin` page. The admin page validates the session, provides a
logout button, and redirects unauthenticated visitors back to `/`. Production
deployments must override these with `MEDICARE_ADMIN_EMAIL`,
`MEDICARE_ADMIN_PASSWORD`, and `MEDICARE_ADMIN_SECRET`. Use a long random
secret and HTTPS before deployment.

## Important limitations

This is a local demonstration, not a production medical records system. It
has no patient authentication, access controls for shared hosting, SMS
delivery, medical data integrations, clinical decision support, or emergency
dispatch. Chat messages are sent to Groq to generate replies and are not saved
in this application's database; provider handling is subject to Groq's terms
and settings. Do not send sensitive personal or health information. The
chatbot is for clinic information and booking only, not diagnosis or treatment
advice. Appointment name, phone number, and optional notes are stored
unencrypted in the local SQLite database. Do not use real patient information
or deploy this as a real clinic service. Add appropriate privacy, security,
operational, and clinical review before production use. Clinic address, map
location, and service prices shown on the page are illustrative. For
emergencies in India, call 112 or go to the nearest emergency department.

The page loads Bootstrap, Bootstrap Icons, fonts, and the map from public
services, so an internet connection is required for those assets.
