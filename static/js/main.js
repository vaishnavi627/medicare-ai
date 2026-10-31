const bookingDate = document.getElementById("bookingDate");
const specialtySelect = document.getElementById("bookingSpecialty");
const doctorSelect = document.getElementById("bookingDoctor");
const slotsContainer = document.getElementById("slotsContainer");
const selectedSlot = document.getElementById("bookingSelectedSlot");
const bookingForm = document.getElementById("consultationBookingForm");
const chatForm = document.getElementById("clinicChatForm");
let doctors = [];
let lastBooking = null;
const chatMessages = [];
let bookingFlow = null;

function showMessage(message) {
  const toastElement = document.getElementById("liveToast");
  const messageElement = document.getElementById("toastMessage");
  if (toastElement && messageElement && window.bootstrap) {
    messageElement.textContent = message;
    window.bootstrap.Toast.getOrCreateInstance(toastElement).show();
  } else {
    window.alert(message);
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Please check the entered information.";
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return data;
}

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function activePeriod() {
  return document.querySelector(".period-tab.active")?.dataset.period || "afternoon";
}

function setSelectedSlot(slot) {
  selectedSlot.value = slot;
  slotsContainer.querySelectorAll(".slot-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.slot === slot);
  });
}

async function loadDoctors(preferredDoctorId) {
  const specialty = specialtySelect.value;
  doctors = await apiRequest(`/api/doctors?specialty=${encodeURIComponent(specialty)}`);
  doctorSelect.replaceChildren(...doctors.map((doctor) => {
    const option = document.createElement("option");
    option.value = doctor.id;
    option.textContent = doctor.name;
    return option;
  }));
  if (preferredDoctorId && doctors.some((doctor) => doctor.id === preferredDoctorId)) {
    doctorSelect.value = preferredDoctorId;
  }
}

async function loadSlots(preferredTime) {
  const date = bookingDate.value;
  const doctorId = doctorSelect.value;
  const period = activePeriod();
  if (!date || !doctorId) return;

  slotsContainer.replaceChildren();
  selectedSlot.value = "";
  try {
    const result = await apiRequest(
      `/api/availability?date=${encodeURIComponent(date)}&doctor_id=${encodeURIComponent(doctorId)}&period=${encodeURIComponent(period)}`,
    );
    if (!result.slots.length) {
      slotsContainer.textContent = "No slots available for this period.";
      return;
    }
    result.slots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot-btn";
      button.dataset.slot = slot;
      button.textContent = slot;
      button.addEventListener("click", () => setSelectedSlot(slot));
      slotsContainer.append(button);
    });
    const chosen = result.slots.includes(preferredTime) ? preferredTime : result.slots[0];
    setSelectedSlot(chosen);
  } catch (error) {
    slotsContainer.textContent = "Could not load available slots.";
    showMessage(error.message);
  }
}

function setBookingDateAndPeriod(date, slot) {
  if (date) bookingDate.value = date;
  const hour = Number((slot || "").slice(0, 2));
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  document.querySelectorAll(".period-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === period);
  });
}

async function initializeBooking() {
  if (!bookingDate || !specialtySelect || !doctorSelect || !slotsContainer) return;
  bookingDate.min = localDateString();
  if (!bookingDate.value || bookingDate.value < bookingDate.min) {
    bookingDate.value = bookingDate.min;
  }
  await loadDoctors();
  await loadSlots();

  specialtySelect.addEventListener("change", async () => {
    try {
      await loadDoctors();
      await loadSlots();
    } catch (error) {
      showMessage(error.message);
    }
  });
  doctorSelect.addEventListener("change", () => loadSlots());
  bookingDate.addEventListener("change", () => loadSlots());
  document.querySelectorAll(".period-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".period-tab").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      loadSlots();
    });
  });
}

document.querySelectorAll(".doctor-book-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    specialtySelect.value = button.dataset.specialty;
    setBookingDateAndPeriod(bookingDate.min, button.dataset.slot);
    try {
      await loadDoctors();
      await loadSlots(button.dataset.slot);
      document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      showMessage(error.message);
    }
  });
});

document.querySelectorAll(".service-book-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    specialtySelect.value = button.dataset.specialty;
    try {
      await loadDoctors();
      await loadSlots();
      document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      showMessage(error.message);
    }
  });
});

