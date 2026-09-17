import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------------- Firebase init ---------------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const casesCol = collection(db, "cases");

/* ---------------- State ---------------- */
let cases = [];        // live cache of all case docs [{id, ...fields}]
let unsubscribeCases = null;
let calState = (() => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() }; // month: 0-11
})();
let selectedDayDate = null; // 'YYYY-MM-DD' currently open in day-modal

const CATEGORY_LABELS = {}; // not needed, using raw strings

/* ---------------- Date helpers ---------------- */
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return toDateStr(dt);
}
function fourWeeksFromToday() { return addDaysStr(todayStr(), 28); }
function formatKorDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${y}.${pad(m)}.${pad(d)} (${wd})`;
}
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));
}

/* ---------------- Auth ---------------- */
const loginScreen = document.getElementById("login-screen");
const appRoot = document.getElementById("app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const userEmailEl = document.getElementById("user-email");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "로그인 실패: 이메일 또는 비밀번호를 확인하세요.";
    console.error(err);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.hidden = true;
    appRoot.hidden = false;
    userEmailEl.textContent = user.email || "";
    startCasesListener();
  } else {
    loginScreen.hidden = false;
    appRoot.hidden = true;
    if (unsubscribeCases) { unsubscribeCases(); unsubscribeCases = null; }
    cases = [];
  }
});

function startCasesListener() {
  if (unsubscribeCases) return;
  unsubscribeCases = onSnapshot(casesCol, (snap) => {
    cases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => {
    console.error("Firestore 구독 오류:", err);
  });
}

/* ---------------- Tabs ---------------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    renderAll();
  });
});

function renderAll() {
  renderCaseTable();
  renderCalendar();
  renderResponseTab();
  updateResponseBadge();
}

/* ---------------- Derived helpers ---------------- */
/* 대응 의미: 상대방(피고)이 우리 측에 대응(답변/연락 등)해 오면 체크.
   한 명이라도 대응하면 "우리가 그 상대방에게 대응해야" 하므로 needsResponse = true. */
function defendantStats(kase) {
  const list = kase.defendants || [];
  const total = list.length;
  const responded = list.filter((d) => d.responded).length;
  const needsResponse = total > 0 && responded > 0;
  return { total, responded, needsResponse, complete: !needsResponse };
}
function clientRoleLabel(kase) {
  return kase.clientRole === "victim" ? "피해자" : "피의자";
}
function nextHearing(kase) {
  const list = (kase.hearings || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();
  return list.find((h) => h.date >= today) || list[list.length - 1] || null;
}
function hearingTypeLabel(t) { return t === "pleading" ? "변론기일" : "재판기일"; }

/* All hearings flattened, each carrying parent case ref */
function allHearingsFlat() {
  const out = [];
  for (const kase of cases) {
    for (const h of (kase.hearings || [])) {
      out.push({ ...h, case: kase });
    }
  }
  return out;
}

/* ---------------- Case table (사건 총집합) ---------------- */
const caseTableBody = document.getElementById("case-table-body");
const caseEmpty = document.getElementById("case-empty");
const caseSearch = document.getElementById("case-search");

caseSearch.addEventListener("input", renderCaseTable);

function renderCaseTable() {
  const q = caseSearch.value.trim().toLowerCase();
  const filtered = cases.filter((k) => {
    if (!q) return true;
    return [k.caseNumber, k.clientName, k.caseName].some((v) => (v || "").toLowerCase().includes(q));
  }).sort((a, b) => (a.caseNumber || "").localeCompare(b.caseNumber || ""));

  caseTableBody.innerHTML = "";
  caseEmpty.hidden = filtered.length > 0;

  for (const kase of filtered) {
    const stats = defendantStats(kase);
    const nh = nextHearing(kase);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(kase.caseNumber || "")}</td>
      <td>${escapeHtml(kase.caseName || "")}</td>
      <td>${escapeHtml(kase.clientName || "")}</td>
      <td><span class="badge ${kase.caseKind === "criminal" ? "badge-criminal" : "badge-civil"}">${kase.caseKind === "criminal" ? "형사" : "민사"}</span></td>
      <td>${clientRoleLabel(kase)}</td>
      <td>${escapeHtml(kase.category || "")}</td>
      <td>${escapeHtml(kase.court || "")}</td>
      <td>${kase.clientRole === "victim" ? stats.total : "-"}</td>
      <td>${kase.clientRole === "victim" ? `<span class="badge ${stats.needsResponse ? "badge-incomplete" : "badge-complete"}">${stats.responded}/${stats.total}</span>` : "-"}</td>
      <td>${nh ? `${formatKorDate(nh.date)} · ${hearingTypeLabel(nh.type)}` : "-"}</td>
      <td><button class="btn btn-sm row-open-btn">열기</button></td>
    `;
    tr.querySelector(".row-open-btn").addEventListener("click", (e) => { e.stopPropagation(); openCaseModal(kase.id); });
    tr.addEventListener("click", () => openCaseModal(kase.id));
    caseTableBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Case modal ---------------- */
