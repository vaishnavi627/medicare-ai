import logging
import json
import os
import re
import sqlite3
import uuid
import csv
import io
import base64
import hashlib
import hmac
import secrets
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterator, Literal

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, field_validator


BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(os.environ.get("MEDICARE_DATABASE_PATH", BASE_DIR / "data" / "medicare.db"))
INDIA_TZ = timezone(timedelta(hours=5, minutes=30), "IST")

SPECIALTIES = [
    "Cardiology Screening",
    "General Consultation",
    "Dental & Oral Care",
    "Preventive Health Checkups",
    "Pediatrics",
    "Telehealth & AI Diagnostics",
]

DOCTORS = [
    {
        "id": "sarah-chen",
        "name": "Dr. Sarah Chen (Chief Cardiologist)",
        "specialty": "Cardiology Screening",
    },
    {
        "id": "marcus-vance",
        "name": "Dr. Marcus Vance (General Med Lead)",
        "specialty": "General Consultation",
        "specialties": [
            "General Consultation",
            "Preventive Health Checkups",
            "Telehealth & AI Diagnostics",
        ],
    },
    {
        "id": "elena-rostova",
        "name": "Dr. Elena Rostova (Pediatric Specialist)",
        "specialty": "Pediatrics",
    },
    {
        "id": "james-wilson",
        "name": "Dr. James Wilson (Oral Surgeon)",
        "specialty": "Dental & Oral Care",
    },
]

SCHEDULE = {
    "morning": ["08:30", "09:00", "09:30", "10:00", "10:30", "11:00"],
    "afternoon": ["12:00", "13:30", "14:30", "15:15", "16:00", "16:45"],
    "evening": ["17:00", "17:30"],
}
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
CLINIC_HOURS = {
    "virtual consultations": "06:00–23:00 IST (illustrative demo hours)",
    "outpatient suite": "08:00–18:00 IST (illustrative demo hours)",
    "diagnostics lab": "07:00–20:00 IST (illustrative demo hours)",
}

app = FastAPI(
    title="MediCare AI Clinic API",
    description="Demo clinic API. Not for production medical care or emergency use.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")
logger = logging.getLogger(__name__)
ADMIN_TOKEN_TTL = 60 * 60 * 8
DEMO_ADMIN_EMAIL = "admin@example.com"
DEMO_ADMIN_PASSWORD = "DemoAdminPassword2026!"


def _admin_secret() -> bytes:
    configured = os.environ.get("MEDICARE_ADMIN_SECRET")
    if not configured:
        configured = os.environ.get("MEDICARE_ADMIN_PASSWORD", "")
    if not configured:
        configured = "change-this-admin-secret-before-deployment"
    return hashlib.sha256(configured.encode("utf-8")).digest()


def _admin_token(email: str) -> str:
    expires = int(datetime.now(timezone.utc).timestamp()) + ADMIN_TOKEN_TTL
    payload = f"{email}|{expires}".encode("utf-8")
    signature = hmac.new(_admin_secret(), payload, hashlib.sha256).digest()
    return f"{base64.urlsafe_b64encode(payload).decode().rstrip('=')}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def require_admin(request: Request) -> str:
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin login required")
    try:
        encoded_payload, encoded_signature = authorization[7:].split(".", 1)
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = hmac.new(_admin_secret(), payload, hashlib.sha256).digest()
        email, expires_text = payload.decode("utf-8").split("|", 1)
        if not hmac.compare_digest(signature, expected) or int(expires_text) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("Invalid or expired token")
    except (ValueError, TypeError, UnicodeDecodeError):
        raise HTTPException(status_code=401, detail="Invalid or expired admin session")
    return email


@app.exception_handler(sqlite3.Error)
async def handle_database_error(request: Request, exc: sqlite3.Error):
    logger.exception("Database operation failed")
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Database operation failed"},
    )


