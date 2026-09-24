import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------------- Firebase init ---------------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const mattersCol = collection(db, "matters");
const globalMemoRef = doc(db, "meta", "globalMemo");

/* ---------------- State ---------------- */
let matters = [];       // live cache of all matter docs [{id, ...fields}]
let unsubscribeMatters = null;
let unsubscribeMemo = null;
let calState = (() => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() }; // month: 0-11
})();

const HEARING_TYPES = ["변론기일", "선고기일", "조정기일", "심문기일", "기타"];
const LAWYERS = ["대표님", "천솔비", "김도영"];
const FILING_TYPES = ["소장", "고소장", "가압류신청서", "기타"];
const SUBMISSION_TYPES = ["준비서면", "답변서", "의견서", "기타"];

const STATUS_LABEL = { unfiled: "미접수", filed: "접수사건", inprogress: "진행사건", completed: "완료사건" };
const STATUS_ORDER = ["unfiled", "filed", "inprogress", "completed"];

/* ---------------- Date helpers ---------------- */
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function formatKorDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${y}.${pad(m)}.${pad(d)} (${wd})`;
}
function formatTimestampKorDate(ts) {
  if (!ts) return "-";
  const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "-";
  return formatKorDate(toDateStr(d));
}
function daysBetween(aStr, bStr) {
  const [ay, am, ad] = aStr.split("-").map(Number);
  const [by, bm, bd] = bStr.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function timestampToISO(v) {
  if (v && typeof v.toDate === "function") return v.toDate().toISOString();
  return v || null;
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
    startMattersListener();
    startMemoListener();
  } else {
    loginScreen.hidden = false;
    appRoot.hidden = true;
    if (unsubscribeMatters) { unsubscribeMatters(); unsubscribeMatters = null; }
    if (unsubscribeMemo) { unsubscribeMemo(); unsubscribeMemo = null; }
    matters = [];
  }
});

function startMattersListener() {
  if (unsubscribeMatters) return;
  unsubscribeMatters = onSnapshot(mattersCol, (snap) => {
    matters = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("Firestore 구독 오류:", err));
}

/* ---------------- Global pinned memo ---------------- */
const globalMemoEl = document.getElementById("global-memo");
let memoSaveTimer = null;
let suppressMemoEcho = false;

function startMemoListener() {
  if (unsubscribeMemo) return;
  unsubscribeMemo = onSnapshot(globalMemoRef, (snap) => {
    if (suppressMemoEcho) return;
    const text = snap.exists() ? (snap.data().text || "") : "";
    if (document.activeElement !== globalMemoEl) globalMemoEl.value = text;
  }, (err) => console.error("메모 구독 오류:", err));
}
globalMemoEl.addEventListener("input", () => {
  clearTimeout(memoSaveTimer);
  memoSaveTimer = setTimeout(async () => {
    suppressMemoEcho = true;
    try {
      await setDoc(globalMemoRef, { text: globalMemoEl.value, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) {
      console.error("메모 저장 오류:", err);
    } finally {
      setTimeout(() => { suppressMemoEcho = false; }, 300);
    }
  }, 500);
});

/* ---------------- Tabs ---------------- */
function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tabName));
  renderAll();
}
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function renderAll() {
  renderCaseTable();
  renderCalendar();
  renderClosedTab();
  updateClosedBadge();
}

/* ---------------- 상태 자동분류 ----------------
   [민사/가사/기타가 하나라도 섞인 경우 — 접수서류 기준 경로]
   1) 미접수: 사건번호(사건수)가 없거나, 접수서류 건수가 사건수보다 적으면(=아직 다 접수 안 됨) 무조건 미접수.
   2) 접수사건: 접수서류 건수가 사건수 이상으로 맞춰지면 접수사건.
   3) 진행사건: 접수사건 상태에서 기일/제출서류/상대방 제출서류 중 하나라도 등록되면 진행사건.
   4) 완료사건: 그중 선고기일 종류의 기일이 등록되어 있고, 그 날짜가 오늘보다 이전이면 완료사건.

   [형사만 단독으로 체크된 경우 — 접수서류 개념이 없으므로 별도 경로]
   1) 미접수: 기일/제출서류/상대방 제출서류가 하나도 없으면 미접수.
   2) 진행사건: 위 셋 중 하나라도 등록되면 바로 진행사건 (사건번호·접수서류 매칭 단계 생략).
   3) 완료사건: 그중 선고기일이 등록되어 있고 날짜가 오늘보다 이전이면 완료사건.

   (형사 진행현황은 표시용일 뿐 자동분류 계산에는 관여하지 않습니다.) */
function computeAutoStatusFromParts({ kind, subCases, filings, hearings, ourFilings, oppFilings }) {
  const today = todayStr();
  const hasProgressSignal = (hearings && hearings.length > 0) || (ourFilings && ourFilings.length > 0) || (oppFilings && oppFilings.length > 0);
  const hasPastVerdict = (hearings || []).some((h) => h.type === "선고기일" && h.date && h.date < today);

  const isCriminalOnly = !!(kind && kind.criminal && !kind.civil && !kind.family && !kind.other);
  if (isCriminalOnly) {
    if (!hasProgressSignal) return "unfiled";
    return hasPastVerdict ? "completed" : "inprogress";
  }

  const subCaseCount = (subCases || []).filter((s) => (s.caseNumber || "").trim()).length;
  const filingCount = (filings || []).length;

  if (subCaseCount === 0 || filingCount < subCaseCount) return "unfiled";
  if (!hasProgressSignal) return "filed";
  return hasPastVerdict ? "completed" : "inprogress";
}
function computeAutoStatus(m) {
  return computeAutoStatusFromParts({
    kind: m.kind || {}, subCases: m.subCases || [], filings: m.filings || [], hearings: m.hearings || [],
    ourFilings: m.ourFilings || [], oppFilings: m.oppFilings || []
  });
}
function effectiveStatus(m) {
  if (m.statusMode === "manual" && m.manualStatus) return m.manualStatus;
  return computeAutoStatus(m);
}

/* ---------------- 표시용 도우미 ---------------- */
function kindLabelHtml(kind, criminalProgress) {
  if (!kind) return `<span class="cell-empty">-</span>`;
  const parts = [];
  if (kind.civil) parts.push(`<span class="badge badge-civil">민사</span>`);
  if (kind.criminal) {
    const cp = criminalProgress || "";
    parts.push(`<span class="badge badge-criminal">형사${cp ? " · " + escapeHtml(cp) : ""}</span>`);
  }
  if (kind.family) parts.push(`<span class="badge badge-family">가사</span>`);
  if (kind.other) parts.push(`<span class="badge badge-other-kind">${escapeHtml(kind.otherText || "기타")}</span>`);
  if (!parts.length) return `<span class="cell-empty">-</span>`;
  return `<div class="cell-stack">${parts.join("")}</div>`;
}
function firstPersonName(m) {
  return (m.plaintiffs && m.plaintiffs[0] && m.plaintiffs[0].name) ||
         (m.respondents && m.respondents[0] && m.respondents[0].name) || "";
}
/* 원고/피해자·피고/피고인 칸은 각각 "의뢰인" 또는 "상대방"으로 통째로 지정됩니다
   (칸 안의 개별 인원마다 구분하지 않음). 아래 두 함수는 그 지정에 따라 의뢰인 쪽/상대방 쪽
   인원 목록을 모아줍니다. */
function clientPeople(m) {
  const list = [];
  if ((m.plaintiffsRole || "client") === "client") list.push(...(m.plaintiffs || []));
  if ((m.respondentsRole || "opponent") === "client") list.push(...(m.respondents || []));
  return list;
}
function opponentPeople(m) {
  const list = [];
  if ((m.plaintiffsRole || "client") === "opponent") list.push(...(m.plaintiffs || []));
  if ((m.respondentsRole || "opponent") === "opponent") list.push(...(m.respondents || []));
  return list;
}
function stackCell(items, renderFn, limit = 3) {
  if (!items || !items.length) return `<span class="cell-empty">-</span>`;
  const shown = items.slice(0, limit).map((it) => `<div class="cell-stack-item">${renderFn(it)}</div>`).join("");
  const more = items.length > limit ? `<div class="cell-more">+${items.length - limit}건 더보기</div>` : "";
  return `<div class="cell-stack">${shown}${more}</div>`;
}
function matchesSearch(m, q) {
  if (!q) return true;
  const haystacks = [];
  (m.subCases || []).forEach((s) => haystacks.push(s.agency, s.caseNumber, s.caseName));
  (m.plaintiffs || []).forEach((p) => haystacks.push(p.name));
  (m.respondents || []).forEach((r) => haystacks.push(r.name));
  return haystacks.some((v) => (v || "").toLowerCase().includes(q));
}

/* ---------------- 사건관리 탭 ---------------- */
const caseTableBody = document.getElementById("case-table-body");
const caseEmpty = document.getElementById("case-empty");
const caseSearch = document.getElementById("case-search");
const caseSubtabsEl = document.getElementById("case-subtabs");

let caseSubtab = "all";

caseSearch.addEventListener("input", renderCaseTable);

caseSubtabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".subtab-btn");
  if (!btn) return;
  caseSubtab = btn.dataset.subtab;
  caseSubtabsEl.querySelectorAll(".subtab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  renderCaseTable();
});

function filteredSortedMatters() {
  const q = caseSearch.value.trim().toLowerCase();
  let list = matters.filter((m) => !m.closed).filter((m) => matchesSearch(m, q));
  list = list.filter((m) => {
    switch (caseSubtab) {
      case "unfiled": return effectiveStatus(m) === "unfiled";
      case "filed": return effectiveStatus(m) === "filed";
      case "inprogress": return effectiveStatus(m) === "inprogress";
      case "completed": return effectiveStatus(m) === "completed";
      case "lawyer-천솔비": return m.lawyer === "천솔비";
      case "lawyer-김도영": return m.lawyer === "김도영";
      default: return true;
    }
  });
  list.sort((a, b) => firstPersonName(a).localeCompare(firstPersonName(b), "ko"));
  return list;
}

function renderCaseTable() {
  const filtered = filteredSortedMatters();
  caseTableBody.innerHTML = "";
  caseEmpty.hidden = filtered.length > 0;

  filtered.forEach((m, idx) => {
    const status = effectiveStatus(m);
    const statusTag = m.statusMode === "manual" ? `<span class="status-manual-tag">(수동)</span>` : "";
    const sortedHearings = (m.hearings || []).filter((h) => h.date).slice().sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const sortedCorrections = (m.corrections || []).slice().sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="nowrap">${idx + 1}</td>
      <td class="nowrap"><span class="badge badge-status-${status}">${STATUS_LABEL[status]}</span>${statusTag}</td>
      <td>${kindLabelHtml(m.kind, m.criminalProgress)}</td>
      <td>${stackCell(m.subCases, (s) => `<span title="${escapeHtml(s.caseName || "")}">${escapeHtml(s.agency || "")} ${escapeHtml(s.caseNumber || "")}</span>`)}</td>
      <td>${stackCell(m.plaintiffs, (p) => `<span class="chip-person ${(m.plaintiffsRole || "client") === "client" ? "chip-client" : "chip-opponent"}">${escapeHtml(p.name)}</span>`)}</td>
      <td>${stackCell(m.respondents, (r) => `<span class="chip-person ${(m.respondentsRole || "opponent") === "client" ? "chip-client" : "chip-opponent"}">${escapeHtml(r.name)}</span>`)}</td>
      <td class="nowrap">${escapeHtml(m.lawyer || "-")}</td>
      <td>${stackCell(m.filings, (f) => `${f.date ? formatKorDate(f.date) + " · " : ""}${escapeHtml(docLabel(f))}`)}</td>
      <td>${stackCell(sortedCorrections, (c) => {
        const diff = c.deadline ? daysBetween(todayStr(), c.deadline) : null;
        let cls = "badge-dday-neutral", text = "";
        if (c.submitted || c.submittedDate) { cls = "badge-dday-done"; text = "제출완료"; }
        else if (diff !== null) {
          cls = diff < 0 ? "badge-dday-danger" : diff <= 3 ? "badge-dday-warning" : "badge-dday-neutral";
          text = diff === 0 ? "D-DAY" : diff > 0 ? `D-${diff}` : `D+${-diff}`;
        }
        return `${escapeHtml(c.name || "보정명령")}${text ? ` <span class="badge badge-dday ${cls}">${text}</span>` : ""}`;
      })}</td>
      <td>${stackCell(sortedHearings, (h) => `<span class="badge ${h.type === "선고기일" ? "badge-hearing-verdict" : "badge-hearing-other"}">${escapeHtml(h.type || "기일")}</span> ${formatKorDate(h.date)}${h.time ? " " + h.time : ""}`)}</td>
      <td>${stackCell(m.ourFilings, (f) => `${f.date ? formatKorDate(f.date) + " · " : ""}${escapeHtml(docLabel(f))}`)}</td>
      <td>${stackCell(m.oppFilings, (f) => `${f.date ? formatKorDate(f.date) + " · " : ""}${escapeHtml(docLabel(f))}${f.submitter ? ` (${escapeHtml(f.submitter)})` : ""}`)}</td>
      <td>${(m.notes && m.notes.length) ? escapeHtml((m.notes[m.notes.length - 1].text || "").slice(0, 30)) + (m.notes.length > 1 ? ` 외 ${m.notes.length - 1}건` : "") : `<span class="cell-empty">-</span>`}</td>
      <td class="nowrap">
        <button class="btn btn-sm row-open-btn">열기</button>
        <button class="btn btn-sm btn-warning row-close-btn">종결</button>
      </td>
    `;
    tr.querySelector(".row-open-btn").addEventListener("click", (e) => { e.stopPropagation(); openCaseModal(m.id); });
    tr.querySelector(".row-close-btn").addEventListener("click", (e) => { e.stopPropagation(); closeCase(m.id); });
    tr.addEventListener("click", () => openCaseModal(m.id));
    caseTableBody.appendChild(tr);
  });
}