if (bookingForm) {
  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = bookingForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await submitBooking({
        patient_name: document.getElementById("bookingFullName").value,
        phone: document.getElementById("bookingPhone").value,
        specialty: specialtySelect.value,
        doctor_id: doctorSelect.value,
        appointment_date: bookingDate.value,
        appointment_time: selectedSlot.value,
        notes: document.getElementById("bookingNotes").value,
      });
    } catch (error) {
      showMessage(error.message);
      await loadSlots();
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function submitBooking(payload) {
  lastBooking = await apiRequest("/api/appointments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  document.getElementById("receiptTokenId").textContent = lastBooking.token;
  document.getElementById("receiptBay").textContent = lastBooking.specialty;
  document.getElementById("receiptDoctor").textContent = lastBooking.doctor;
  document.getElementById("receiptSpecialty").textContent = lastBooking.specialty;
  document.getElementById("receiptDateSlot").textContent =
    `${lastBooking.appointment_date} • ${lastBooking.appointment_time} IST`;
  document.getElementById("receiptPatient").textContent = lastBooking.patient_name;
  document.getElementById("appointmentTokenLookup").value = lastBooking.token;
  document.getElementById("appointmentPortalMessage").textContent =
    `Your booking token is ${lastBooking.token}. Save it to manage this appointment later.`;
  document.getElementById("appointmentPortalMessage").className = "small text-success fw-semibold";
  window.bootstrap.Modal.getOrCreateInstance(document.getElementById("bookingReceiptModal")).show();
  showMessage(`Booking saved. Your token is ${lastBooking.token}`);
  await loadSlots();
  return lastBooking;
}

function appendChatMessage(role, text, suggestion) {
  const history = document.getElementById("clinicChatHistory");
  const row = document.createElement("div");
  row.className = `clinic-chat-row clinic-chat-row-${role}`;
  const bubble = document.createElement("div");
  bubble.className = `clinic-chat-bubble clinic-chat-bubble-${role}`;
  bubble.textContent = text;
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "clinic-chat-message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const icon = document.createElement("i");
    icon.className = "bi bi-heart-pulse-fill";
    avatar.append(icon);
    const content = document.createElement("div");
    content.className = "clinic-chat-message-content";
    const label = document.createElement("div");
    label.className = "clinic-chat-message-label";
    label.textContent = "MediCare Assistant";
    content.append(label, bubble);
    row.append(avatar, content);
  } else {
    row.append(bubble);
  }
  history.append(row);

  if (role === "assistant" && suggestion) {
    const actionRow = document.createElement("div");
    actionRow.className = "clinic-chat-row";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn btn-cyan btn-sm";
    action.classList.add("clinic-chat-action");
    action.textContent = `Use ${suggestion.time} ${suggestion.date} for booking`;
    action.addEventListener("click", async () => {
      specialtySelect.value = suggestion.specialty;
      setBookingDateAndPeriod(suggestion.date, suggestion.time);
      try {
        await loadDoctors(suggestion.doctor_id);
        await loadSlots(suggestion.time);
        if (selectedSlot.value !== suggestion.time) {
          showMessage("That slot is no longer available. Please select one of the refreshed options.");
        }
        document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
      } catch (error) {
        showMessage(error.message);
      }
    });
    actionRow.append(action);
    history.append(actionRow);
  }
  history.scrollTop = history.scrollHeight;
}

function addBookingChoices(options) {
  const history = document.getElementById("clinicChatHistory");
  const row = document.createElement("div");
  row.className = "clinic-chat-choice-row";
  const step = bookingFlow?.step;
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clinic-chat-choice";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      if (!bookingFlow || bookingFlow.step !== step) return;
      row.querySelectorAll("button").forEach((choice) => { choice.disabled = true; });
      appendChatMessage("user", option.label);
      advanceBookingFlow(option.value).catch((error) => {
        appendChatMessage("assistant", `I couldn't continue the booking: ${error.message}`);
      });
    });
    row.append(button);
  });
  history.append(row);
  history.scrollTop = history.scrollHeight;
}

function promptForAppointmentDate() {
  appendChatMessage("assistant", "What date would you prefer? Choose a date below or type it as YYYY-MM-DD.");
  const history = document.getElementById("clinicChatHistory");
  const row = document.createElement("div");
  row.className = "clinic-chat-date-row";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "form-control form-control-clinical clinic-chat-date-input";
  dateInput.min = localDateString();
  const maxDate = new Date(`${dateInput.min}T12:00:00+05:30`);
  maxDate.setDate(maxDate.getDate() + 365);
  dateInput.max = localDateString(maxDate);
  dateInput.setAttribute("aria-label", "Preferred appointment date");
  const chooseButton = document.createElement("button");
  chooseButton.type = "button";
  chooseButton.className = "clinic-chat-choice clinic-chat-date-button";
  chooseButton.textContent = "Use this date";
  chooseButton.addEventListener("click", () => {
    if (!bookingFlow || bookingFlow.step !== "date") return;
    if (!dateInput.value) {
      showMessage("Choose a date first.");
      return;
    }
    row.remove();
    appendChatMessage("user", dateInput.value);
    advanceBookingFlow(dateInput.value).catch((error) => {
      appendChatMessage("assistant", `I couldn't check that date: ${error.message}`);
    });
  });
  row.append(dateInput, chooseButton);
  history.append(row);
  history.scrollTop = history.scrollHeight;
}

function parseSpecialty(text) {
  const normalized = text.trim().toLocaleLowerCase();
  const exact = [...specialtySelect.options].find(
    (option) => option.value.toLocaleLowerCase() === normalized,
  );
  if (exact) return exact.value;
  const aliases = [
    ["cardio", "Cardiology Screening"],
    ["heart", "Cardiology Screening"],
    ["general", "General Consultation"],
    ["dental", "Dental & Oral Care"],
    ["oral", "Dental & Oral Care"],
    ["preventive", "Preventive Health Checkups"],
    ["checkup", "Preventive Health Checkups"],
    ["pediatric", "Pediatrics"],
    ["child", "Pediatrics"],
    ["telehealth", "Telehealth & AI Diagnostics"],
    ["diagnostic", "Telehealth & AI Diagnostics"],
  ];
  return aliases.find(([alias]) => normalized.includes(alias))?.[1] || null;
}

