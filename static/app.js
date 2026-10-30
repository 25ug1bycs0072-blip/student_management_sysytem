(() => {
  "use strict";

  const rows = document.getElementById("student-rows");
  const searchInput = document.getElementById("search-input");
  const courseFilter = document.getElementById("course-filter");
  const statusFilter = document.getElementById("status-filter");
  const studentModal = document.getElementById("student-modal");
  const detailModal = document.getElementById("detail-modal");
  const gradeModal = document.getElementById("grade-modal");
  const studentForm = document.getElementById("student-form");
  const attendanceRows = document.getElementById("attendance-rows");
  const gradeRows = document.getElementById("grade-rows");
  const gradeForm = document.getElementById("grade-form");
  let students = [];
  let grades = [];
  let gradeStudents = [];
  let editingId = null;
  let editingGradeId = null;
  let viewingId = null;
  let sortAscending = true;
  let searchTimer;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    document.getElementById("toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  }

  function localDateValue() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  }

  function renderStudents() {
    const sorted = [...students].sort((a, b) => {
      const compared = a.full_name.localeCompare(b.full_name);
      return sortAscending ? compared : -compared;
    });
    document.getElementById("nav-count").textContent = String(students.length);
    document.getElementById("results-label").textContent = `Showing ${students.length} student${students.length === 1 ? "" : "s"}`;
    if (!sorted.length) {
      rows.innerHTML = `<tr><td class="empty-cell" colspan="6"><strong>No students found</strong><span>Try changing your filters or add a new student record.</span></td></tr>`;
      return;
    }
    rows.innerHTML = sorted.map((student, index) => {
      const statusClass = student.status === "Active" ? "" : " inactive";
      const enrolled = new Date(`${student.enrollment_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      return `<tr>
        <td><div class="student-cell"><span class="student-avatar tone-${index % 4}">${escapeHtml(initials(student.full_name))}</span><span class="student-meta"><strong>${escapeHtml(student.full_name)}</strong><span>${escapeHtml(student.email)}</span></span></div></td>
        <td>${escapeHtml(student.course)}</td>
        <td><span class="year-label">Year ${escapeHtml(student.year)}</span></td>
        <td>${escapeHtml(enrolled)}</td>
        <td><span class="status-badge${statusClass}">${escapeHtml(student.status)}</span></td>
        <td><span class="row-actions">
          <button class="row-action" type="button" data-action="view" data-id="${student.id}" aria-label="View ${escapeHtml(student.full_name)}" title="View details">⌕</button>
          <button class="row-action" type="button" data-action="edit" data-id="${student.id}" aria-label="Edit ${escapeHtml(student.full_name)}" title="Edit student">✎</button>
          <button class="row-action" type="button" data-action="delete" data-id="${student.id}" aria-label="Delete ${escapeHtml(student.full_name)}" title="Delete student">×</button>
        </span></td>
      </tr>`;
    }).join("");
  }

  async function loadDashboard() {
    const data = await api("/api/dashboard");
    document.getElementById("total-students").textContent = data.total_students;
    document.getElementById("active-students").textContent = data.active_students;
    document.getElementById("inactive-students").textContent = data.inactive_students;
    document.getElementById("course-count").textContent = data.courses.length;
    const selected = courseFilter.value;
    courseFilter.innerHTML = `<option value="">All courses</option>${data.courses.map((course) => `<option value="${escapeHtml(course.name)}">${escapeHtml(course.name)} (${course.count})</option>`).join("")}`;
    courseFilter.value = data.courses.some((course) => course.name === selected) ? selected : "";
    document.getElementById("course-options").innerHTML = data.courses.map((course) => `<option value="${escapeHtml(course.name)}"></option>`).join("");
  }

  async function loadStudents() {
    rows.innerHTML = `<tr><td class="loading-cell" colspan="6"><span class="spinner"></span> Loading student records...</td></tr>`;
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    if (courseFilter.value) params.set("course", courseFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    try {
      students = await api(`/api/students${params.size ? `?${params}` : ""}`);
      renderStudents();
    } catch (error) {
      rows.innerHTML = `<tr><td class="empty-cell" colspan="6"><strong>Couldn’t load students</strong><span>${escapeHtml(error.message)} Use Refresh to try again.</span></td></tr>`;
      showToast(error.message, true);
    }
  }

  async function loadAttendance() {
    const dateInput = document.getElementById("attendance-date");
    const date = dateInput.value || localDateValue();
    attendanceRows.innerHTML = `<tr><td class="loading-cell" colspan="3"><span class="spinner"></span> Loading roster...</td></tr>`;
    try {
      const roster = await api(`/api/attendance?date=${encodeURIComponent(date)}`);
      attendanceRows.innerHTML = roster.length ? roster.map((student) => {
        const status = student.status || "";
        return `<tr>
          <td><div class="student-cell"><span class="student-avatar">${escapeHtml(initials(student.student_name))}</span><span class="student-meta"><strong>${escapeHtml(student.student_name)}</strong><span>Student #${student.student_id}</span></span></div></td>
          <td>${escapeHtml(student.course)}</td>
          <td><label class="sr-only" for="attendance-${student.student_id}">Attendance for ${escapeHtml(student.student_name)}</label><select class="attendance-select" id="attendance-${student.student_id}" data-student-id="${student.student_id}"><option value="">Not marked</option><option value="Present"${status === "Present" ? " selected" : ""}>Present</option><option value="Absent"${status === "Absent" ? " selected" : ""}>Absent</option><option value="Late"${status === "Late" ? " selected" : ""}>Late</option></select></td>
        </tr>`;
      }).join("") : `<tr><td class="empty-cell" colspan="3"><strong>No active students</strong><span>Add an active student to take attendance.</span></td></tr>`;
      updateAttendanceSummary();
    } catch (error) {
      attendanceRows.innerHTML = `<tr><td class="empty-cell" colspan="3"><strong>Couldn’t load attendance</strong><span>${escapeHtml(error.message)} Use Refresh to try again.</span></td></tr>`;
      showToast(error.message, true);
    }
  }

  function updateAttendanceSummary() {
    const selects = [...attendanceRows.querySelectorAll(".attendance-select")];
    const marked = selects.filter((select) => select.value).length;
    const present = selects.filter((select) => select.value === "Present").length;
    document.getElementById("attendance-summary").textContent =
      `${marked} of ${selects.length} marked · ${present} present`;
  }

  async function saveAttendance() {
    const date = document.getElementById("attendance-date").value;
    const records = [...attendanceRows.querySelectorAll(".attendance-select")]
      .filter((select) => select.value)
      .map((select) => ({ student_id: Number(select.dataset.studentId), status: select.value }));
    if (!records.length) {
      showToast("Mark at least one student before saving attendance.", true);
      return;
    }
    const button = document.getElementById("save-attendance");
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      const result = await api("/api/attendance", {
        method: "PUT",
        body: JSON.stringify({ date, records })
      });
      showToast(result.message);
      await loadAttendance();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Save attendance";
    }
  }

  function renderGrades() {
    const search = document.getElementById("grade-search").value.trim().toLowerCase();
    const visibleGrades = grades.filter((grade) =>
      `${grade.student_name} ${grade.assessment} ${grade.course}`.toLowerCase().includes(search)
    );
    const average = visibleGrades.length
      ? visibleGrades.reduce((sum, grade) => sum + grade.score, 0) / visibleGrades.length
      : null;
    document.getElementById("grade-average").textContent =
      `Average: ${average === null ? "—" : `${average.toFixed(1)}%`}`;
    document.getElementById("grade-count").textContent =
      `Showing ${visibleGrades.length} grade${visibleGrades.length === 1 ? "" : "s"}`;
    if (!visibleGrades.length) {
      gradeRows.innerHTML = `<tr><td class="empty-cell" colspan="6"><strong>No grade records found</strong><span>Add a grade or change your search.</span></td></tr>`;
      return;
    }
    gradeRows.innerHTML = visibleGrades.map((grade) => {
      const date = new Date(`${grade.assessed_on}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      return `<tr>
        <td><div class="student-meta"><strong>${escapeHtml(grade.student_name)}</strong><span>Student #${grade.student_id}</span></div></td>
        <td>${escapeHtml(grade.assessment)}</td>
        <td>${escapeHtml(grade.course)}</td>
        <td><span class="grade-score">${escapeHtml(Number(grade.score).toFixed(1))}%</span></td>
        <td>${escapeHtml(date)}</td>
        <td><span class="row-actions"><button class="row-action" type="button" data-grade-action="edit" data-id="${grade.id}" aria-label="Edit grade for ${escapeHtml(grade.student_name)}" title="Edit grade">✎</button><button class="row-action" type="button" data-grade-action="delete" data-id="${grade.id}" aria-label="Delete grade for ${escapeHtml(grade.student_name)}" title="Delete grade">×</button></span></td>
      </tr>`;
    }).join("");
  }

  async function loadGrades() {
    gradeRows.innerHTML = `<tr><td class="loading-cell" colspan="6"><span class="spinner"></span> Loading grades...</td></tr>`;
    try {
      grades = await api("/api/grades");
      renderGrades();
    } catch (error) {
      gradeRows.innerHTML = `<tr><td class="empty-cell" colspan="6"><strong>Couldn’t load grades</strong><span>${escapeHtml(error.message)} Use Refresh to try again.</span></td></tr>`;
      showToast(error.message, true);
    }
  }

  async function openGradeModal(grade = null) {
    editingGradeId = grade?.id ?? null;
    gradeForm.reset();
    document.getElementById("grade-form-error").textContent = "";
    document.getElementById("grade-modal-title").textContent = grade ? "Edit grade" : "Add a grade";
    document.getElementById("save-grade").textContent = grade ? "Save changes" : "Save grade";
    try {
      gradeStudents = await api("/api/students");
      const studentSelect = document.getElementById("grade-student");
      studentSelect.innerHTML = `<option value="">Select student</option>${gradeStudents.map((student) => `<option value="${student.id}">${escapeHtml(student.full_name)} · ${escapeHtml(student.course)}</option>`).join("")}`;
      if (!gradeStudents.length) {
        showToast("Add a student before recording grades.", true);
        return;
      }
      if (grade) {
        gradeForm.elements.namedItem("student_id").value = String(grade.student_id);
        gradeForm.elements.namedItem("assessment").value = grade.assessment;
        gradeForm.elements.namedItem("score").value = grade.score;
        gradeForm.elements.namedItem("assessed_on").value = grade.assessed_on;
      } else {
        gradeForm.elements.namedItem("assessed_on").value = localDateValue();
      }
      gradeModal.hidden = false;
      gradeForm.elements.namedItem("student_id").focus();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function closeGradeModal() {
    gradeModal.hidden = true;
    editingGradeId = null;
  }

  async function deleteGrade(id) {
    const grade = grades.find((item) => item.id === id);
    if (!grade || !window.confirm(`Delete the ${grade.assessment} grade for ${grade.student_name}?`)) return;
    try {
      await api(`/api/grades/${id}`, { method: "DELETE" });
      showToast("Grade deleted successfully.");
      await loadGrades();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function refreshAll(showMessage = false) {
    try {
      await Promise.all([loadDashboard(), loadStudents()]);
      if (showMessage) showToast("Student records refreshed.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function openStudentModal(student = null) {
    editingId = student?.id ?? null;
    studentForm.reset();
    document.getElementById("form-error").textContent = "";
    document.getElementById("modal-title").textContent = student ? "Edit student" : "Add a student";
    document.querySelector("#student-modal .panel-subtitle").textContent = student ? "Update the student’s information below." : "Fill in the details to create a student record.";
    document.getElementById("save-student").textContent = student ? "Save changes" : "Save student";
    if (student) {
      Object.entries(student).forEach(([key, value]) => {
        const field = studentForm.elements.namedItem(key);
        if (field) field.value = value;
      });
    } else {
      const now = new Date();
      const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      studentForm.elements.namedItem("enrollment_date").value = localDate;
      studentForm.elements.namedItem("status").value = "Active";
    }
    studentModal.hidden = false;
    studentForm.elements.namedItem("full_name").focus();
  }

  function closeStudentModal() {
    studentModal.hidden = true;
    editingId = null;
  }

  function showDetails(student) {
    viewingId = student.id;
    document.getElementById("detail-name").textContent = student.full_name;
    document.getElementById("detail-email").textContent = student.email;
    const fields = [
      ["Course / program", student.course],
      ["Year of study", `Year ${student.year}`],
      ["Phone number", student.phone || "Not provided"],
      ["Enrollment date", new Date(`${student.enrollment_date}T00:00:00`).toLocaleDateString()],
      ["Status", student.status],
      ["Student ID", `#${student.id}`]
    ];
    document.getElementById("detail-content").innerHTML = fields.map(([label, value]) =>
      `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    ).join("");
    detailModal.hidden = false;
  }

  async function deleteStudent(id) {
    const student = students.find((item) => item.id === id);
    if (!student || !window.confirm(`Delete ${student.full_name} from the student directory? This cannot be undone.`)) return;
    try {
      await api(`/api/students/${id}`, { method: "DELETE" });
      showToast("Student deleted successfully.");
      await refreshAll();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function exportCsv() {
    if (!students.length) {
      showToast("There are no student records to export.", true);
      return;
    }
    const columns = ["id", "full_name", "email", "phone", "course", "year", "status", "enrollment_date"];
    const csv = [columns.join(","), ...students.map((student) => columns.map((key) => `"${String(student[key] ?? "").replace(/"/g, '""')}"`).join(","))].join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "students.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    showToast("Student list exported as CSV.");
  }

  document.getElementById("add-student-top").addEventListener("click", () => openStudentModal());
  document.getElementById("close-modal").addEventListener("click", closeStudentModal);
  document.getElementById("cancel-modal").addEventListener("click", closeStudentModal);
  studentModal.addEventListener("click", (event) => { if (event.target === studentModal) closeStudentModal(); });
  document.getElementById("close-detail").addEventListener("click", () => { detailModal.hidden = true; });
  document.getElementById("detail-close-button").addEventListener("click", () => { detailModal.hidden = true; });
  detailModal.addEventListener("click", (event) => { if (event.target === detailModal) detailModal.hidden = true; });
  document.getElementById("detail-edit-button").addEventListener("click", () => {
    const student = students.find((item) => item.id === viewingId);
    detailModal.hidden = true;
    if (student) openStudentModal(student);
  });
  document.getElementById("attendance-date").value = localDateValue();
  document.getElementById("attendance-date").addEventListener("change", loadAttendance);
  attendanceRows.addEventListener("change", (event) => {
    if (event.target.matches(".attendance-select")) updateAttendanceSummary();
  });
  document.getElementById("save-attendance").addEventListener("click", saveAttendance);
  document.getElementById("refresh-attendance").addEventListener("click", loadAttendance);
  document.getElementById("add-grade").addEventListener("click", () => openGradeModal());
  document.getElementById("close-grade-modal").addEventListener("click", closeGradeModal);
  document.getElementById("cancel-grade-modal").addEventListener("click", closeGradeModal);
  gradeModal.addEventListener("click", (event) => { if (event.target === gradeModal) closeGradeModal(); });
  gradeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const wasEditing = editingGradeId !== null;
    const formData = new FormData(gradeForm);
    const payload = Object.fromEntries(formData.entries());
    payload.student_id = Number(payload.student_id);
    payload.score = Number(payload.score);
    const button = document.getElementById("save-grade");
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      await api(editingGradeId ? `/api/grades/${editingGradeId}` : "/api/grades", {
        method: editingGradeId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      closeGradeModal();
      showToast(wasEditing ? "Grade updated successfully." : "Grade added successfully.");
      await loadGrades();
    } catch (error) {
      document.getElementById("grade-form-error").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = wasEditing ? "Save changes" : "Save grade";
    }
  });
  gradeRows.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-grade-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const grade = grades.find((item) => item.id === id);
    if (!grade) return;
    if (button.dataset.gradeAction === "edit") await openGradeModal(grade);
    if (button.dataset.gradeAction === "delete") await deleteGrade(id);
  });
  document.getElementById("grade-search").addEventListener("input", renderGrades);
  document.getElementById("refresh-grades").addEventListener("click", loadGrades);
  studentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const wasEditing = editingId !== null;
    const formData = new FormData(studentForm);
    const payload = Object.fromEntries(formData.entries());
    payload.year = Number(payload.year);
    const saveButton = document.getElementById("save-student");
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      await api(editingId ? `/api/students/${editingId}` : "/api/students", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      closeStudentModal();
      showToast(wasEditing ? "Student details updated." : "Student added successfully.");
      await refreshAll();
    } catch (error) {
      document.getElementById("form-error").textContent = error.message;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = wasEditing ? "Save changes" : "Save student";
    }
  });
  rows.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const student = students.find((item) => item.id === id);
    if (!student) return;
    if (button.dataset.action === "view") showDetails(student);
    if (button.dataset.action === "edit") openStudentModal(student);
    if (button.dataset.action === "delete") await deleteStudent(id);
  });
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadStudents, 220);
  });
  courseFilter.addEventListener("change", loadStudents);
  statusFilter.addEventListener("change", loadStudents);
  document.getElementById("refresh-button").addEventListener("click", () => refreshAll(true));
  document.getElementById("export-button").addEventListener("click", exportCsv);
  document.getElementById("sort-name").addEventListener("click", () => { sortAscending = !sortAscending; renderStudents(); });
  document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.querySelectorAll("[data-nav]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelectorAll("[data-nav]").forEach((item) => item.classList.toggle("active", item === link));
    const page = link.dataset.nav === "attendance" || link.dataset.nav === "grades" ? link.dataset.nav : "overview";
    document.querySelectorAll("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== page; });
    document.getElementById("breadcrumb-current").textContent = page[0].toUpperCase() + page.slice(1);
    document.getElementById("sidebar").classList.remove("open");
    if (page === "attendance") loadAttendance();
    if (page === "grades") loadGrades();
  }));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === "Escape") {
      closeStudentModal();
      detailModal.hidden = true;
      closeGradeModal();
      document.getElementById("sidebar").classList.remove("open");
    }
  });

  const today = new Date();
  document.getElementById("today-label").textContent = today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  document.getElementById("year-now").textContent = today.getFullYear();
  refreshAll();
})();