/* ---------------- 백업 다운로드 (CSV / JSON) ---------------- */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function joinList(items, fn) { return (items || []).map(fn).join("; "); }

function exportCasesCSV() {
  const headers = ["번호", "상태", "구분", "사건번호", "원고/피해자", "피고/피고인", "담당변호사", "접수서류", "보정명령", "기일", "제출서류", "상대방 제출서류", "메모"];
  const rows = [headers];
  const sorted = matters.slice().sort((a, b) => firstPersonName(a).localeCompare(firstPersonName(b), "ko"));
  for (const m of sorted) {
    const kindParts = [];
    if (m.kind?.civil) kindParts.push("민사");
    if (m.kind?.criminal) kindParts.push("형사" + (m.criminalProgress ? `(${m.criminalProgress})` : ""));
    if (m.kind?.family) kindParts.push("가사");
    if (m.kind?.other) kindParts.push(m.kind.otherText || "기타");
    rows.push([
      "", // 번호는 다운로드 시점의 표시 순서와 무관하므로 비움
      m.closed ? "종결" : STATUS_LABEL[effectiveStatus(m)],
      kindParts.join("/"),
      joinList(m.subCases, (s) => `${s.agency || ""} ${s.caseNumber || ""}${s.caseName ? "(" + s.caseName + ")" : ""}`),
      joinList(m.plaintiffs, (p) => p.name),
      joinList(m.respondents, (r) => r.name),
      m.lawyer || "",
      joinList(m.filings, (f) => `${f.date || ""} ${docLabel(f)}`),
      joinList(m.corrections, (c) => `${c.name || ""}(송달:${c.date || "-"},마감:${c.deadline || "-"}${c.submittedDate ? ",제출:" + c.submittedDate : ""}${(c.submitted || c.submittedDate) ? ",제출완료" : ""})`),
      joinList(m.hearings, (h) => `${h.date || ""} ${h.time || ""} ${h.type || ""}`),
      joinList(m.ourFilings, (f) => `${f.date || ""} ${docLabel(f)}`),
      joinList(m.oppFilings, (f) => `${f.date || ""} ${docLabel(f)}${f.submitter ? "(" + f.submitter + ")" : ""}`),
      joinList(m.notes, (n) => `${n.date || ""} ${n.text || ""}`)
    ]);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const bom = "﻿"; // 엑셀에서 한글 깨짐 방지
  downloadFile(`사건목록_백업_${todayStr()}.csv`, bom + csv, "text/csv;charset=utf-8;");
}
function exportCasesJSON() {
  const data = matters.map((m) => {
    const { id, createdAt, updatedAt, closedAt, ...rest } = m;
    return { id, ...rest, createdAt: timestampToISO(createdAt), updatedAt: timestampToISO(updatedAt), closedAt: timestampToISO(closedAt) };
  });
  downloadFile(`사건목록_백업_${todayStr()}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8;");
}
document.getElementById("export-csv-btn").addEventListener("click", exportCasesCSV);
document.getElementById("export-json-btn").addEventListener("click", exportCasesJSON);

/* ---------------- 사건 등록/편집 모달 ---------------- */
const caseModal = document.getElementById("case-modal");
const caseForm = document.getElementById("case-form");
const caseModalTitle = document.getElementById("case-modal-title");
const deleteCaseBtn = document.getElementById("delete-case-btn");
const closeCaseBtn = document.getElementById("close-case-btn");

const statusBadgeEl = document.getElementById("status-badge");
const fStatusManual = document.getElementById("f-status-manual");
const statusOverrideBtn = document.getElementById("status-override-btn");
const statusAutoBtn = document.getElementById("status-auto-btn");
const statusAutoHint = document.getElementById("status-auto-hint");

const fKindCivil = document.getElementById("f-kind-civil");
const fKindCriminal = document.getElementById("f-kind-criminal");
const fKindFamily = document.getElementById("f-kind-family");
const fKindOther = document.getElementById("f-kind-other");
const fKindOtherText = document.getElementById("f-kind-other-text");
const criminalProgressRow = document.getElementById("criminal-progress-row");
const fCriminalProgress = document.getElementById("f-criminal-progress");

const fLawyer = document.getElementById("f-lawyer");

const fPlaintiffsRole = document.getElementById("f-plaintiffs-role");
const fRespondentsRole = document.getElementById("f-respondents-role");

const subcaseListEl = document.getElementById("subcase-list");
const plaintiffListEl = document.getElementById("plaintiff-list");
const respondentListEl = document.getElementById("respondent-list");
const filingListEl = document.getElementById("filing-list");
const correctionListEl = document.getElementById("correction-list");
const hearingListEl = document.getElementById("hearing-list");
const ourfilingListEl = document.getElementById("ourfiling-list");
const oppfilingListEl = document.getElementById("oppfiling-list");
const noteListEl = document.getElementById("note-list");

let modalStatusMode = "auto";
let modalManualStatus = "unfiled";

document.getElementById("new-case-btn").addEventListener("click", () => openCaseModal(null));

/* ---- 구분 체크박스 ---- */
function updateKindUI() {
  fKindOtherText.hidden = !fKindOther.checked;
  criminalProgressRow.hidden = !fKindCriminal.checked;
}
[fKindCivil, fKindCriminal, fKindFamily, fKindOther].forEach((cb) => {
  cb.addEventListener("change", () => { updateKindUI(); refreshStatusBadge(); });
});
fCriminalProgress.addEventListener("change", refreshStatusBadge);

/* ---- 상태 자동/수동 ---- */
function currentDraftParts() {
  return {
    kind: collectKind(),
    subCases: collectSubcases(),
    filings: collectFilings(),
    hearings: collectHearings(),
    ourFilings: collectOurFilings(),
    oppFilings: collectOppFilings()
  };
}
function refreshStatusBadge() {
  const autoStatus = computeAutoStatusFromParts(currentDraftParts());
  const effective = modalStatusMode === "manual" ? modalManualStatus : autoStatus;
  statusBadgeEl.textContent = STATUS_LABEL[effective] + (modalStatusMode === "manual" ? " (수동)" : "");
  statusBadgeEl.className = "badge badge-status badge-status-" + effective;
  fStatusManual.value = effective;
  statusAutoBtn.hidden = modalStatusMode !== "manual";
  statusAutoHint.textContent = modalStatusMode === "manual"
    ? "수동으로 상태를 고정했습니다. 데이터가 바뀌어도 자동으로는 바뀌지 않습니다."
    : "현재 자동으로 분류되고 있습니다 (구분/사건번호/기일/진행현황에 따라 자동으로 바뀝니다).";
}
statusOverrideBtn.addEventListener("click", () => {
  modalStatusMode = "manual";
  modalManualStatus = fStatusManual.value;
  refreshStatusBadge();
});
statusAutoBtn.addEventListener("click", () => {
  modalStatusMode = "auto";
  refreshStatusBadge();
});
fStatusManual.addEventListener("change", () => {
  if (modalStatusMode === "manual") {
    modalManualStatus = fStatusManual.value;
    refreshStatusBadge();
  }
});

/* ---- 제출자 자동완성 (상대방 제출서류) ---- */
function ensureSubmitterDatalist() {
  let dl = document.getElementById("submitter-datalist");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "submitter-datalist";
    document.body.appendChild(dl);
  }
  return dl;
}
function refreshSubmitterDatalist() {
  const dl = ensureSubmitterDatalist();
  const names = [];
  if (fPlaintiffsRole.value === "opponent") {
    names.push(...Array.from(plaintiffListEl.querySelectorAll('[data-field="name"]')).map((i) => i.value.trim()));
  }
  if (fRespondentsRole.value === "opponent") {
    names.push(...Array.from(respondentListEl.querySelectorAll('[data-field="name"]')).map((i) => i.value.trim()));
  }
  dl.innerHTML = names.filter(Boolean).map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}
fPlaintiffsRole.addEventListener("change", refreshSubmitterDatalist);
fRespondentsRole.addEventListener("change", refreshSubmitterDatalist);
plaintiffListEl.addEventListener("input", refreshSubmitterDatalist);

/* ---- 공통: 행 생성 도우미 ---- */
function appendSubrow(container, innerHtml, onRemove) {
  const row = document.createElement("div");
  row.className = "subrow";
  row.innerHTML = innerHtml + `<button type="button" class="row-remove-btn">×</button>`;
  row.querySelector(".row-remove-btn").addEventListener("click", () => {
    row.remove();
    if (onRemove) onRemove();
    refreshStatusBadge();
  });
  container.appendChild(row);
  return row;
}
function fieldVal(row, field) {
  const el = row.querySelector(`[data-field="${field}"]`);
  if (!el) return "";
  if (el.type === "checkbox") return el.checked;
  return el.value.trim ? el.value.trim() : el.value;
}
function rowsOf(container) { return Array.from(container.querySelectorAll(".subrow")); }

/* ---- 사건번호 (subCases) ---- */
document.getElementById("add-subcase-btn").addEventListener("click", () => addSubcaseRow());
subcaseListEl.addEventListener("input", refreshStatusBadge);
function addSubcaseRow(s = {}) {
  appendSubrow(subcaseListEl, `
    <input type="text" data-field="agency" placeholder="관할기관 (예: 서울중앙지방법원)" value="${escapeHtml(s.agency || "")}" />
    <input type="text" data-field="caseNumber" placeholder="사건번호 (예: 2024가단12345)" value="${escapeHtml(s.caseNumber || "")}" />
    <input type="text" data-field="caseName" placeholder="사건명" value="${escapeHtml(s.caseName || "")}" />
  `);
}
function collectSubcases() {
  return rowsOf(subcaseListEl)
    .map((row) => ({ id: row.dataset.id || uid(), agency: fieldVal(row, "agency"), caseNumber: fieldVal(row, "caseNumber"), caseName: fieldVal(row, "caseName") }))
    .filter((s) => s.agency || s.caseNumber || s.caseName);
}

/* ---- 원고/피해자 (plaintiffs) ---- */
document.getElementById("add-plaintiff-btn").addEventListener("click", () => addPlaintiffRow());
function addPlaintiffRow(p = {}) {
  appendSubrow(plaintiffListEl, `
    <input type="text" data-field="name" placeholder="이름" value="${escapeHtml(p.name || "")}" />
    <input type="text" data-field="phone" placeholder="연락처 (선택)" value="${escapeHtml(p.phone || "")}" />
  `);
}
function collectPlaintiffs() {
  return rowsOf(plaintiffListEl)
    .map((row) => ({ id: row.dataset.id || uid(), name: fieldVal(row, "name"), phone: fieldVal(row, "phone") }))
    .filter((p) => p.name);
}

/* ---- 피고/피고인 (respondents) ---- */
document.getElementById("add-respondent-btn").addEventListener("click", () => { addRespondentRow(); refreshSubmitterDatalist(); });
respondentListEl.addEventListener("input", refreshSubmitterDatalist);
function addRespondentRow(r = {}) {
  appendSubrow(respondentListEl, `
    <input type="text" data-field="name" placeholder="이름" value="${escapeHtml(r.name || "")}" />
    <input type="text" data-field="phone" placeholder="연락처 (선택)" value="${escapeHtml(r.phone || "")}" />
  `, refreshSubmitterDatalist);
}
function collectRespondents() {
  return rowsOf(respondentListEl)
    .map((row) => ({ id: row.dataset.id || uid(), name: fieldVal(row, "name"), phone: fieldVal(row, "phone") }))
    .filter((r) => r.name);
}

/* ---- 접수서류 (filings) ---- */
document.getElementById("add-filing-btn").addEventListener("click", () => addFilingRow());
filingListEl.addEventListener("input", refreshStatusBadge);
filingListEl.addEventListener("change", (e) => {
  if (e.target.matches('[data-field="type"]')) toggleOtherNote(e.target.closest(".subrow"));
  refreshStatusBadge();
});
function addFilingRow(f = {}) {
  appendSubrow(filingListEl, `
    <input type="date" data-field="date" value="${f.date || ""}" />
    <select data-field="type" class="subrow-select-sm">
      ${FILING_TYPES.map((t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}
    </select>
    <input type="text" data-field="note" placeholder="비고 (기타 내용 직접 입력)" value="${escapeHtml(f.note || "")}" ${(f.type || FILING_TYPES[0]) === "기타" ? "" : "hidden"} />
  `);
}
function collectFilings() {
  return rowsOf(filingListEl)
    .map((row) => ({ id: row.dataset.id || uid(), date: fieldVal(row, "date"), type: fieldVal(row, "type") || FILING_TYPES[0], note: fieldVal(row, "note") }))
    .filter((f) => f.date || f.note);
}
/* 종류 select에서 "기타"를 고르면 비고 입력칸을 보여주고, 아니면 숨깁니다. (접수서류/제출서류/상대방 제출서류 공통) */
function toggleOtherNote(row) {
  const typeSel = row.querySelector('[data-field="type"]');
  const noteInput = row.querySelector('[data-field="note"]');
  if (!typeSel || !noteInput) return;
  noteInput.hidden = typeSel.value !== "기타";
}
function docLabel(entry) {
  if (!entry) return "";
  if (entry.type === "기타") return entry.note ? entry.note : "기타";
  return entry.type || entry.note || "";
}

/* ---- 보정명령 (corrections, D-day) ---- */
document.getElementById("add-correction-btn").addEventListener("click", () => addCorrectionRow());
function handleCorrectionFieldChange(e) {
  const row = e.target.closest(".subrow");
  if (!row) return;
  // 제출일을 입력하면 "제출완료" 체크박스를 자동으로 켜줍니다 (날짜 없이 체크박스만 직접 켤 수도 있습니다).
  if (e.target.matches('[data-field="submittedDate"]') && e.target.value) {
    const cb = row.querySelector('[data-field="submitted"]');
    if (cb) cb.checked = true;
  }
  updateCorrectionRowDday(row);
  refreshStatusBadge();
}
correctionListEl.addEventListener("input", handleCorrectionFieldChange);
correctionListEl.addEventListener("change", handleCorrectionFieldChange);
function addCorrectionRow(c = {}) {
  const row = appendSubrow(correctionListEl, `
    <label class="subrow-field"><span class="subrow-field-label">내용</span><input type="text" data-field="name" placeholder="보정명령 내용" value="${escapeHtml(c.name || "")}" /></label>
    <label class="subrow-field"><span class="subrow-field-label">송달일</span><input type="date" data-field="date" value="${c.date || ""}" /></label>
    <label class="subrow-field"><span class="subrow-field-label">마감일</span><input type="date" data-field="deadline" value="${c.deadline || ""}" /></label>
    <label class="subrow-field"><span class="subrow-field-label">제출일</span><input type="date" data-field="submittedDate" value="${c.submittedDate || ""}" /></label>
    <label class="subrow-checkbox-label"><input type="checkbox" data-field="submitted" ${c.submitted || c.submittedDate ? "checked" : ""} /> 제출완료</label>
    <span class="badge badge-dday" data-dday></span>
  `);
  updateCorrectionRowDday(row);
}
function updateCorrectionRowDday(row) {
  const deadline = fieldVal(row, "deadline");
  const submitted = fieldVal(row, "submitted") || !!fieldVal(row, "submittedDate");
  const badge = row.querySelector("[data-dday]");
  if (!badge) return;
  if (submitted) { badge.textContent = "제출완료"; badge.className = "badge badge-dday badge-dday-done"; return; }
  if (!deadline) { badge.textContent = ""; badge.className = "badge badge-dday"; return; }
  const diff = daysBetween(todayStr(), deadline);
  const cls = diff < 0 ? "badge-dday-danger" : diff <= 3 ? "badge-dday-warning" : "badge-dday-neutral";
  badge.textContent = diff === 0 ? "D-DAY" : diff > 0 ? `D-${diff}` : `D+${-diff}`;
  badge.className = "badge badge-dday " + cls;
}
function collectCorrections() {
  return rowsOf(correctionListEl)
    .map((row) => ({
      id: row.dataset.id || uid(),
      date: fieldVal(row, "date"),
      deadline: fieldVal(row, "deadline"),
      submittedDate: fieldVal(row, "submittedDate"),
      submitted: !!fieldVal(row, "submitted") || !!fieldVal(row, "submittedDate"),
      name: fieldVal(row, "name")
    }))
    .filter((c) => c.date || c.deadline || c.submittedDate || c.submitted || c.name);
}

/* ---- 기일 (hearings) ---- */
document.getElementById("add-hearing-btn").addEventListener("click", () => addHearingRow());
hearingListEl.addEventListener("input", refreshStatusBadge);
hearingListEl.addEventListener("change", refreshStatusBadge);
function addHearingRow(h = {}) {
  appendSubrow(hearingListEl, `
    <input type="date" data-field="date" value="${h.date || ""}" />
    <input type="time" data-field="time" value="${h.time || ""}" />
    <select data-field="type" class="subrow-select-sm">
      ${HEARING_TYPES.map((t) => `<option value="${t}" ${h.type === t ? "selected" : ""}>${t}</option>`).join("")}
    </select>
    <input type="text" data-field="court" placeholder="법정/재판부" value="${escapeHtml(h.court || "")}" />
    <input type="text" data-field="location" placeholder="장소 / 영상재판 링크" value="${escapeHtml(h.location || "")}" />
  `);
}
function collectHearings() {
  return rowsOf(hearingListEl)
    .map((row) => ({
      id: row.dataset.id || uid(),
      date: fieldVal(row, "date"),
      time: fieldVal(row, "time"),
      type: fieldVal(row, "type") || "변론기일",
      court: fieldVal(row, "court"),
      location: fieldVal(row, "location")
    }))
    .filter((h) => h.date);
}

/* ---- 제출서류 (우리 측, ourFilings) ---- */
document.getElementById("add-ourfiling-btn").addEventListener("click", () => addOurFilingRow());
ourfilingListEl.addEventListener("input", refreshStatusBadge);
ourfilingListEl.addEventListener("change", (e) => {
  if (e.target.matches('[data-field="type"]')) toggleOtherNote(e.target.closest(".subrow"));
  refreshStatusBadge();
});
function addOurFilingRow(f = {}) {
  appendSubrow(ourfilingListEl, `
    <input type="date" data-field="date" value="${f.date || ""}" />
    <select data-field="type" class="subrow-select-sm">
      ${SUBMISSION_TYPES.map((t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}
    </select>
    <input type="text" data-field="note" placeholder="비고 (기타 내용 직접 입력)" value="${escapeHtml(f.note || "")}" ${(f.type || SUBMISSION_TYPES[0]) === "기타" ? "" : "hidden"} />
  `);
}
function collectOurFilings() {
  return rowsOf(ourfilingListEl)
    .map((row) => ({ id: row.dataset.id || uid(), date: fieldVal(row, "date"), type: fieldVal(row, "type") || SUBMISSION_TYPES[0], note: fieldVal(row, "note") }))
    .filter((f) => f.date || f.note);
}

/* ---- 상대방 제출서류 (oppFilings) ---- */
document.getElementById("add-oppfiling-btn").addEventListener("click", () => addOppFilingRow());
oppfilingListEl.addEventListener("input", refreshStatusBadge);
oppfilingListEl.addEventListener("change", (e) => {
  if (e.target.matches('[data-field="type"]')) toggleOtherNote(e.target.closest(".subrow"));
  refreshStatusBadge();
});
function addOppFilingRow(f = {}) {
  appendSubrow(oppfilingListEl, `
    <input type="date" data-field="date" value="${f.date || ""}" />
    <select data-field="type" class="subrow-select-sm">
      ${SUBMISSION_TYPES.map((t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}
    </select>
    <input type="text" data-field="note" placeholder="비고 (기타 내용 직접 입력)" value="${escapeHtml(f.note || "")}" ${(f.type || SUBMISSION_TYPES[0]) === "기타" ? "" : "hidden"} />
    <input type="text" data-field="submitter" placeholder="제출자" list="submitter-datalist" value="${escapeHtml(f.submitter || "")}" />
  `);
}
function collectOppFilings() {
  return rowsOf(oppfilingListEl)
    .map((row) => ({ id: row.dataset.id || uid(), date: fieldVal(row, "date"), type: fieldVal(row, "type") || SUBMISSION_TYPES[0], note: fieldVal(row, "note"), submitter: fieldVal(row, "submitter") }))
    .filter((f) => f.date || f.note || f.submitter);
}

/* ---- 메모 (notes) ---- */
document.getElementById("add-note-btn").addEventListener("click", () => addNoteRow({ date: todayStr() }));
function addNoteRow(n = {}) {
  appendSubrow(noteListEl, `
    <input type="date" data-field="date" value="${n.date || ""}" />
    <textarea data-field="text" placeholder="메모 내용">${escapeHtml(n.text || "")}</textarea>
  `);
}
function collectNotes() {
  return rowsOf(noteListEl)
    .map((row) => ({ id: row.dataset.id || uid(), date: fieldVal(row, "date"), text: fieldVal(row, "text") }))
    .filter((n) => n.text);
}
function collectKind() {
  return {
    civil: fKindCivil.checked,
    criminal: fKindCriminal.checked,
    family: fKindFamily.checked,
    other: fKindOther.checked,
    otherText: fKindOtherText.value.trim()
  };
}

/* ---- 모달 열기 ---- */
function clearSublists() {
  [subcaseListEl, plaintiffListEl, respondentListEl, filingListEl, correctionListEl, hearingListEl, ourfilingListEl, oppfilingListEl, noteListEl]
    .forEach((el) => { el.innerHTML = ""; });
}
function openCaseModal(caseId) {
  caseForm.reset();
  clearSublists();

  const m = caseId ? matters.find((k) => k.id === caseId) : null;
  document.getElementById("case-id").value = caseId || "";
  caseModalTitle.textContent = m ? "사건 수정" : "사건 등록";
  deleteCaseBtn.hidden = !m;
  closeCaseBtn.hidden = !m || !!m.closed;

  if (m) {
    fKindCivil.checked = !!m.kind?.civil;
    fKindCriminal.checked = !!m.kind?.criminal;
    fKindFamily.checked = !!m.kind?.family;
    fKindOther.checked = !!m.kind?.other;
    fKindOtherText.value = m.kind?.otherText || "";
    fCriminalProgress.value = m.criminalProgress || "";
    fLawyer.value = m.lawyer || "";
    fPlaintiffsRole.value = m.plaintiffsRole || "client";
    fRespondentsRole.value = m.respondentsRole || "opponent";

    (m.subCases || []).forEach(addSubcaseRow);
    (m.plaintiffs || []).forEach(addPlaintiffRow);
    (m.respondents || []).forEach(addRespondentRow);
    (m.filings || []).forEach(addFilingRow);
    (m.corrections || []).forEach(addCorrectionRow);
    (m.hearings || []).forEach(addHearingRow);
    (m.ourFilings || []).forEach(addOurFilingRow);
    (m.oppFilings || []).forEach(addOppFilingRow);
    (m.notes || []).forEach(addNoteRow);

    modalStatusMode = m.statusMode === "manual" ? "manual" : "auto";
    modalManualStatus = m.manualStatus || computeAutoStatus(m);
  } else {
    fCriminalProgress.value = "";
    fLawyer.value = "";
    fPlaintiffsRole.value = "client";
    fRespondentsRole.value = "opponent";
    modalStatusMode = "auto";
    modalManualStatus = "unfiled";
  }

  updateKindUI();
  refreshSubmitterDatalist();
  refreshStatusBadge();
  caseModal.hidden = false;
}

caseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("case-id").value;

  const payload = {
    statusMode: modalStatusMode,
    manualStatus: modalStatusMode === "manual" ? fStatusManual.value : null,
    kind: collectKind(),
    criminalProgress: fCriminalProgress.value,
    subCases: collectSubcases(),
    plaintiffs: collectPlaintiffs(),
    plaintiffsRole: fPlaintiffsRole.value,
    respondents: collectRespondents(),
    respondentsRole: fRespondentsRole.value,
    lawyer: fLawyer.value,
    filings: collectFilings(),
    corrections: collectCorrections(),
    hearings: collectHearings(),
    ourFilings: collectOurFilings(),
    oppFilings: collectOppFilings(),
    notes: collectNotes(),
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "matters", id), payload);
    } else {
      payload.closed = false;
      payload.createdAt = serverTimestamp();
      await addDoc(mattersCol, payload);
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
    await deleteDoc(doc(db, "matters", id));
    closeModal("case-modal");
  } catch (err) {
    alert("삭제 중 오류가 발생했습니다: " + err.message);
  }
});

closeCaseBtn.addEventListener("click", async () => {
  const id = document.getElementById("case-id").value;
  if (!id) return;
  const ok = await closeCase(id);
  if (ok) closeModal("case-modal");
});

/* ---------------- 종결 처리 ---------------- */
/* 종결: 삭제가 아니라 상태만 바꿔서 "종결" 탭으로 옮김. 언제든 "다시 열기"로 복구 가능.
   영구종결: 실제로 Firestore 문서를 삭제해 서버(Firestore) 저장 용량/문서 수를 줄임. */
async function closeCase(caseId) {
  if (!confirm("이 사건을 종결 처리하시겠습니까?\n\"종결\" 탭으로 이동되며, 사건관리/캘린더 목록에서는 더 이상 보이지 않습니다.")) return false;
  try {
    await updateDoc(doc(db, "matters", caseId), { closed: true, closedAt: serverTimestamp() });
    switchTab("closed");
    return true;
  } catch (err) {
    alert("종결 처리 중 오류: " + err.message);
    return false;
  }
}
async function reopenCase(caseId) {
  if (!confirm("이 사건을 다시 진행 중 상태로 되돌리시겠습니까?")) return;
  try {
    await updateDoc(doc(db, "matters", caseId), { closed: false, closedAt: null });
  } catch (err) {
    alert("처리 중 오류: " + err.message);
  }
}
async function permanentlyDeleteCase(caseId) {
  if (!confirm("이 사건을 영구 삭제하시겠습니까?\n서버(Firestore)에서 완전히 삭제되어 되돌릴 수 없습니다. 필요하면 먼저 백업하세요.")) return;
  try {
    await deleteDoc(doc(db, "matters", caseId));
  } catch (err) {
    alert("삭제 중 오류: " + err.message);
  }
}
async function permanentlyDeleteAllClosed() {
  const list = matters.filter((m) => m.closed);
  if (!list.length) { alert("영구 삭제할 종결된 사건이 없습니다."); return; }
  if (!confirm(`종결된 사건 ${list.length}건을 모두 영구 삭제하시겠습니까?\n서버(Firestore)에서 완전히 삭제되어 되돌릴 수 없습니다. 필요하면 먼저 백업하세요.`)) return;
  if (!confirm("정말 진행할까요? 마지막 확인입니다. 이 작업은 취소할 수 없습니다.")) return;
  try {
    await Promise.all(list.map((m) => deleteDoc(doc(db, "matters", m.id))));
  } catch (err) {
    alert("일괄 삭제 중 오류: " + err.message);
  }
}
document.getElementById("bulk-delete-closed-btn").addEventListener("click", permanentlyDeleteAllClosed);

/* ---------------- Modal generic close ---------------- */
document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => closeModal(el.dataset.close));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.hidden = true; });
});
function closeModal(id) { document.getElementById(id).hidden = true; }

/* ---------------- 캘린더 ---------------- */
const calendarGrid = document.getElementById("calendar-grid");
const calendarTitle = document.getElementById("calendar-title");

document.getElementById("cal-prev").addEventListener("click", () => shiftMonth(-1));
document.getElementById("cal-next").addEventListener("click", () => shiftMonth(1));
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

function allHearingsFlat() {
  const out = [];
  for (const m of matters) {
    if (m.closed) continue;
    for (const h of (m.hearings || [])) {
      if (h.date) out.push({ ...h, matter: m });
    }
  }
  return out;
}

function personNamesLabel(list) {
  if (!list || !list.length) return "-";
  const first = list[0].name;
  return list.length > 1 ? `${first} 외 ${list.length - 1}명` : first;
}

function renderCalendar() {
  const { year, month } = calState;
  calendarTitle.textContent = `${year}년 ${month + 1}월`;

  const byDate = {};
  for (const h of allHearingsFlat()) {
    (byDate[h.date] ||= []).push(h);
  }
  Object.values(byDate).forEach((list) => list.sort((a, b) => (a.time || "").localeCompare(b.time || "")));

  calendarGrid.innerHTML = "";
  ["일", "월", "화", "수", "목", "금", "토"].forEach((w) => {
    const el = document.createElement("div");
    el.className = "cal-weekday";
    el.textContent = w;
    calendarGrid.appendChild(el);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

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
    const LIMIT = 3;
    for (const h of events.slice(0, LIMIT)) {
      const m = h.matter;
      const isVerdict = h.type === "선고기일";
      const caseNo = (m.subCases && m.subCases[0]) ? `${m.subCases[0].agency || ""} ${m.subCases[0].caseNumber || ""}`.trim() : "";
      const caseName = (m.subCases && m.subCases[0] && m.subCases[0].caseName) || "";
      const evEl = document.createElement("div");
      evEl.className = "cal-event" + (isVerdict ? " verdict" : "");
      evEl.innerHTML = `
        <span class="cal-event-case">${escapeHtml(caseName || caseNo || "사건")}</span>
        <span class="cal-event-sub">${escapeHtml(h.type || "기일")}${h.time ? " " + h.time : ""}</span>
      `;
      evEl.title = [
        caseNo,
        `의뢰인: ${personNamesLabel(clientPeople(m))}`,
        `상대방: ${personNamesLabel(opponentPeople(m))}`,
        h.court ? `법정: ${h.court}` : "",
        h.location ? `장소/링크: ${h.location}` : ""
      ].filter(Boolean).join("\n");
      evEl.addEventListener("click", (e) => { e.stopPropagation(); openCaseModal(m.id); });
      cell.appendChild(evEl);
    }
    if (events.length > LIMIT) {
      const more = document.createElement("div");
      more.className = "cal-more";
      more.textContent = `+${events.length - LIMIT}건 더보기`;
      cell.appendChild(more);
    }
    calendarGrid.appendChild(cell);
  }
}

/* ---------------- 종결 탭 ---------------- */
const closedTableBody = document.getElementById("closed-table-body");
const closedEmpty = document.getElementById("closed-empty");
const closedCountBadge = document.getElementById("closed-count-badge");

function closedCasesSorted() {
  return matters.filter((m) => m.closed).sort((a, b) => {
    const ad = a.closedAt && typeof a.closedAt.toDate === "function" ? a.closedAt.toDate().getTime() : 0;
    const bd = b.closedAt && typeof b.closedAt.toDate === "function" ? b.closedAt.toDate().getTime() : 0;
    return bd - ad; // 최근 종결된 순
  });
}

function renderClosedTab() {
  const list = closedCasesSorted();
  closedTableBody.innerHTML = "";
  closedEmpty.hidden = list.length > 0;

  for (const m of list) {
    const caseNoLabel = (m.subCases && m.subCases.length)
      ? m.subCases.map((s) => `${s.agency || ""} ${s.caseNumber || ""}`.trim()).join(", ")
      : "-";
    const peopleLabel = [personNamesLabel(m.plaintiffs), personNamesLabel(m.respondents)].filter((v) => v && v !== "-").join(" · ") || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(caseNoLabel)}</td>
      <td>${escapeHtml(peopleLabel)}</td>
      <td>${kindLabelHtml(m.kind, m.criminalProgress)}</td>
      <td>${formatTimestampKorDate(m.closedAt)}</td>
      <td class="nowrap">
        <button type="button" class="btn btn-sm reopen-btn">다시 열기</button>
        <button type="button" class="btn btn-sm btn-danger permanent-delete-btn">영구종결</button>
      </td>
    `;
    tr.querySelector(".reopen-btn").addEventListener("click", () => reopenCase(m.id));
    tr.querySelector(".permanent-delete-btn").addEventListener("click", () => permanentlyDeleteCase(m.id));
    closedTableBody.appendChild(tr);
  }
}
function updateClosedBadge() {
  const count = closedCasesSorted().length;
  closedCountBadge.hidden = count === 0;
  closedCountBadge.textContent = count;
}