const caseModal = document.getElementById("case-modal");
const caseForm = document.getElementById("case-form");
const caseModalTitle = document.getElementById("case-modal-title");
const deleteCaseBtn = document.getElementById("delete-case-btn");
const defendantListEl = document.getElementById("defendant-list");
const hearingListEl = document.getElementById("hearing-list");
const fCategory = document.getElementById("f-category");
const fCategoryCustomRow = document.getElementById("category-custom-row");
const fCategoryCustom = document.getElementById("f-category-custom");
const fCourt = document.getElementById("f-court");
const fCourtCustom = document.getElementById("f-court-custom");
const fCaseKind = document.getElementById("f-caseKind");
const fClientRole = document.getElementById("f-clientRole");
const defendantSectionEl = document.getElementById("defendant-section");

document.getElementById("new-case-btn").addEventListener("click", () => openCaseModal(null));

fCategory.addEventListener("change", () => {
  fCategoryCustomRow.hidden = fCategory.value !== "기타";
});
fClientRole.addEventListener("change", updateDefendantSectionVisibility);

function initClientRoleSelect() {
  fClientRole.innerHTML = `
    <option value="suspect">피의자</option>
    <option value="victim">피해자</option>
  `;
}
function updateDefendantSectionVisibility() {
  // 상대방(피고) 대응 현황은 의뢰인이 "피해자"인 사건에서만 의미가 있음
  defendantSectionEl.hidden = fClientRole.value !== "victim";
}

function openCaseModal(caseId) {
  caseForm.reset();
  defendantListEl.innerHTML = "";
  hearingListEl.innerHTML = "";
  fCategoryCustomRow.hidden = true;
  initClientRoleSelect();

  const kase = caseId ? cases.find((k) => k.id === caseId) : null;
  document.getElementById("case-id").value = caseId || "";
  caseModalTitle.textContent = kase ? "사건 수정" : "새 사건 등록";
  deleteCaseBtn.hidden = !kase;

  if (kase) {
    document.getElementById("f-caseNumber").value = kase.caseNumber || "";
    document.getElementById("f-caseName").value = kase.caseName || "";
    document.getElementById("f-clientName").value = kase.clientName || "";
    fCaseKind.value = kase.caseKind || "civil";
    fClientRole.value = kase.clientRole || "suspect";

    const presetCategories = Array.from(fCategory.options).map((o) => o.value);
    if (kase.category && !presetCategories.includes(kase.category)) {
      fCategory.value = "기타";
      fCategoryCustomRow.hidden = false;
      fCategoryCustom.value = kase.category;
    } else {
      fCategory.value = kase.category || "보이스피싱";
    }

    const presetCourts = Array.from(fCourt.options).map((o) => o.value);
    if (kase.court && !presetCourts.includes(kase.court)) {
      fCourt.value = "기타";
      fCourtCustom.value = kase.court;
    } else {
      fCourt.value = kase.court || "서울중앙지방법원";
    }

    (kase.defendants || []).forEach((d) => addDefendantRow(d.name, d.responded));
    (kase.hearings || []).forEach((h) => addHearingRow(h.id, h.date, h.type, h.note));
  } else {
    fClientRole.value = "suspect";
  }

  updateDefendantSectionVisibility();
  caseModal.hidden = false;
}

