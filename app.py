import os
import re
import math
from datetime import date
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import relationship

db = SQLAlchemy()

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
STATUSES = {"Active", "Inactive"}


class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), nullable=False, unique=True, index=True)
    phone = db.Column(db.String(40), nullable=False, default="")
    course = db.Column(db.String(100), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="Active")
    enrollment_date = db.Column(db.Date, nullable=False, default=date.today)
    attendance_records = relationship(
        "Attendance", back_populates="student", cascade="all, delete-orphan"
    )
    grades = relationship("Grade", back_populates="student", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "full_name": self.full_name,
            "email": self.email,
            "phone": self.phone,
            "course": self.course,
            "year": self.year,
            "status": self.status,
            "enrollment_date": self.enrollment_date.isoformat(),
        }


class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=False)
    attendance_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(10), nullable=False)
    student = relationship("Student", back_populates="attendance_records")
    __table_args__ = (
        UniqueConstraint("student_id", "attendance_date", name="uq_attendance_student_date"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "student_name": self.student.full_name,
            "course": self.student.course,
            "attendance_date": self.attendance_date.isoformat(),
            "status": self.status,
        }


class Grade(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=False)
    assessment = db.Column(db.String(120), nullable=False)
    score = db.Column(db.Float, nullable=False)
    assessed_on = db.Column(db.Date, nullable=False, default=date.today)
    student = relationship("Student", back_populates="grades")

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "student_name": self.student.full_name,
            "course": self.student.course,
            "assessment": self.assessment,
            "score": self.score,
            "assessed_on": self.assessed_on.isoformat(),
        }