@contextmanager
def database() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS appointments (
                id TEXT PRIMARY KEY,
                patient_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                specialty TEXT NOT NULL,
                doctor_id TEXT NOT NULL,
                appointment_date TEXT NOT NULL,
                appointment_time TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'demo_confirmed',
                created_at TEXT NOT NULL,
                UNIQUE (doctor_id, appointment_date, appointment_time)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS appointments_date_doctor
            ON appointments (appointment_date, doctor_id)
            """
        )


@app.on_event("startup")
def startup() -> None:
    initialize_database()


@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"clinic_name": "MediCare AI Clinic"},
    )


@app.get("/admin")
async def admin_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="admin.html",
        context={"clinic_name": "MediCare AI Clinic"},
    )


@app.get("/health")
async def health_check():
    try:
        with database() as connection:
            connection.execute("SELECT 1").fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "healthy", "database": "connected"}


class AdminLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


@app.post("/api/admin/login")
async def admin_login(payload: AdminLoginRequest):
    configured_email = os.environ.get("MEDICARE_ADMIN_EMAIL", DEMO_ADMIN_EMAIL).strip().casefold()
    configured_password = os.environ.get("MEDICARE_ADMIN_PASSWORD", DEMO_ADMIN_PASSWORD)
    if not hmac.compare_digest(payload.email.strip().casefold(), configured_email) or not hmac.compare_digest(
        payload.password, configured_password
    ):
        raise HTTPException(status_code=401, detail="Invalid admin email or password")
    return {
        "access_token": _admin_token(configured_email),
        "token_type": "bearer",
        "expires_in": ADMIN_TOKEN_TTL,
    }


@app.get("/api/admin/session")
async def admin_session(request: Request):
    return {"email": require_admin(request)}


@app.get("/api/chat/status")
async def chat_status():
    return {
        "configured": bool(os.environ.get("GROQ_API_KEY")),
        "provider": "Groq",
        "model": GROQ_MODEL,
    }


@app.get("/api/services")
async def list_services():
    return [
        {
            "name": specialty,
            "doctors": [
                doctor["id"]
                for doctor in DOCTORS
                if specialty in doctor.get("specialties", [doctor["specialty"]])
            ],
        }
        for specialty in SPECIALTIES
    ]


@app.get("/api/doctors")
async def list_doctors(specialty: str | None = None):
    if specialty is not None and specialty not in SPECIALTIES:
        raise HTTPException(status_code=422, detail="Unknown specialty")
    return [
        doctor for doctor in DOCTORS
        if specialty is None or specialty in doctor.get("specialties", [doctor["specialty"]])
    ]


def parse_appointment_date(value: str) -> date:
    try:
        appointment_date = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Date must use YYYY-MM-DD format") from exc
    today = datetime.now(INDIA_TZ).date()
    if appointment_date < today or appointment_date > today + timedelta(days=365):
        raise HTTPException(status_code=422, detail="Choose a date from today through the next 365 days")
    return appointment_date


def available_times(appointment_date: date, doctor_id: str, period: str) -> list[str]:
    doctor = next((item for item in DOCTORS if item["id"] == doctor_id), None)
    if doctor is None:
        raise HTTPException(status_code=422, detail="Unknown doctor")
    if period not in SCHEDULE:
        raise HTTPException(status_code=422, detail="Period must be morning, afternoon, or evening")

    with database() as connection:
        rows = connection.execute(
            """
            SELECT appointment_time FROM appointments
            WHERE appointment_date = ? AND doctor_id = ? AND status = 'demo_confirmed'
            """,
            (appointment_date.isoformat(), doctor_id),
        ).fetchall()
    booked = {row["appointment_time"] for row in rows}
    times = SCHEDULE[period]
    if appointment_date == datetime.now(INDIA_TZ).date():
        now = datetime.now(INDIA_TZ).time()
        times = [
            slot for slot in times
            if datetime.strptime(slot, "%H:%M").time() > now
        ]
    return [slot for slot in times if slot not in booked]


@app.get("/api/availability")
async def get_availability(
    appointment_date: str = Query(alias="date"),
    doctor_id: str = Query(),
    period: str = Query(default="afternoon"),
):
    parsed_date = parse_appointment_date(appointment_date)
    return {
        "date": parsed_date.isoformat(),
        "doctor_id": doctor_id,
        "period": period,
        "slots": available_times(parsed_date, doctor_id, period),
        "timezone": "Asia/Kolkata",
    }


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)

    @field_validator("content")
    @classmethod
    def trim_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be empty")
        return value


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=12)

    @field_validator("messages")
    @classmethod
    def end_with_user_message(cls, value: list[ChatMessage]) -> list[ChatMessage]:
        if value[-1].role != "user":
            raise ValueError("The last message must be from the user")
        return value


CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_services",
            "description": "Get the clinic's configured services and their doctor IDs.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_doctors",
            "description": "Get clinic doctor names and specialties, optionally filtered by exact specialty.",
            "parameters": {
                "type": "object",
                "properties": {
                    "specialty": {
                        "type": ["string", "null"],
                        "enum": [*SPECIALTIES, None],
                        "description": "Optional exact specialty filter; use null to list all doctors.",
                    }
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_availability",
            "description": (
                "Check live appointment slots before telling the user that a time is available. "
                "Use the doctor ID, a YYYY-MM-DD date, and a schedule period."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_date": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                    "doctor_id": {"type": "string", "enum": [doctor["id"] for doctor in DOCTORS]},
                    "specialty": {"type": "string", "enum": SPECIALTIES},
                    "period": {"type": "string", "enum": list(SCHEDULE)},
                },
                "required": ["appointment_date", "doctor_id", "specialty", "period"],
                "additionalProperties": False,
            },
        },
    },
]


def chat_system_prompt() -> str:
    today = datetime.now(INDIA_TZ).date().isoformat()
    doctors = [
        {
            "id": doctor["id"],
            "name": doctor["name"],
            "specialties": doctor.get("specialties", [doctor["specialty"]]),
        }
        for doctor in DOCTORS
    ]
    return (
        "You are the MediCare AI Clinic website assistant. Help visitors with clinic "
        "services, doctors, illustrative hours, and the steps to request an appointment. "
        "Be concise, warm, and ask one clear follow-up question at a time when needed. "
        "Only state clinic facts present in this prompt or returned by tools; say when "
        "information is unavailable. The hours and schedule are illustrative demo data, "
        "not verified real clinic operations. "
        "For appointment guidance, collect the service/specialty, doctor preference if "
        "any, date, and preferred period. Use check_availability before suggesting any "
        "specific appointment time. Never invent, assume, or reuse stale availability. "
        "If no matching slots are returned, explain that and ask about another date or "
        "period. A slot suggestion is not a booking; direct the visitor to the booking "
        "form to complete the request. Do not book or claim a booking is confirmed. "
        "Do not provide diagnosis, treatment, medication, or symptom-triage advice. "
        "For emergencies in India, tell the user to call 112 or go to an emergency "
        "department now. Avoid requesting or repeating sensitive health or identity "
        "details. User messages are sent to Groq to generate a reply; do not claim they "
        "are private or not retained by the provider. "
        f"Today's date in India is {today}. "
        f"Configured doctors: {json.dumps(doctors)}. "
        f"Illustrative clinic hours: {json.dumps(CLINIC_HOURS)}. "
        "Appointments may be requested from today through the next 365 days, subject "
        "to live availability. Available periods are morning (08:30–11:00), afternoon "
        "(12:00–16:45), and evening (17:00–17:30), India Standard Time."
    )


async def execute_chat_tool(name: str, arguments: dict) -> tuple[dict, dict | None]:
    if name == "get_services":
        return await list_services(), None
    if name == "get_doctors":
        specialty = arguments.get("specialty")
        if specialty is not None and specialty not in SPECIALTIES:
            return {"error": "Unknown specialty"}, None
        return await list_doctors(specialty), None
    if name == "check_availability":
        try:
            appointment_date = parse_appointment_date(arguments["appointment_date"])
            doctor_id = arguments["doctor_id"]
            specialty = arguments["specialty"]
            period = arguments["period"]
            doctor = next((item for item in DOCTORS if item["id"] == doctor_id), None)
            if doctor is None:
                raise HTTPException(status_code=422, detail="Unknown doctor")
            if specialty not in doctor.get("specialties", [doctor["specialty"]]):
                raise HTTPException(status_code=422, detail="Doctor does not provide this specialty")
            slots = available_times(appointment_date, doctor_id, period)
        except (KeyError, HTTPException, TypeError) as exc:
            message = exc.detail if isinstance(exc, HTTPException) else "Invalid availability request"
            return {"error": message}, None
        result = {
            "date": appointment_date.isoformat(),
            "doctor_id": doctor_id,
            "doctor": doctor["name"],
            "specialty": specialty,
            "period": period,
            "timezone": "Asia/Kolkata",
            "slots": slots,
        }
        suggestion = None
        if slots:
            suggestion = {
                "date": appointment_date.isoformat(),
                "time": slots[0],
                "doctor_id": doctor_id,
                "doctor": doctor["name"],
                "specialty": specialty,
            }
        return result, suggestion
    return {"error": "Unsupported tool"}, None


@app.post("/api/chat")
async def clinic_chat(payload: ChatRequest):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chatbot is not configured. Set the GROQ_API_KEY environment variable and restart the server.",
        )

    messages = [
        {"role": "system", "content": chat_system_prompt()},
        *[message.model_dump() for message in payload.messages],
    ]
    latest_suggestion = None
    request_body = {
        "model": GROQ_MODEL,
        "messages": messages,
        "tools": CHAT_TOOLS,
        "tool_choice": "auto",
        "temperature": 0.2,
        "max_tokens": 700,
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for _ in range(4):
                response = await client.post(
                    GROQ_API_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=request_body,
                )
                response.raise_for_status()
                result = response.json()
                choice = result["choices"][0]["message"]
                tool_calls = choice.get("tool_calls") or []
                if not tool_calls:
                    reply = choice.get("content")
                    if not isinstance(reply, str) or not reply.strip():
                        raise HTTPException(status_code=502, detail="The AI returned an empty response")
                    return {
                        "reply": reply.strip(),
                        "booking_suggestion": latest_suggestion,
                        "model": GROQ_MODEL,
                    }

                messages.append(choice)
                for tool_call in tool_calls:
                    function = tool_call.get("function", {})
                    tool_name = function.get("name")
                    try:
                        arguments = json.loads(function.get("arguments", "{}"))
                    except (TypeError, json.JSONDecodeError):
                        arguments = {}
                    if not isinstance(arguments, dict):
                        arguments = {}
                    tool_result, suggestion = await execute_chat_tool(tool_name, arguments)
                    if tool_name == "check_availability":
                        latest_suggestion = suggestion
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.get("id", ""),
                            "content": json.dumps(tool_result),
                        }
                    )
                request_body["messages"] = messages
    except httpx.TimeoutException as exc:
        logger.warning("Groq chat request timed out")
        raise HTTPException(status_code=504, detail="The chatbot timed out. Please try again.") from exc
    except httpx.HTTPStatusError as exc:
        try:
            provider_error = exc.response.json().get("error", {}).get("message", "")
        except (ValueError, AttributeError):
            provider_error = ""
        logger.warning(
            "Groq chat request failed with status %s for model %s: %s",
            exc.response.status_code,
            GROQ_MODEL,
            provider_error[:500],
        )
        raise HTTPException(status_code=502, detail="The chatbot provider could not complete the request.") from exc
    except httpx.HTTPError as exc:
        logger.exception("Groq chat provider request failed")
        raise HTTPException(status_code=502, detail="Could not connect to the chatbot provider.") from exc
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        logger.exception("Unexpected Groq chat response")
        raise HTTPException(status_code=502, detail="The chatbot provider returned an invalid response.") from exc

    raise HTTPException(status_code=502, detail="The chatbot could not complete its availability lookup.")


class AppointmentRequest(BaseModel):
    patient_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=8, max_length=20)
    specialty: str
    doctor_id: str
    appointment_date: str
    appointment_time: str
    notes: str = Field(default="", max_length=2000)

    @field_validator("patient_name", "specialty", "doctor_id", "appointment_date", "appointment_time")
    @classmethod
    def strip_required_strings(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be empty")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"\+?[0-9][0-9 ()-]{6,18}[0-9]", value):
            raise ValueError("Enter a valid phone number")
        digits = re.sub(r"\D", "", value)
        if not 8 <= len(digits) <= 15:
            raise ValueError("Enter a valid phone number")
        return value

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: str) -> str:
        return value.strip()


class RescheduleRequest(BaseModel):
    appointment_date: str
    appointment_time: str

    @field_validator("appointment_date", "appointment_time")
    @classmethod
    def strip_schedule_values(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be empty")
        return value


def appointment_token(appointment_id: str) -> str:
    return f"MC-{appointment_id[:8].upper()}"


def appointment_from_row(row: sqlite3.Row) -> dict:
    doctor = next((item for item in DOCTORS if item["id"] == row["doctor_id"]), None)
    return {
        "id": row["id"],
        "token": appointment_token(row["id"]),
        "patient_name": row["patient_name"],
        "phone": row["phone"],
        "specialty": row["specialty"],
        "doctor": doctor["name"] if doctor else row["doctor_id"],
        "doctor_id": row["doctor_id"],
        "appointment_date": row["appointment_date"],
        "appointment_time": row["appointment_time"],
        "timezone": "Asia/Kolkata",
        "status": row["status"],
        "created_at": row["created_at"],
    }


class AdminStatusRequest(BaseModel):
    status: Literal["demo_confirmed", "completed", "cancelled"]


def admin_appointment_rows(
    appointment_date: str | None,
    doctor_id: str | None,
    appointment_status: str | None,
) -> list[dict]:
    clauses = []
    values: list[str] = []
    if appointment_date:
        clauses.append("appointment_date = ?")
        values.append(appointment_date)
    if doctor_id:
        clauses.append("doctor_id = ?")
        values.append(doctor_id)
    if appointment_status:
        if appointment_status not in {"demo_confirmed", "completed", "cancelled"}:
            raise HTTPException(status_code=422, detail="Unknown appointment status")
        clauses.append("status = ?")
        values.append(appointment_status)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with database() as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM appointments
            {where}
            ORDER BY appointment_date ASC, appointment_time ASC
            """,
            values,
        ).fetchall()
    return [appointment_from_row(row) for row in rows]