document.getElementById("add-defendant-btn").addEventListener("click", () => addDefendantRow("", false));
document.getElementById("add-hearing-btn").addEventListener("click", () => addHearingRow(uid(), "", "trial", ""));

function addDefendantRow(name, responded) {
  const row = document.createElement("div");
  row.className = "defendant-row";
  row.innerHTML = `
    <input type="text" placeholder="피고 이름 (선택)" value="${escapeHtml(name || "")}" />
    <label style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:12px;white-space:nowrap;">
      <input type="checkbox" ${responded ? "checked" : ""} /> 대응함
    </label>
    <button type="button" class="row-remove-btn">×</button>
  `;
  row.querySelector(".row-remove-btn").addEventListener("click", () => row.remove());
  defendantListEl.appendChild(row);
}

function addHearingRow(id, date, type, note) {
  const row = document.createElement("div");
  row.className = "hearing-row";
  row.dataset.id = id || uid();
  row.innerHTML = `
    <input type="date" value="${date || ""}" required />
    <select>
      <option value="trial" ${type !== "pleading" ? "selected" : ""}>재판기일</option>
      <option value="pleading" ${type === "pleading" ? "selected" : ""}>변론기일</option>
    </select>
    <input type="text" placeholder="메모 (선택)" value="${escapeHtml(note || "")}" />
    <button type="button" class="row-remove-btn">×</button>
  `;
  row.querySelector(".row-remove-btn").addEventListener("click", () => row.remove());
  hearingListEl.appendChild(row);
}

function collectDefendants() {
  // 의뢰인이 "피해자"가 아닌 사건은 상대방 대응 현황을 추적하지 않음
  if (fClientRole.value !== "victim") return [];
  return Array.from(defendantListEl.querySelectorAll(".defendant-row")).map((row) => ({
    name: row.querySelector('input[type="text"]').value.trim(),
    responded: row.querySelector('input[type="checkbox"]').checked
  }));
}
function collectHearings() {
  return Array.from(hearingListEl.querySelectorAll(".hearing-row"))
    .map((row) => ({
      id: row.dataset.id,
      date: row.querySelector('input[type="date"]').value,
      type: row.querySelector("select").value,
      note: row.querySelector('input[type="text"]').value.trim()
    }))
    .filter((h) => h.date); // 날짜 비어있는 행은 저장하지 않음
}

caseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("case-id").value;
  const category = fCategory.value === "기타" ? fCategoryCustom.value.trim() : fCategory.value;
  const court = fCourt.value === "기타" ? fCourtCustom.value.trim() : fCourt.value;

  const payload = {
    caseNumber: document.getElementById("f-caseNumber").value.trim(),
    caseName: document.getElementById("f-caseName").value.trim(),
    clientName: document.getElementById("f-clientName").value.trim(),
    caseKind: fCaseKind.value,
    clientRole: fClientRole.value,
    category,
    court,
    defendants: collectDefendants(),
    hearings: collectHearings(),
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "cases", id), payload);
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(casesCol, payload);
    }
    closeModal("case-modal");
  } catch (err) {
    alert("저장 중 오류가 발생했습니다: " + err.message);
    console.error(err);
  }
});

deleteCaseBtn.addEventListener("click", async () => {
  const id = document.getElementById("case-id").value;
  if (!id) return;
  if (!confirm("이 사건을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
  try {
    await deleteDoc(doc(db, "cases", id));
    closeModal("case-modal");
  } catch (err) {
    alert("삭제 중 오류가 발생했습니다: " + err.message);
  }
});

/* ---------------- Modal generic close ---------------- */
document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => closeModal(el.dataset.close));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.hidden = true; });
});
function closeModal(id) { document.getElementById(id).hidden = true; }

