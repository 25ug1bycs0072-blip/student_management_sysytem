# CampusDesk student management

A responsive student directory built with HTML, CSS, and vanilla JavaScript, backed by a Flask REST API and SQLAlchemy. It uses SQLite locally and can use PostgreSQL in a cloud deployment.

## Run locally

Requires Python 3.10 or newer.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). A local `instance/students.db` database is created automatically. The server listens on port 5000 (or the `PORT` environment variable).

## Features

- Dashboard totals for total, active, inactive, and course counts
- Student create, list, detail, update, and delete
- Search by name, email, and course; filter by course and status
- Sort by student name, confirm before delete, and export the current result set as CSV
- Take attendance by date and mark active students present, absent, or late
- Record, search, update, and delete grades; review the average score
- Input validation and duplicate-email conflict responses

## REST API

All endpoints return JSON except `GET /`, which serves the application.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/dashboard` | Dashboard summary and course counts |
| GET | `/api/attendance?date=YYYY-MM-DD` | Active student roster with attendance for the date |
| PUT | `/api/attendance` | Save attendance records for a date |
| GET | `/api/grades` | List grades; optional `student_id` and `search` filters |
| POST | `/api/grades` | Create a grade |
| PUT | `/api/grades/<id>` | Update a grade |
| DELETE | `/api/grades/<id>` | Delete a grade |
| GET | `/api/students` | List students |
| GET | `/api/students/<id>` | Get one student |
| POST | `/api/students` | Create a student |
| PUT | `/api/students/<id>` | Replace a student’s editable fields |
| DELETE | `/api/students/<id>` | Delete a student |

`GET /api/students` accepts optional `search`, `course`, and `status` query parameters. For POST and PUT, send JSON with `full_name`, `email`, `course`, and `year` (1–6); `phone`, `status` (`Active` or `Inactive`), and `enrollment_date` (`YYYY-MM-DD`) are optional.

Example request body:

```json
{
  "full_name": "Avery Johnson",
  "email": "avery@example.edu",
  "phone": "+1 555 0100",
  "course": "Computer Science",
  "year": 2,
  "status": "Active",
  "enrollment_date": "2025-09-01"
}
```

Attendance uses `PUT /api/attendance` with `{"date":"2025-10-12","records":[{"student_id":1,"status":"Present"}]}`. Status values are `Present`, `Absent`, or `Late`; saving again updates that student’s status for the same date.

Grade requests use `student_id`, `assessment`, `score` (0–100), and `assessed_on` (`YYYY-MM-DD`).

## Test with Postman

1. Import `postman_collection.json` into Postman.
2. Set its `baseUrl` collection variable to the running app URL (`http://127.0.0.1:5001` in this workspace, or `http://127.0.0.1:5000` when using the default port).
3. Run the requests in order. The create request stores its returned ID for the detail, update, and delete requests.
4. The collection includes health, list/search/filter, dashboard, student CRUD, attendance, and grade requests.

Validation errors return HTTP 400, an existing email returns 409, and missing records return 404. Import these endpoints into a Postman collection using the table above; the app does not require Postman at runtime.

## Cloud deployment

Use a managed PostgreSQL database for deployment. Set `DATABASE_URL` to the provider’s PostgreSQL connection URL in the deployment service’s environment variables; the app automatically adapts `postgres://` and `postgresql://` URLs to the psycopg driver. Install dependencies with `pip install -r requirements.txt` and start with `gunicorn app:app`. Keep the database URL private and use the provider’s TLS/SSL connection settings. SQLite remains the default for local development.

## Run tests

```powershell
python -m unittest discover -s tests -v
```