function parsePeriod(text) {
  const normalized = text.trim().toLocaleLowerCase();
  if (normalized.includes("morning")) return "morning";
  if (normalized.includes("afternoon") || normalized.includes("noon")) return "afternoon";
  if (normalized.includes("evening")) return "evening";
  return null;
}

async function startBookingFlow(initialMessage) {
  bookingFlow = { step: "specialty", data: {}, doctors: [], slots: [] };
  chatMessages.length = 0;
  document.querySelectorAll(".chat-prompt-btn").forEach((button) => { button.disabled = true; });
  document.getElementById("clinicChatInput").placeholder = "Choose an option above or type a reply...";
  if (initialMessage) appendChatMessage("user", initialMessage);
  appendChatMessage(
    "assistant",
    "I can help prepare your appointment. I’ll collect your details in the clinic booking form, separately from the AI chat. First, which service would you like?",
  );
  addBookingChoices([...specialtySelect.options].map((option) => ({
    label: option.textContent,
    value: option.value,
  })));
}

async function findBookingSlots(period) {
  const { date, specialty, doctorId } = bookingFlow.data;
  const matchingDoctors = doctorId === "any"
    ? bookingFlow.doctors
    : bookingFlow.doctors.filter((doctor) => doctor.id === doctorId);
  const results = await Promise.all(matchingDoctors.map(async (doctor) => {
    const availability = await apiRequest(
      `/api/availability?date=${encodeURIComponent(date)}&doctor_id=${encodeURIComponent(doctor.id)}&period=${encodeURIComponent(period)}`,
    );
    return availability.slots.map((time) => ({
      time,
      doctor_id: doctor.id,
      doctor: doctor.name,
      specialty,
      date,
    }));
  }));
  return results.flat().sort((first, second) => first.time.localeCompare(second.time));
}

