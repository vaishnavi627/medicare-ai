const adminTokenKey = "medicare_admin_token";
const token = window.sessionStorage.getItem(adminTokenKey);

function adminHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function adminRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...adminHeaders(), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Admin request failed.");
  return data;
}

function localDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function filters() {
  const params = new URLSearchParams();
  const date = document.getElementById("adminDateFilter").value;
  const doctor = document.getElementById("adminDoctorFilter").value;
  const status = document.getElementById("adminStatusFilter").value;
  if (date) params.set("date", date);
  if (doctor) params.set("doctor_id", doctor);
  if (status) params.set("status", status);
  return params;
}

function statusLabel(status) {
  return status === "demo_confirmed" ? "Confirmed" : status.charAt(0).toUpperCase() + status.slice(1);
}

async function loadDoctors() {
  const doctors = await fetch("/api/doctors").then((response) => response.json());
  const select = document.getElementById("adminDoctorFilter");
  doctors.forEach((doctor) => {
    const option = document.createElement("option");
    option.value = doctor.id;
    option.textContent = doctor.name;
    select.append(option);
  });
}

async function loadAppointments() {
  const message = document.getElementById("adminAppointmentMessage");
  message.textContent = "Loading appointments…";
  try {
    const appointments = await adminRequest(`/api/admin/appointments?${filters()}`);
    const rows = document.getElementById("adminAppointmentRows");
    rows.replaceChildren();
    if (!appointments.length) {
      rows.innerHTML = '<tr><td colspan="6" class="text-secondary py-4">No appointments match these filters.</td></tr>';
    }
    appointments.forEach((appointment) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${appointment.appointment_time} IST</td>
        <td>${appointment.patient_name}</td>
        <td>${appointment.doctor}</td>
        <td>${appointment.specialty}</td>
        <td class="${appointment.status === "demo_confirmed" ? "text-success" : appointment.status === "completed" ? "text-info" : "text-danger"}">${statusLabel(appointment.status)}</td>
        <td class="text-end"></td>`;
      const actions = row.lastElementChild;
      if (appointment.status === "demo_confirmed") {
        [["completed", "Complete", "btn-outline-info"], ["cancelled", "Cancel", "btn-outline-danger"]].forEach(([status, label, style]) => {
          const button = document.createElement("button");
          button.className = `btn btn-sm ${style} ms-1`;
          button.textContent = label;
          button.addEventListener("click", async () => {
            if (!window.confirm(`${label} this appointment?`)) return;
            await adminRequest(`/api/admin/appointments/${appointment.id}/status`, {
              method: "PATCH",
              body: JSON.stringify({ status }),
            });
            await loadAppointments();
          });
          actions.append(button);
        });
      } else {
        actions.textContent = "No actions";
        actions.className += " text-secondary small";
      }
      rows.append(row);
    });
    message.textContent = `${appointments.length} appointment${appointments.length === 1 ? "" : "s"} found.`;
  } catch (error) {
    message.textContent = error.message;
    message.className = "small text-danger mb-3";
  }
}

async function start() {
  if (!token) {
    window.location.replace("/");
    return;
  }
  try {
    const session = await adminRequest("/api/admin/session");
    document.getElementById("adminIdentity").textContent = session.email;
    document.getElementById("adminDateFilter").value = localDateString();
    await loadDoctors();
    await loadAppointments();
  } catch {
    window.sessionStorage.removeItem(adminTokenKey);
    window.location.replace("/");
  }
}

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  window.sessionStorage.removeItem(adminTokenKey);
  window.location.replace("/");
});
["adminDateFilter", "adminDoctorFilter", "adminStatusFilter"].forEach((id) => {
  document.getElementById(id).addEventListener("change", loadAppointments);
});
document.getElementById("exportAppointmentsBtn").addEventListener("click", async () => {
  const response = await fetch(`/api/admin/appointments.csv?${filters()}`, { headers: adminHeaders() });
  if (!response.ok) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = "appointments.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});
start();