def _iso_date(raw_date, field_name):
    try:
        if not isinstance(raw_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
            raise ValueError
        return date.fromisoformat(raw_date), None
    except (TypeError, ValueError):
        return None, {"error": f"{field_name} must use YYYY-MM-DD format."}


def _grade_values(payload):
    if not isinstance(payload, dict):
        return None, {"error": "Request body must be a JSON object."}
    assessment = str(payload.get("assessment", "")).strip()
    if not assessment:
        return None, {"error": "Assessment name is required."}
    if len(assessment) > 120:
        return None, {"error": "Assessment name cannot exceed 120 characters."}
    try:
        score = float(payload.get("score"))
    except (TypeError, ValueError):
        return None, {"error": "Score must be a number from 0 to 100."}
    if isinstance(payload.get("score"), bool) or not math.isfinite(score) or not 0 <= score <= 100:
        return None, {"error": "Score must be a number from 0 to 100."}
    assessed_on, error = _iso_date(payload.get("assessed_on"), "Assessment date")
    if error:
        return None, error
    raw_student_id = payload.get("student_id")
    if isinstance(raw_student_id, bool) or (
        isinstance(raw_student_id, float) and not raw_student_id.is_integer()
    ):
        return None, {"error": "Choose a valid student."}
    try:
        student_id = int(raw_student_id)
    except (TypeError, ValueError):
        return None, {"error": "Choose a valid student."}
    if student_id < 1:
        return None, {"error": "Choose a valid student."}
    return {
        "student_id": student_id,
        "assessment": assessment,
        "score": score,
        "assessed_on": assessed_on,
    }, None


def _database_uri():
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        if database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return database_url

    instance_dir = Path(__file__).resolve().parent / "instance"
    instance_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{instance_dir / 'students.db'}"


def _student_values(payload):
    if not isinstance(payload, dict):
        return None, {"error": "Request body must be a JSON object."}

    required = ("full_name", "email", "course", "year")
    values = {key: payload.get(key) for key in required}
    for key in required:
        if values[key] is None or str(values[key]).strip() == "":
            return None, {"error": f"{key.replace('_', ' ').capitalize()} is required."}

    name = str(values["full_name"]).strip()
    email = str(values["email"]).strip().lower()
    course = str(values["course"]).strip()
    if len(name) > 120 or len(email) > 255 or len(course) > 100:
        return None, {"error": "Name, email, or course exceeds the allowed length."}
    if not EMAIL_PATTERN.match(email):
        return None, {"error": "Enter a valid email address."}

    if isinstance(values["year"], bool) or (
        isinstance(values["year"], float) and not values["year"].is_integer()
    ):
        return None, {"error": "Year must be a whole number from 1 to 6."}
    try:
        year = int(values["year"])
    except (TypeError, ValueError):
        return None, {"error": "Year must be a whole number from 1 to 6."}
    if year < 1 or year > 6:
        return None, {"error": "Year must be a whole number from 1 to 6."}

    status = str(payload.get("status", "Active")).strip()
    if status not in STATUSES:
        return None, {"error": "Status must be Active or Inactive."}

    raw_date = payload.get("enrollment_date")
    try:
        if raw_date and (
            not isinstance(raw_date, str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date)
        ):
            raise ValueError
        enrollment_date = date.fromisoformat(raw_date) if raw_date else date.today()
    except (TypeError, ValueError):
        return None, {"error": "Enrollment date must use YYYY-MM-DD format."}

    phone = str(payload.get("phone", "")).strip()
    if len(phone) > 40:
        return None, {"error": "Phone number cannot exceed 40 characters."}

    return {
        "full_name": name,
        "email": email,
        "phone": phone,
        "course": course,
        "year": year,
        "status": status,
        "enrollment_date": enrollment_date,
    }, None


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI=_database_uri(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JSON_SORT_KEYS=False,
    )
    if test_config:
        app.config.update(test_config)
    db.init_app(app)

    with app.app_context():
        db.create_all()

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/students")
    def list_students():
        query = Student.query
        search = request.args.get("search", "").strip()
        department = request.args.get("course", "").strip()
        status = request.args.get("status", "").strip()
        if search:
            pattern = f"%{search}%"
            query = query.filter(
                db.or_(
                    Student.full_name.ilike(pattern),
                    Student.email.ilike(pattern),
                    Student.course.ilike(pattern),
                )
            )
        if department:
            query = query.filter(Student.course == department)
        if status:
            if status not in STATUSES:
                return jsonify({"error": "Status must be Active or Inactive."}), 400
            query = query.filter(Student.status == status)
        students = query.order_by(Student.full_name.asc()).all()
        return jsonify([student.to_dict() for student in students])

    @app.post("/api/students")
    def create_student():
        values, error = _student_values(request.get_json(silent=True))
        if error:
            return jsonify(error), 400
        student = Student(**values)
        db.session.add(student)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return jsonify({"error": "A student with this email already exists."}), 409
        return jsonify(student.to_dict()), 201

    @app.get("/api/students/<int:student_id>")
    def get_student(student_id):
        student = db.session.get(Student, student_id)
        if student is None:
            return jsonify({"error": "Student not found."}), 404
        return jsonify(student.to_dict())

    @app.put("/api/students/<int:student_id>")
    def update_student(student_id):
        student = db.session.get(Student, student_id)
        if student is None:
            return jsonify({"error": "Student not found."}), 404
        values, error = _student_values(request.get_json(silent=True))
        if error:
            return jsonify(error), 400
        for key, value in values.items():
            setattr(student, key, value)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return jsonify({"error": "A student with this email already exists."}), 409
        return jsonify(student.to_dict())

    @app.delete("/api/students/<int:student_id>")
    def delete_student(student_id):
        student = db.session.get(Student, student_id)
        if student is None:
            return jsonify({"error": "Student not found."}), 404
        db.session.delete(student)
        db.session.commit()
        return jsonify({"message": "Student deleted successfully."})

    @app.get("/api/attendance")
    def list_attendance():
        attendance_date, error = _iso_date(
            request.args.get("date", date.today().isoformat()), "Date"
        )
        if error:
            return jsonify(error), 400
        students = Student.query.filter_by(status="Active").order_by(Student.full_name).all()
        records = {
            record.student_id: record
            for record in Attendance.query.filter_by(attendance_date=attendance_date).all()
        }
        return jsonify(
            [
                {
                    "student_id": student.id,
                    "student_name": student.full_name,
                    "course": student.course,
                    "status": records[student.id].status if student.id in records else None,
                }
                for student in students
            ]
        )

    @app.put("/api/attendance")
    def save_attendance():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
            return jsonify({"error": "Request body must include a records array."}), 400
        attendance_date, error = _iso_date(payload.get("date"), "Date")
        if error:
            return jsonify(error), 400

        updates = {}
        for record in payload["records"]:
            if not isinstance(record, dict):
                return jsonify({"error": "Each attendance record must be an object."}), 400
            raw_student_id = record.get("student_id")
            if isinstance(raw_student_id, bool) or (
                isinstance(raw_student_id, float) and not raw_student_id.is_integer()
            ):
                return jsonify({"error": "Each record must have a valid student_id."}), 400
            try:
                student_id = int(raw_student_id)
            except (TypeError, ValueError):
                return jsonify({"error": "Each record must have a valid student_id."}), 400
            status = record.get("status")
            if (
                student_id < 1
                or not isinstance(status, str)
                or status not in {"Present", "Absent", "Late"}
            ):
                return jsonify({"error": "Attendance status must be Present, Absent, or Late."}), 400
            if student_id in updates:
                return jsonify({"error": "A student can only be marked once per date."}), 400
            updates[student_id] = status
        if not updates:
            return jsonify({"error": "Mark at least one student before saving attendance."}), 400

        found_ids = {
            student_id
            for (student_id,) in db.session.query(Student.id)
            .filter(Student.id.in_(updates))
            .all()
        }
        if found_ids != set(updates):
            return jsonify({"error": "One or more students could not be found."}), 404

        try:
            for student_id, status in updates.items():
                record = Attendance.query.filter_by(
                    student_id=student_id, attendance_date=attendance_date
                ).first()
                if record is None:
                    db.session.add(
                        Attendance(
                            student_id=student_id,
                            attendance_date=attendance_date,
                            status=status,
                        )
                    )
                else:
                    record.status = status
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return jsonify({"error": "Attendance could not be saved. Please try again."}), 409
        return jsonify({"message": f"Attendance saved for {len(updates)} student(s)."})

    @app.get("/api/grades")
    def list_grades():
        query = Grade.query.join(Student)
        student_id = request.args.get("student_id", type=int)
        if student_id is not None:
            query = query.filter(Grade.student_id == student_id)
        search = request.args.get("search", "").strip()
        if search:
            pattern = f"%{search}%"
            query = query.filter(
                db.or_(Student.full_name.ilike(pattern), Grade.assessment.ilike(pattern))
            )
        grades = query.order_by(Grade.assessed_on.desc(), Student.full_name.asc()).all()
        return jsonify([grade.to_dict() for grade in grades])

    @app.post("/api/grades")
    def create_grade():
        values, error = _grade_values(request.get_json(silent=True))
        if error:
            return jsonify(error), 400
        if db.session.get(Student, values["student_id"]) is None:
            return jsonify({"error": "Student not found."}), 404
        grade = Grade(**values)
        db.session.add(grade)
        db.session.commit()
        return jsonify(grade.to_dict()), 201

    @app.put("/api/grades/<int:grade_id>")
    def update_grade(grade_id):
        grade = db.session.get(Grade, grade_id)
        if grade is None:
            return jsonify({"error": "Grade not found."}), 404
        values, error = _grade_values(request.get_json(silent=True))
        if error:
            return jsonify(error), 400
        if db.session.get(Student, values["student_id"]) is None:
            return jsonify({"error": "Student not found."}), 404
        for key, value in values.items():
            setattr(grade, key, value)
        db.session.commit()
        return jsonify(grade.to_dict())

    @app.delete("/api/grades/<int:grade_id>")
    def delete_grade(grade_id):
        grade = db.session.get(Grade, grade_id)
        if grade is None:
            return jsonify({"error": "Grade not found."}), 404
        db.session.delete(grade)
        db.session.commit()
        return jsonify({"message": "Grade deleted successfully."})

    @app.get("/api/dashboard")
    def dashboard():
        total = db.session.query(func.count(Student.id)).scalar() or 0
        active = db.session.query(func.count(Student.id)).filter_by(status="Active").scalar() or 0
        courses = (
            db.session.query(Student.course, func.count(Student.id))
            .group_by(Student.course)
            .order_by(Student.course.asc())
            .all()
        )
        return jsonify(
            {
                "total_students": total,
                "active_students": active,
                "inactive_students": total - active,
                "courses": [{"name": name, "count": count} for name, count in courses],
            }
        )

    @app.errorhandler(404)
    def not_found(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Resource not found."}), 404
        return error

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