async function advanceBookingFlow(value) {
  if (!bookingFlow) return;
  const flow = bookingFlow;

  if (flow.step === "specialty") {
    const specialty = [...specialtySelect.options].some((option) => option.value === value)
      ? value
      : parseSpecialty(String(value));
    if (!specialty) {
      appendChatMessage("assistant", "Please choose one of the clinic services below.");
      addBookingChoices([...specialtySelect.options].map((option) => ({
        label: option.textContent,
        value: option.value,
      })));
      return;
    }
    flow.data.specialty = specialty;
    flow.doctors = await apiRequest(`/api/doctors?specialty=${encodeURIComponent(specialty)}`);
    flow.step = "doctor";
    appendChatMessage("assistant", "Do you have a doctor preference?");
    addBookingChoices([
      ...flow.doctors.map((doctor) => ({ label: doctor.name, value: doctor.id })),
      { label: "Any available doctor", value: "any" },
    ]);
    return;
  }

  if (flow.step === "doctor") {
    const selected = flow.doctors.find((doctor) =>
      doctor.id === value || doctor.name.toLocaleLowerCase() === String(value).trim().toLocaleLowerCase(),
    );
    const isAny = value === "any" || String(value).toLocaleLowerCase().includes("any");
    if (!isAny && !selected) {
      appendChatMessage("assistant", "Please choose a doctor from the options below.");
      addBookingChoices([
        ...flow.doctors.map((doctor) => ({ label: doctor.name, value: doctor.id })),
        { label: "Any available doctor", value: "any" },
      ]);
      return;
    }
    flow.data.doctorId = selected ? selected.id : "any";
    flow.step = "date";
    promptForAppointmentDate();
    return;
  }

  if (flow.step === "date") {
    const date = String(value).trim();
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    const today = localDateString();
    const latestDate = new Date(`${today}T00:00:00Z`);
    latestDate.setUTCDate(latestDate.getUTCDate() + 365);
    if (
      !parsedDate
      || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== date
      || date < today
      || date > latestDate.toISOString().slice(0, 10)
    ) {
      appendChatMessage("assistant", "Please choose a date from today through the next year.");
      promptForAppointmentDate();
      return;
    }
    flow.data.date = date;
    flow.step = "period";
    appendChatMessage("assistant", "What time of day works best for you?");
    addBookingChoices([
      { label: "Morning", value: "morning" },
      { label: "Afternoon", value: "afternoon" },
      { label: "Evening", value: "evening" },
    ]);
    return;
  }

  if (flow.step === "period") {
    if (value === "change-date") {
      flow.step = "date";
      promptForAppointmentDate();
      return;
    }
    const period = ["morning", "afternoon", "evening"].includes(value)
      ? value
      : parsePeriod(String(value));
    if (!period) {
      appendChatMessage("assistant", "Please choose morning, afternoon, or evening.");
      addBookingChoices([
        { label: "Morning", value: "morning" },
        { label: "Afternoon", value: "afternoon" },
        { label: "Evening", value: "evening" },
      ]);
      return;
    }
    flow.data.period = period;
    flow.step = "slot";
    appendChatMessage("assistant", "I’m checking the live schedule now.");
    flow.slots = await findBookingSlots(period);
    if (!flow.slots.length) {
      flow.step = "period";
      appendChatMessage("assistant", "There are no open slots for that selection. Try another time of day or date.");
      addBookingChoices([
        { label: "Morning", value: "morning" },
        { label: "Afternoon", value: "afternoon" },
        { label: "Evening", value: "evening" },
        { label: "Choose another date", value: "change-date" },
      ]);
      return;
    }
    appendChatMessage("assistant", `These slots are currently available on ${flow.data.date}. Choose one to continue.`);
    addBookingChoices(flow.slots.map((slot, index) => ({
      label: `${slot.time} · ${slot.doctor.replace(/\s*\([^)]*\)/, "")}`,
      value: String(index),
    })));
    return;
  }

  if (flow.step === "slot") {
    if (value === "change-date") {
      flow.step = "date";
      promptForAppointmentDate();
      return;
    }
    const slot = flow.slots[Number(value)];
    if (!slot) {
      const typedTime = String(value).match(/\b\d{1,2}:\d{2}\b/)?.[0];
      const typedDoctor = String(value).toLocaleLowerCase().replace(typedTime || "", "").trim();
      const match = flow.slots.find((candidate) =>
        candidate.time === typedTime
        && (!typedDoctor || candidate.doctor.toLocaleLowerCase().includes(typedDoctor)),
      );
      if (!match) {
        appendChatMessage("assistant", "Please choose one of the available slots shown above.");
        addBookingChoices(flow.slots.map((candidate, index) => ({
          label: `${candidate.time} · ${candidate.doctor.replace(/\s*\([^)]*\)/, "")}`,
          value: String(index),
        })));
        return;
      }
      flow.data.slot = match;
    } else {
      flow.data.slot = slot;
    }
    flow.step = "name";
    appendChatMessage("assistant", "What name should I put on the appointment?");
    return;
  }

  if (flow.step === "name") {
    const name = String(value).trim();
    if (name.length < 2 || name.length > 100) {
      appendChatMessage("assistant", "Please enter a name between 2 and 100 characters.");
      return;
    }
    flow.data.patientName = name;
    flow.step = "phone";
    appendChatMessage("assistant", "What phone number can the clinic use to contact you about this demo booking?");
    return;
  }

  if (flow.step === "phone") {
    const phone = String(value).trim();
    const digits = phone.replace(/\D/g, "");
    if (!/^\+?[0-9][0-9 ()-]{6,18}[0-9]$/.test(phone) || digits.length < 8 || digits.length > 15) {
      appendChatMessage("assistant", "That phone number doesn’t look valid. Please enter 8–15 digits, optionally with a country code.");
      return;
    }
    flow.data.phone = phone;
    flow.step = "confirm";
    const slot = flow.data.slot;
    const doctor = flow.doctors.find((item) => item.id === slot.doctor_id);
    appendChatMessage(
      "assistant",
      `Please review your request:\n${flow.data.specialty}\n${doctor?.name || slot.doctor}\n${slot.date} at ${slot.time} IST\nName: ${flow.data.patientName}\nPhone: ••••${digits.slice(-4)}\n\nI’ll fill the appointment form and submit it only if you confirm.`,
    );
    addBookingChoices([
      { label: "Confirm and book", value: "confirm" },
      { label: "Cancel booking", value: "cancel" },
    ]);
    return;
  }

  if (flow.step === "confirm") {
    if (value === "cancel") {
      bookingFlow = null;
      document.querySelectorAll(".chat-prompt-btn").forEach((button) => { button.disabled = false; });
      document.getElementById("clinicChatInput").placeholder = "Ask a question...";
      appendChatMessage("assistant", "Booking cancelled. I haven’t submitted your details.");
      return;
    }
    if (value !== "confirm") {
      appendChatMessage("assistant", "Choose “Confirm and book” to submit, or “Cancel booking” to stop.");
      return;
    }
    const booking = flow.data;
    const slot = booking.slot;
    try {
      specialtySelect.value = booking.specialty;
      await loadDoctors(slot.doctor_id);
      setBookingDateAndPeriod(slot.date, slot.time);
      await loadSlots(slot.time);
      if (selectedSlot.value !== slot.time) {
        flow.step = "period";
        appendChatMessage("assistant", "That slot has just been taken. Please choose another period or date; I’ll check again.");
        addBookingChoices([
          { label: "Morning", value: "morning" },
          { label: "Afternoon", value: "afternoon" },
          { label: "Evening", value: "evening" },
          { label: "Choose another date", value: "change-date" },
        ]);
        return;
      }
      document.getElementById("bookingFullName").value = booking.patientName;
      document.getElementById("bookingPhone").value = booking.phone;
      document.getElementById("bookingNotes").value = "";
      await submitBooking({
        patient_name: booking.patientName,
        phone: booking.phone,
        specialty: booking.specialty,
        doctor_id: slot.doctor_id,
        appointment_date: slot.date,
        appointment_time: slot.time,
        notes: "",
      });
      bookingFlow = null;
      chatMessages.length = 0;
      document.querySelectorAll(".chat-prompt-btn").forEach((button) => { button.disabled = false; });
      document.getElementById("clinicChatInput").placeholder = "Ask a question...";
      appendChatMessage("assistant", `Your appointment request has been saved. Reference: ${lastBooking.token}. The form was filled automatically.`);
    } catch (error) {
      if (error.status === 409) {
        flow.step = "period";
        appendChatMessage("assistant", "That slot was just booked by someone else. Let’s check again for another time.");
        addBookingChoices([
          { label: "Morning", value: "morning" },
          { label: "Afternoon", value: "afternoon" },
          { label: "Evening", value: "evening" },
          { label: "Choose another date", value: "change-date" },
        ]);
        return;
      }
      appendChatMessage("assistant", `I couldn't submit that booking: ${error.message}. Your details were not added to the AI chat.`);
    }
  }
}