/* ---------------- Calendar (캘린더) ---------------- */
const calendarGrid = document.getElementById("calendar-grid");
const calendarTitle = document.getElementById("calendar-title");

document.getElementById("cal-prev").addEventListener("click", () => { shiftMonth(-1); });
document.getElementById("cal-next").addEventListener("click", () => { shiftMonth(1); });
document.getElementById("cal-today").addEventListener("click", () => {
  const now = new Date();
  calState = { year: now.getFullYear(), month: now.getMonth() };
  renderCalendar();
});
function shiftMonth(delta) {
  let m = calState.month + delta, y = calState.year;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  calState = { year: y, month: m };
  renderCalendar();
}

function renderCalendar() {
  const { year, month } = calState;
  calendarTitle.textContent = `${year}년 ${month + 1}월`;

  // map date -> [hearing entries]
  const byDate = {};
  for (const h of allHearingsFlat()) {
    (byDate[h.date] ||= []).push(h);
  }

  calendarGrid.innerHTML = "";
  ["일", "월", "화", "수", "목", "금", "토"].forEach((w) => {
    const el = document.createElement("div");
    el.className = "cal-weekday";
    el.textContent = w;
    calendarGrid.appendChild(el);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();
  const upcomingLimit = fourWeeksFromToday();

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "cal-day cal-day-empty";
    calendarGrid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
    const cell = document.createElement("div");
    cell.className = "cal-day" + (dateStr === today ? " cal-day-today" : "");
    const num = document.createElement("div");
    num.className = "cal-day-num";
    num.textContent = day;
    cell.appendChild(num);

    const events = byDate[dateStr] || [];
    for (const h of events.slice(0, 3)) {
      const stats = defendantStats(h.case);
      const isVictimCase = h.case.clientRole === "victim";
      const isUpcoming = dateStr >= today && dateStr <= upcomingLimit;
      const evEl = document.createElement("div");
      evEl.className = "cal-event " + (isVictimCase && stats.needsResponse ? "incomplete" : "") + (isUpcoming ? " upcoming" : "");
      const ratioText = isVictimCase ? ` (${stats.responded}/${stats.total})` : "";
      evEl.textContent = `${hearingTypeLabel(h.type)} · ${h.case.caseName || h.case.caseNumber}${ratioText}`;
      evEl.title = `${h.case.caseNumber} · ${h.case.clientName || ""}`;
      evEl.addEventListener("click", (e) => { e.stopPropagation(); openCaseModal(h.case.id); });
      cell.appendChild(evEl);
    }
    if (events.length > 3) {
      const more = document.createElement("div");
      more.className = "cal-event";
      more.style.background = "transparent";
      more.style.color = "var(--color-text-muted)";
      more.textContent = `+${events.length - 3}건 더보기`;
      cell.appendChild(more);
    }

    cell.addEventListener("click", () => openDayModal(dateStr));
    calendarGrid.appendChild(cell);
  }
}

/* ---------------- Day modal (특정 날짜에 기일 추가) ---------------- */
const dayModal = document.getElementById("day-modal");
const dayModalTitle = document.getElementById("day-modal-title");
const dayHearingList = document.getElementById("day-hearing-list");
const dayCaseSelect = document.getElementById("day-case-select");

function openDayModal(dateStr) {
  selectedDayDate = dateStr;
  dayModalTitle.textContent = `${formatKorDate(dateStr)} 기일`;

  dayHearingList.innerHTML = "";
  const todaysHearings = allHearingsFlat().filter((h) => h.date === dateStr);
  if (!todaysHearings.length) {
    dayHearingList.innerHTML = `<p class="form-hint" style="margin:0;">이 날짜에 등록된 기일이 없습니다.</p>`;
  } else {
    for (const h of todaysHearings) {
      const stats = defendantStats(h.case);
      const isVictimCase = h.case.clientRole === "victim";
      const item = document.createElement("div");
      item.className = "day-hearing-item";
      item.innerHTML = `
        <span>${hearingTypeLabel(h.type)} · ${escapeHtml(h.case.caseName || h.case.caseNumber)}
          ${isVictimCase ? `<span class="badge ${stats.needsResponse ? "badge-incomplete" : "badge-complete"}">${stats.responded}/${stats.total}</span>` : ""}
        </span>
        <button type="button" class="btn btn-sm">사건 열기</button>
      `;
      item.querySelector("button").addEventListener("click", () => { closeModal("day-modal"); openCaseModal(h.case.id); });
      dayHearingList.appendChild(item);
    }
  }

  dayCaseSelect.innerHTML = cases
    .slice()
    .sort((a, b) => (a.caseNumber || "").localeCompare(b.caseNumber || ""))
    .map((k) => `<option value="${k.id}">${escapeHtml(k.caseNumber || "")} · ${escapeHtml(k.caseName || "")}</option>`)
    .join("");

  document.getElementById("day-hearing-note").value = "";
  dayModal.hidden = false;
}

document.getElementById("day-add-hearing-btn").addEventListener("click", async () => {
  const caseId = dayCaseSelect.value;
  if (!caseId) { alert("먼저 사건을 등록하세요."); return; }
  const kase = cases.find((k) => k.id === caseId);
  if (!kase) return;
  const type = document.getElementById("day-hearing-type").value;
  const note = document.getElementById("day-hearing-note").value.trim();
  const newHearing = { id: uid(), date: selectedDayDate, type, note };
  const hearings = [...(kase.hearings || []), newHearing];
  try {
    await updateDoc(doc(db, "cases", caseId), { hearings, updatedAt: serverTimestamp() });
    openDayModal(selectedDayDate); // refresh list in place
  } catch (err) {
    alert("저장 중 오류: " + err.message);
  }
});

/* ---------------- Response tab (대응 필요) ---------------- */
const responseList = document.getElementById("response-list");
const responseEmpty = document.getElementById("response-empty");
const responseCountBadge = document.getElementById("response-count-badge");

/* 사건(케이스) 단위로 1건씩만 집계: 상대방(피고) 중 한 명이라도 대응했으면 그 사건 전체가 대상.
   피해자 사건이 아니면(= 상대방 대응 추적 대상이 아니면) 애초에 제외됨. */
function casesNeedingResponse() {
  return cases
    .filter((k) => k.clientRole === "victim")
    .map((k) => ({ case: k, stats: defendantStats(k), nh: nextHearing(k) }))
    .filter((x) => x.stats.needsResponse)
    .sort((a, b) => {
      const ad = a.nh ? a.nh.date : "9999-99-99";
      const bd = b.nh ? b.nh.date : "9999-99-99";
      return ad.localeCompare(bd);
    });
}

function renderResponseTab() {
  const list = casesNeedingResponse();
  responseList.innerHTML = "";
  responseEmpty.hidden = list.length > 0;

  for (const { case: kase, stats, nh } of list) {
    const card = document.createElement("div");
    card.className = "response-card";
    card.innerHTML = `
      <div class="response-card-main">
        <span class="response-card-title">${escapeHtml(kase.caseName || kase.caseNumber)} <span class="badge ${kase.caseKind === "criminal" ? "badge-criminal" : "badge-civil"}">${kase.caseKind === "criminal" ? "형사" : "민사"}</span></span>
        <span class="response-card-meta">${escapeHtml(kase.caseNumber || "")} · ${escapeHtml(kase.clientName || "")} · ${escapeHtml(kase.court || "")}</span>
        <span class="response-card-meta">${nh ? `${formatKorDate(nh.date)} · ${hearingTypeLabel(nh.type)} 예정` : "등록된 기일 없음"}</span>
      </div>
      <div class="response-card-ratio">${stats.responded}/${stats.total}</div>
    `;
    card.addEventListener("click", () => openCaseModal(kase.id));
    responseList.appendChild(card);
  }
}

function updateResponseBadge() {
  const count = casesNeedingResponse().length;
  responseCountBadge.hidden = count === 0;
  responseCountBadge.textContent = count;
}
