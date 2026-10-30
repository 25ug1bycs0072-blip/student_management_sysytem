import unittest

from app import create_app, db


class StudentApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(
            {
                "TESTING": True,
                "SQLALCHEMY_DATABASE_URI": "sqlite://",
                "SQLALCHEMY_ENGINE_OPTIONS": {},
            }
        )
        self.context = self.app.app_context()
        self.context.push()
        db.drop_all()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def payload(self, **overrides):
        data = {
            "full_name": "Avery Johnson",
            "email": "avery@example.edu",
            "phone": "+1 555 0100",
            "course": "Computer Science",
            "year": 2,
            "status": "Active",
            "enrollment_date": "2025-09-01",
        }
        data.update(overrides)
        return data

    def test_student_crud_and_dashboard(self):
        created = self.client.post("/api/students", json=self.payload())
        self.assertEqual(created.status_code, 201)
        student = created.get_json()
        self.assertEqual(student["email"], "avery@example.edu")
        self.assertEqual(self.client.get("/api/students/1").status_code, 200)

        updated = self.client.put(
            "/api/students/1", json=self.payload(full_name="Avery Jones", status="Inactive")
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["full_name"], "Avery Jones")

        dashboard = self.client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["total_students"], 1)
        self.assertEqual(dashboard["inactive_students"], 1)
        self.assertEqual(dashboard["courses"], [{"name": "Computer Science", "count": 1}])

        deleted = self.client.delete("/api/students/1")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/students/1").status_code, 404)

    def test_search_filters_and_duplicate_email(self):
        self.client.post("/api/students", json=self.payload())
        second = self.payload(
            full_name="Jordan Lee",
            email="jordan@example.edu",
            course="Mathematics",
            status="Inactive",
        )
        self.client.post("/api/students", json=second)
        self.assertEqual(len(self.client.get("/api/students?search=jordan").get_json()), 1)
        self.assertEqual(len(self.client.get("/api/students?course=Mathematics").get_json()), 1)
        self.assertEqual(len(self.client.get("/api/students?status=Active").get_json()), 1)
        self.assertEqual(self.client.post("/api/students", json=self.payload()).status_code, 409)

    def test_validation_and_health(self):
        self.assertEqual(self.client.get("/api/health").get_json(), {"status": "ok"})
        self.assertEqual(self.client.get("/").status_code, 200)
        static_response = self.client.get("/static/app.js")
        self.assertEqual(static_response.status_code, 200)
        static_response.close()
        invalid = self.client.post("/api/students", json=self.payload(email="not-an-email"))
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("valid email", invalid.get_json()["error"])
        fractional_year = self.client.post("/api/students", json=self.payload(year=1.5))
        self.assertEqual(fractional_year.status_code, 400)
        invalid_date = self.client.post(
            "/api/students", json=self.payload(enrollment_date="20250901")
        )
        self.assertEqual(invalid_date.status_code, 400)
        self.assertEqual(self.client.delete("/api/students/999").status_code, 404)

    def test_attendance_and_grade_workflows(self):
        created_student = self.client.post("/api/students", json=self.payload())
        student_id = created_student.get_json()["id"]

        attendance_payload = {
            "date": "2025-10-12",
            "records": [{"student_id": student_id, "status": "Present"}],
        }
        marked = self.client.put("/api/attendance", json=attendance_payload)
        self.assertEqual(marked.status_code, 200)
        roster = self.client.get("/api/attendance?date=2025-10-12").get_json()
        self.assertEqual(roster[0]["status"], "Present")

        attendance_payload["records"][0]["status"] = "Late"
        self.assertEqual(self.client.put("/api/attendance", json=attendance_payload).status_code, 200)
        roster = self.client.get("/api/attendance?date=2025-10-12").get_json()
        self.assertEqual(roster[0]["status"], "Late")
        self.assertEqual(
            self.client.put(
                "/api/attendance",
                json={"date": "2025-10-12", "records": [{"student_id": student_id, "status": []}]},
            ).status_code,
            400,
        )

        grade_payload = {
            "student_id": student_id,
            "assessment": "Midterm",
            "score": 87.5,
            "assessed_on": "2025-10-10",
        }
        created_grade = self.client.post("/api/grades", json=grade_payload)
        self.assertEqual(created_grade.status_code, 201)
        grade_id = created_grade.get_json()["id"]
        self.assertEqual(self.client.get("/api/grades?search=midterm").get_json()[0]["score"], 87.5)

        grade_payload["score"] = 91
        self.assertEqual(
            self.client.put(f"/api/grades/{grade_id}", json=grade_payload).get_json()["score"],
            91,
        )
        self.assertEqual(
            self.client.post("/api/grades", json={**grade_payload, "score": 101}).status_code,
            400,
        )
        self.assertEqual(self.client.delete(f"/api/grades/{grade_id}").status_code, 200)

        self.assertEqual(self.client.delete(f"/api/students/{student_id}").status_code, 200)
        self.assertEqual(self.client.get("/api/attendance?date=2025-10-12").get_json(), [])


if __name__ == "__main__":
    unittest.main()