async function handleBookingInput(message) {
  if (!bookingFlow) return false;
  const normalized = message.trim().toLocaleLowerCase();
  if (["cancel", "cancel booking", "stop booking", "never mind", "nevermind"].includes(normalized)) {
    bookingFlow = null;
    document.querySelectorAll(".chat-prompt-btn").forEach((button) => { button.disabled = false; });
    document.getElementById("clinicChatInput").placeholder = "Ask a question...";
    appendChatMessage("user", message);
    appendChatMessage("assistant", "Booking cancelled. I haven’t submitted your details.");
    return true;
  }
  const displayMessage = bookingFlow.step === "phone"
    ? `••••${message.replace(/\D/g, "").slice(-4)}`
    : message;
  appendChatMessage("user", displayMessage);
  await advanceBookingFlow(message);
  return true;
}

async function sendChatMessage(text) {
  const message = text.trim();
  if (!message) return;
  const isBookingRequest = /\b(book|booking)\b|\b(schedule|make|get|need|want)\b.{0,30}\b(appointment|visit)\b|\b(appointment|visit)\b.{0,25}\b(book|schedule|available|availability)\b/i.test(message);
  if (bookingFlow) {
    try {
      await handleBookingInput(message);
    } catch (error) {
      appendChatMessage("assistant", `I couldn't continue the booking: ${error.message}. Please try again or type “cancel”.`);
    }
    return;
  }
  if (isBookingRequest) {
    await startBookingFlow(message);
    return;
  }
  chatMessages.push({ role: "user", content: message });
  appendChatMessage("user", message);
  const history = document.getElementById("clinicChatHistory");
  const thinking = document.createElement("div");
  thinking.className = "clinic-chat-row clinic-chat-row-assistant";
  thinking.setAttribute("aria-label", "Assistant is typing");
  const typingAvatar = document.createElement("div");
  typingAvatar.className = "clinic-chat-message-avatar";
  typingAvatar.innerHTML = '<i class="bi bi-heart-pulse-fill" aria-hidden="true"></i>';
  const typingContent = document.createElement("div");
  typingContent.className = "clinic-chat-message-content";
  const typingLabel = document.createElement("div");
  typingLabel.className = "clinic-chat-message-label";
  typingLabel.textContent = "MediCare Assistant";
  const typingBubble = document.createElement("div");
  typingBubble.className = "clinic-chat-bubble clinic-chat-bubble-assistant clinic-chat-typing";
  for (let index = 0; index < 3; index += 1) {
    typingBubble.append(document.createElement("span"));
  }
  typingContent.append(typingLabel, typingBubble);
  thinking.append(typingAvatar, typingContent);
  history.append(thinking);
  history.scrollTop = history.scrollHeight;
  const sendButton = document.getElementById("clinicChatSendBtn");
  sendButton.disabled = true;
  document.querySelectorAll(".chat-prompt-btn").forEach((button) => { button.disabled = true; });
  try {
    const result = await apiRequest("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: chatMessages.slice(-12) }),
    });
    chatMessages.push({ role: "assistant", content: result.reply });
    thinking.remove();
    appendChatMessage("assistant", result.reply, result.booking_suggestion);
  } catch (error) {
    thinking.remove();
    appendChatMessage("assistant", `I couldn't reach the chat service: ${error.message}`);
  } finally {
    sendButton.disabled = false;
    document.querySelectorAll(".chat-prompt-btn").forEach((button) => { button.disabled = false; });
  }
}

if (chatForm) {
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("clinicChatInput");
    const message = input.value;
    if (!message.trim()) return;
    input.value = "";
    await sendChatMessage(message);
  });
}

document.querySelectorAll(".chat-prompt-btn").forEach((button) => {
  button.addEventListener("click", () => sendChatMessage(button.dataset.query));
});

const chatWidget = document.querySelector(".clinic-chat-widget");
const chatPanel = document.getElementById("clinicChatPanel");
const chatToggle = document.getElementById("clinicChatToggle");
const chatClose = document.getElementById("clinicChatClose");
const chatBackdrop = document.getElementById("clinicChatBackdrop");