@app.get("/api/admin/appointments")
async def admin_appointments(
    request: Request,
    appointment_date: str | None = Query(default=None, alias="date"),
    doctor_id: str | None = Query(default=None),
    appointment_status: str | None = Query(default=None, alias="status"),
):
    require_admin(request)
    return admin_appointment_rows(appointment_date, doctor_id, appointment_status)


@app.patch("/api/admin/appointments/{appointment_id}/status")
async def update_admin_appointment_status(
    appointment_id: str,
    request: Request,
    payload: AdminStatusRequest,
):
    require_admin(request)
    with database() as connection:
        cursor = connection.execute(
            "UPDATE appointments SET status = ? WHERE id = ?",
            (payload.status, appointment_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Appointment not found")
    row = get_appointment(appointment_token(appointment_id))
    return {
        **appointment_from_row(row),
        "confirmation": f"Appointment marked {payload.status.replace('_', ' ')}.",
    }


@app.get("/api/admin/appointments.csv")
async def export_admin_appointments(
    request: Request,
    appointment_date: str | None = Query(default=None, alias="date"),
    doctor_id: str | None = Query(default=None),
    appointment_status: str | None = Query(default=None, alias="status"),
):
    require_admin(request)
    appointments = admin_appointment_rows(appointment_date, doctor_id, appointment_status)
    output = io.StringIO()
    fields = [
        "token",
        "patient_name",
        "phone",
        "specialty",
        "doctor",
        "appointment_date",
        "appointment_time",
        "status",
    ]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows({field: appointment.get(field, "") for field in fields} for appointment in appointments)
    return PlainTextResponse(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=appointments.csv"},
    )



def appointment_id_from_token(token: str) -> str:
    normalized = token.strip().upper()
    if not re.fullmatch(r"MC-[0-9A-F]{8}", normalized):
        raise HTTPException(status_code=404, detail="Appointment token was not found")
    return normalized[3:].lower()


def get_appointment(token: str) -> sqlite3.Row:
    token_prefix = appointment_id_from_token(token)
    with database() as connection:
        row = connection.execute(
            "SELECT * FROM appointments WHERE lower(substr(id, 1, 8)) = ?",
            (token_prefix,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Appointment token was not found")
    return row


def validate_appointment_slot(appointment_date_value: str, appointment_time_value: str) -> tuple[date, str]:
    appointment_date = parse_appointment_date(appointment_date_value)
    try:
        appointment_time = datetime.strptime(appointment_time_value, "%H:%M").time()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Time must use HH:MM format") from exc
    period = "morning" if appointment_time < time(12) else "afternoon" if appointment_time < time(17) else "evening"
    if appointment_time_value not in SCHEDULE[period]:
        raise HTTPException(status_code=422, detail="This appointment time is not available")
    return appointment_date, period


@app.post("/api/appointments", status_code=status.HTTP_201_CREATED)
async def create_appointment(payload: AppointmentRequest):
    doctor = next((item for item in DOCTORS if item["id"] == payload.doctor_id), None)
    if doctor is None:
        raise HTTPException(status_code=422, detail="Unknown doctor")
    if payload.specialty not in SPECIALTIES or payload.specialty not in doctor.get("specialties", [doctor["specialty"]]):
        raise HTTPException(status_code=422, detail="The selected doctor does not provide this specialty")

    appointment_date, period = validate_appointment_slot(payload.appointment_date, payload.appointment_time)
    if payload.appointment_time not in available_times(appointment_date, payload.doctor_id, period):
        raise HTTPException(status_code=409, detail="That appointment slot is no longer available")

    appointment_id = str(uuid.uuid4())
    created_at = datetime.now(INDIA_TZ).isoformat(timespec="seconds")
    try:
        with database() as connection:
            connection.execute(
                """
                INSERT INTO appointments (
                    id, patient_name, phone, specialty, doctor_id,
                    appointment_date, appointment_time, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    appointment_id,
                    payload.patient_name,
                    payload.phone,
                    payload.specialty,
                    payload.doctor_id,
                    appointment_date.isoformat(),
                    payload.appointment_time,
                    payload.notes,
                    created_at,
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="That appointment slot was just booked") from exc
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="Could not save the appointment") from exc

    return {
        "id": appointment_id,
        "token": appointment_token(appointment_id),
        "patient_name": payload.patient_name,
        "phone": payload.phone,
        "specialty": payload.specialty,
        "doctor": doctor["name"],
        "doctor_id": doctor["id"],
        "appointment_date": appointment_date.isoformat(),
        "appointment_time": payload.appointment_time,
        "timezone": "Asia/Kolkata",
        "status": "demo_confirmed",
        "confirmation": "Demo booking saved locally. No SMS was sent.",
    }


@app.get("/api/appointments/{token}")
async def lookup_appointment(token: str):
    return appointment_from_row(get_appointment(token))


@app.delete("/api/appointments/{token}")
async def cancel_appointment(token: str):
    row = get_appointment(token)
    if row["status"] != "demo_confirmed":
        raise HTTPException(status_code=409, detail="This appointment is already cancelled")
    with database() as connection:
        connection.execute(
            "UPDATE appointments SET status = 'cancelled' WHERE id = ?",
            (row["id"],),
        )
    updated = get_appointment(token)
    return {**appointment_from_row(updated), "confirmation": "Appointment cancelled locally. No notification was sent."}


@app.patch("/api/appointments/{token}")
async def reschedule_appointment(token: str, payload: RescheduleRequest):
    row = get_appointment(token)
    if row["status"] != "demo_confirmed":
        raise HTTPException(status_code=409, detail="Only active appointments can be rescheduled")
    appointment_date, period = validate_appointment_slot(payload.appointment_date, payload.appointment_time)
    with database() as connection:
        existing = connection.execute(
            """
            SELECT 1 FROM appointments
            WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ?
              AND status = 'demo_confirmed' AND id != ?
            """,
            (row["doctor_id"], appointment_date.isoformat(), payload.appointment_time, row["id"]),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="That appointment slot is no longer available")
        if appointment_date == datetime.now(INDIA_TZ).date():
            now = datetime.now(INDIA_TZ).time()
            if datetime.strptime(payload.appointment_time, "%H:%M").time() <= now:
                raise HTTPException(status_code=409, detail="That appointment time has already passed")
        try:
            connection.execute(
                """
                UPDATE appointments
                SET appointment_date = ?, appointment_time = ?
                WHERE id = ?
                """,
                (appointment_date.isoformat(), payload.appointment_time, row["id"]),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="That appointment slot was just booked") from exc
    updated = get_appointment(token)
    return {**appointment_from_row(updated), "confirmation": "Appointment rescheduled locally. No notification was sent."}


class TriageRequest(BaseModel):
    symptoms: str = Field(min_length=3, max_length=1000)

    @field_validator("symptoms")
    @classmethod
    def strip_symptoms(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Please describe your symptoms")
        return value


@app.post("/api/triage")
async def triage(payload: TriageRequest):
    text = payload.symptoms.casefold()
    emergency_terms = (
        "severe chest pain", "crushing chest", "difficulty breathing",
        "can't breathe", "cannot breathe", "shortness of breath",
        "face droop", "one-sided weakness", "slurred speech",
        "unconscious", "not waking", "heavy bleeding", "seizure",
    )
    emergency = any(term in text for term in emergency_terms)
    if emergency:
        specialty = None
        recommendation = (
            "This description may indicate an emergency. Call 112 in India or go to "
            "the nearest emergency department now. Do not wait for an appointment."
        )
    elif any(term in text for term in ("tooth", "teeth", "gum", "jaw pain")):
        specialty = "Dental & Oral Care"
        recommendation = "A dental consultation may be a relevant next step."
    elif any(term in text for term in ("child", "toddler", "baby", "infant", "pediatric")):
        specialty = "Pediatrics"
        recommendation = "A pediatric consultation may be a relevant next step."
    elif any(term in text for term in ("chest", "heart", "palpitation")):
        specialty = "Cardiology Screening"
        recommendation = "Consider contacting a qualified clinician promptly about these symptoms."
    else:
        specialty = "General Consultation"
        recommendation = "A general consultation may be a reasonable starting point."

    doctor = next((item for item in DOCTORS if item["specialty"] == specialty), None)
    return {
        "emergency": emergency,
        "specialty": specialty,
        "doctor_id": doctor["id"] if doctor else None,
        "doctor": doctor["name"] if doctor else None,
        "recommendation": recommendation,
        "disclaimer": (
            "Automated guidance only; this is not a diagnosis or medical advice. "
            "A qualified healthcare professional should assess your symptoms."
        ),
        "symptoms_stored": False,
    }