function setChatOpen(open) {
  if (!chatWidget || !chatPanel || !chatToggle) return;
  chatWidget.classList.toggle("is-open", open);
  chatPanel.classList.toggle("d-none", !open);
  chatBackdrop?.classList.toggle("d-none", !open);
  chatPanel.setAttribute("aria-hidden", String(!open));
  chatToggle.setAttribute("aria-expanded", String(open));
  chatToggle.setAttribute("aria-label", open ? "Close clinic chatbot" : "Open clinic chatbot");
  document.body.classList.toggle("clinic-chat-open", open);
  const toggleLabel = document.getElementById("clinicChatToggleLabel");
  if (toggleLabel) toggleLabel.textContent = open ? "Close chat" : "Chat with us";
  if (open) document.getElementById("clinicChatInput").focus();
  else chatToggle.focus();
}

if (chatToggle) {
  chatToggle.addEventListener("click", () => {
    setChatOpen(chatToggle.getAttribute("aria-expanded") !== "true");
  });
}

if (chatClose) {
  chatClose.addEventListener("click", () => setChatOpen(false));
}

if (chatBackdrop) {
  chatBackdrop.addEventListener("click", () => setChatOpen(false));
}

document.querySelectorAll('a[href="#clinicChatToggle"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setChatOpen(true);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chatToggle?.getAttribute("aria-expanded") === "true") {
    setChatOpen(false);
  }
});

const downloadIcsButton = document.getElementById("downloadIcsBtn");
if (downloadIcsButton) {
  downloadIcsButton.addEventListener("click", () => {
    if (!lastBooking) return;
    const dateTime = `${lastBooking.appointment_date.replaceAll("-", "")}T${lastBooking.appointment_time.replace(":", "")}00`;
    const [startHour, startMinute] = lastBooking.appointment_time.split(":").map(Number);
    const endMinutes = startHour * 60 + startMinute + 30;
    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;
    const endDateTime = `${lastBooking.appointment_date.replaceAll("-", "")}T${String(endHour).padStart(2, "0")}${String(endMinute).padStart(2, "0")}00`;
    const calendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MediCare AI Clinic//Demo Appointment//EN",
      "BEGIN:VEVENT",
      `UID:${lastBooking.id}@medicare-ai.local`,
      `DTSTART;TZID=Asia/Kolkata:${dateTime}`,
      `DTEND;TZID=Asia/Kolkata:${endDateTime}`,
      `SUMMARY:${lastBooking.specialty} - ${lastBooking.doctor}`,
      `DESCRIPTION:Demo appointment ${lastBooking.token}. Please confirm details with your clinic.`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([calendar], { type: "text/calendar" }));
    link.download = `${lastBooking.token}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

let portalAppointment = null;
const portalMessage = document.getElementById("appointmentPortalMessage");
const portalDetails = document.getElementById("appointmentPortalDetails");
const portalTokenInput = document.getElementById("appointmentTokenLookup");
const portalDateInput = document.getElementById("portalDate");
const portalTimeSelect = document.getElementById("portalTime");
const rescheduleControls = document.getElementById("rescheduleControls");

function setPortalMessage(message, isError = false) {
  if (!portalMessage) return;
  portalMessage.textContent = message;
  portalMessage.classList.toggle("text-danger", isError);
  portalMessage.classList.toggle("text-secondary", !isError);
}

function renderPortalAppointment(appointment) {
  portalAppointment = appointment;
  portalDetails.classList.remove("d-none");
  document.getElementById("portalStatus").textContent = appointment.status.replace("_", " ");
  document.getElementById("portalStatus").className =
    appointment.status === "demo_confirmed" ? "text-success fw-bold" : "text-danger fw-bold";
  document.getElementById("portalPatient").textContent = appointment.patient_name;
  document.getElementById("portalDoctor").textContent = appointment.doctor;
  document.getElementById("portalDateSlot").textContent =
    `${appointment.appointment_date} • ${appointment.appointment_time} IST`;
  document.getElementById("cancelAppointmentBtn").disabled = appointment.status !== "demo_confirmed";
  document.getElementById("rescheduleAppointmentBtn").disabled = appointment.status !== "demo_confirmed";
  if (appointment.status !== "demo_confirmed") rescheduleControls.classList.add("d-none");
}

async function lookupPortalAppointment() {
  const token = portalTokenInput.value.trim();
  if (!token) {
    setPortalMessage("Enter the token from your booking receipt.", true);
    return;
  }
  try {
    renderPortalAppointment(await apiRequest(`/api/appointments/${encodeURIComponent(token)}`));
    setPortalMessage("Appointment found.");
    return true;
  } catch (error) {
    portalDetails.classList.add("d-none");
    setPortalMessage(error.message, true);
    return false;
  }
}

async function loadPortalTimes() {
  if (!portalAppointment || !portalDateInput.value) return;
  const options = [];
  for (const period of ["morning", "afternoon", "evening"]) {
    const result = await apiRequest(
      `/api/availability?date=${encodeURIComponent(portalDateInput.value)}&doctor_id=${encodeURIComponent(portalAppointment.doctor_id)}&period=${period}`,
    );
    options.push(...result.slots);
  }
  portalTimeSelect.replaceChildren(...options.map((slot) => {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = `${slot} IST`;
    return option;
  }));
  if (!options.length) setPortalMessage("No slots are available on that date.", true);
}

if (document.getElementById("lookupAppointmentBtn")) {
  document.getElementById("lookupAppointmentBtn").addEventListener("click", lookupPortalAppointment);
  portalTokenInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") lookupPortalAppointment();
  });
  document.getElementById("rescheduleAppointmentBtn").addEventListener("click", async () => {
    if (!portalAppointment) {
      setPortalMessage("Find an appointment before rescheduling.", true);
      return;
    }
    rescheduleControls.classList.toggle("d-none");
    if (!rescheduleControls.classList.contains("d-none")) {
      portalDateInput.min = localDateString();
      portalDateInput.max = localDateString(new Date(Date.now() + 365 * 86400000));
      portalDateInput.value = portalAppointment.appointment_date;
      portalTimeSelect.replaceChildren();
      setPortalMessage("Choose a new date and time.", false);
      try {
        await loadPortalTimes();
      } catch (error) {
        setPortalMessage(error.message, true);
      }
    }
  });
  portalDateInput.addEventListener("change", () => loadPortalTimes().catch((error) => setPortalMessage(error.message, true)));
  document.getElementById("saveRescheduleBtn").addEventListener("click", async () => {
    if (!portalTimeSelect.value) {
      setPortalMessage("Choose an available time.", true);
      return;
    }
    try {
      const updated = await apiRequest(`/api/appointments/${encodeURIComponent(portalAppointment.token)}`, {
        method: "PATCH",
        body: JSON.stringify({
          appointment_date: portalDateInput.value,
          appointment_time: portalTimeSelect.value,
        }),
      });
      renderPortalAppointment(updated);
      rescheduleControls.classList.add("d-none");
      setPortalMessage(updated.confirmation);
    } catch (error) {
      setPortalMessage(error.message, true);
    }
  });
  document.getElementById("cancelAppointmentBtn").addEventListener("click", async () => {
    if (!portalAppointment || !window.confirm("Cancel this appointment?")) return;
    try {
      const updated = await apiRequest(`/api/appointments/${encodeURIComponent(portalAppointment.token)}`, {
        method: "DELETE",
      });
      renderPortalAppointment(updated);
      setPortalMessage(updated.confirmation);
    } catch (error) {
      setPortalMessage(error.message, true);
    }
  });
}

const quickAppointmentInput = document.getElementById("appointmentTokenQuickLookup");
const quickAppointmentButton = document.getElementById("manageAppointmentQuickBtn");
const quickAppointmentMessage = document.getElementById("quickAppointmentMessage");
if (quickAppointmentInput && quickAppointmentButton) {
  const openAppointmentManager = async () => {
    const token = quickAppointmentInput.value.trim();
    if (!token) {
      quickAppointmentMessage.textContent = "Enter the token from your booking receipt.";
      quickAppointmentMessage.className = "small mt-2 text-danger";
      return;
    }
    document.getElementById("appointmentTokenLookup").value = token;
    try {
      const found = await lookupPortalAppointment();
      if (!found) {
        quickAppointmentMessage.textContent = "Appointment token was not found.";
        quickAppointmentMessage.className = "small mt-2 text-danger";
        return;
      }
      window.bootstrap.Modal.getOrCreateInstance(document.getElementById("bookingReceiptModal")).show();
      quickAppointmentMessage.textContent = "Appointment found. Use the controls in the dialog to reschedule or cancel.";
      quickAppointmentMessage.className = "small mt-2 text-success";
    } catch (error) {
      quickAppointmentMessage.textContent = error.message;
      quickAppointmentMessage.className = "small mt-2 text-danger";
    }
  };
  quickAppointmentButton.addEventListener("click", openAppointmentManager);
  quickAppointmentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openAppointmentManager();
  });
}

initializeBooking().catch((error) => showMessage(error.message));
apiRequest("/api/chat/status")
  .then((chatStatus) => {
    const badge = document.getElementById("groqChatStatus");
    if (!badge) return;
    badge.textContent = chatStatus.configured ? "ASSISTANT READY" : "API KEY NEEDED";
    badge.classList.toggle("is-unavailable", !chatStatus.configured);
  })
  .catch((error) => showMessage(error.message));

const adminTokenKey = "medicare_admin_token";
const adminDateFilter = document.getElementById("adminDateFilter");
const adminDoctorFilter = document.getElementById("adminDoctorFilter");
const adminStatusFilter = document.getElementById("adminStatusFilter");
const adminAppointmentRows = document.getElementById("adminAppointmentRows");
const adminAppointmentMessage = document.getElementById("adminAppointmentMessage");
const adminDashboard = document.getElementById("adminDashboard");
const adminNavItem = document.getElementById("adminNavItem");

function adminHeaders() {
  const token = window.sessionStorage.getItem(adminTokenKey);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function showAdminDashboard() {
  adminDashboard.classList.remove("d-none");
  adminNavItem.classList.remove("d-none");
  document.getElementById("adminDashboard").scrollIntoView({ behavior: "smooth" });
}

function adminFilters() {
  const params = new URLSearchParams();
  if (adminDateFilter.value) params.set("date", adminDateFilter.value);
  if (adminDoctorFilter.value) params.set("doctor_id", adminDoctorFilter.value);
  if (adminStatusFilter.value) params.set("status", adminStatusFilter.value);
  return params;
}

function adminStatusLabel(status) {
  return status === "demo_confirmed" ? "Confirmed" : status.charAt(0).toUpperCase() + status.slice(1);
}

function renderAdminAppointments(appointments) {
  adminAppointmentRows.replaceChildren();
  if (!appointments.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "text-secondary py-4";
    cell.textContent = "No appointments match these filters.";
    row.append(cell);
    adminAppointmentRows.append(row);
    return;
  }

  appointments.forEach((appointment) => {
    const row = document.createElement("tr");
    [
      `${appointment.appointment_time} IST`,
      appointment.patient_name,
      appointment.doctor,
      appointment.specialty,
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });

    const statusCell = document.createElement("td");
    statusCell.textContent = adminStatusLabel(appointment.status);
    statusCell.className = appointment.status === "demo_confirmed"
      ? "text-success fw-semibold"
      : appointment.status === "completed" ? "text-info fw-semibold" : "text-danger fw-semibold";
    row.append(statusCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "text-end";
    if (appointment.status === "demo_confirmed") {
      [
        ["completed", "Complete", "btn-outline-info"],
        ["cancelled", "Cancel", "btn-outline-danger"],
      ].forEach(([status, label, style]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn btn-sm ${style} ms-1`;
        button.textContent = label;
        button.addEventListener("click", () => updateAdminStatus(appointment.id, status));
        actionsCell.append(button);
      });
    } else {
      actionsCell.textContent = "No actions";
      actionsCell.classList.add("text-secondary", "small");
    }
    row.append(actionsCell);
    adminAppointmentRows.append(row);
  });
}

async function loadAdminAppointments() {
  adminAppointmentMessage.textContent = "Loading appointments…";
  try {
    const appointments = await apiRequest(`/api/admin/appointments?${adminFilters()}`, {
      headers: adminHeaders(),
    });
    renderAdminAppointments(appointments);
    adminAppointmentMessage.textContent = `${appointments.length} appointment${appointments.length === 1 ? "" : "s"} found.`;
  } catch (error) {
    adminAppointmentMessage.textContent = error.message;
    adminAppointmentMessage.className = "small text-danger mb-3";
  }
}

async function updateAdminStatus(appointmentId, nextStatus) {
  const confirmation = nextStatus === "cancelled"
    ? "Cancel this appointment?"
    : "Mark this appointment as completed?";
  if (!window.confirm(confirmation)) return;
  try {
    await apiRequest(`/api/admin/appointments/${encodeURIComponent(appointmentId)}/status`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadAdminAppointments();
    showMessage(`Appointment marked ${adminStatusLabel(nextStatus).toLowerCase()}.`);
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadAdminDoctors() {
  const availableDoctors = await apiRequest("/api/doctors");
  adminDoctorFilter.replaceChildren(new Option("All doctors", ""));
  availableDoctors.forEach((doctor) => {
    const option = document.createElement("option");
    option.value = doctor.id;
    option.textContent = doctor.name;
    adminDoctorFilter.append(option);
  });
}

async function restoreAdminSession() {
  if (!window.sessionStorage.getItem(adminTokenKey)) return;
  try {
    await apiRequest("/api/admin/session", { headers: adminHeaders() });
    showAdminDashboard();
    await loadAdminDoctors();
    await loadAdminAppointments();
  } catch {
    window.sessionStorage.removeItem(adminTokenKey);
    adminDashboard.classList.add("d-none");
    adminNavItem.classList.add("d-none");
  }
}

if (adminDateFilter && adminDoctorFilter && adminStatusFilter) {
  adminDateFilter.value = localDateString();
  [adminDateFilter, adminDoctorFilter, adminStatusFilter].forEach((filter) => {
    filter.addEventListener("change", loadAdminAppointments);
  });
  document.getElementById("exportAppointmentsBtn").addEventListener("click", async () => {
    try {
      const response = await fetch(`/api/admin/appointments.csv?${adminFilters()}`, {
        headers: adminHeaders(),
      });
      if (!response.ok) throw new Error("Could not export appointments.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = "appointments.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      showMessage(error.message);
    }
  });
}

const adminLoginForm = document.getElementById("adminLoginForm");
if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("adminLoginMessage");
    const submit = adminLoginForm.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const result = await apiRequest("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("adminLoginEmail").value,
          password: document.getElementById("adminLoginPassword").value,
        }),
      });
      window.sessionStorage.setItem(adminTokenKey, result.access_token);
      message.textContent = "Signed in successfully.";
      message.className = "small mt-3 text-success";
      window.bootstrap.Modal.getOrCreateInstance(document.getElementById("adminLoginModal")).hide();
      window.location.assign("/admin");
    } catch (error) {
      message.textContent = error.message;
      message.className = "small mt-3 text-danger";
    } finally {
      submit.disabled = false;
    }
  });
}

const adminNavLink = document.querySelector('a[href="#adminDashboard"]');
if (adminNavLink) {
  adminNavLink.addEventListener("click", (event) => {
    if (!window.sessionStorage.getItem(adminTokenKey)) {
      event.preventDefault();
      window.bootstrap.Modal.getOrCreateInstance(document.getElementById("adminLoginModal")).show();
    } else {
      window.location.assign("/admin");
    }
  });
}

restoreAdminSession();
