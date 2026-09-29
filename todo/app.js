// 업무 To-Do 대시보드
// 사건관리 대시보드(../firebase-config.js, ../index.html)와 동일한 Firebase 프로젝트/로그인 계정을 그대로 사용하되,
// Firestore 컬렉션은 별도로 분리되어 있어("tasks", "todoMeta") 사건관리 데이터와 서로 섞이지 않습니다.

import { firebaseConfig } from "../firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------------- Firebase init ---------------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const tasksCol = collection(db, "tasks");
const memoRef = doc(db, "todoMeta", "memo");

/* ---------------- State ---------------- */
let tasks = [];
let unsubscribeTasks = null;
let unsubscribeMemo = null;
let editingTaskId = null;

const STATUS_LABEL = { todo: "할 일", inprogress: "진행 중", misc: "기타 부가 업무", done: "완료" };
const PRIORITY_LABEL = { high: "높음", mid: "보통", low: "낮음" };
const BOARD_STATUSES = ["todo", "inprogress", "misc"];

/* ---------------- Helpers ---------------- */
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function formatKorDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${pad(m)}.${pad(d)}(${wd})`;
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    startTasksListener();
    startMemoListener();
  } else {
    loginScreen.hidden = false;
    appRoot.hidden = true;
    if (unsubscribeTasks) { unsubscribeTasks(); unsubscribeTasks = null; }
    if (unsubscribeMemo) { unsubscribeMemo(); unsubscribeMemo = null; }
    tasks = [];
  }
});

function startTasksListener() {
  if (unsubscribeTasks) return;
  unsubscribeTasks = onSnapshot(tasksCol, (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("Firestore 구독 오류:", err));
}

/* ---------------- Pinned memo ---------------- */
const globalMemoEl = document.getElementById("global-memo");
let memoSaveTimer = null;
let suppressMemoEcho = false;

function startMemoListener() {
  if (unsubscribeMemo) return;
  unsubscribeMemo = onSnapshot(memoRef, (snap) => {
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
      await setDoc(memoRef, { text: globalMemoEl.value, updatedAt: serverTimestamp() }, { merge: true });
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
}
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ---------------- Filters ---------------- */
const searchEl = document.getElementById("task-search");
const doneSearchEl = document.getElementById("done-search");
const categoryFilterEl = document.getElementById("filter-category");
const priorityFilterEl = document.getElementById("filter-priority");
searchEl.addEventListener("input", renderAll);
doneSearchEl.addEventListener("input", renderAll);
categoryFilterEl.addEventListener("change", renderAll);
priorityFilterEl.addEventListener("change", renderAll);

function matchesFilters(t, query) {
  const cat = categoryFilterEl.value;
  const pri = priorityFilterEl.value;
  if (cat && (t.category || "") !== cat) return false;
  if (pri && (t.priority || "mid") !== pri) return false;
  if (query) {
    const hay = `${t.title || ""} ${t.notes || ""} ${t.category || ""}`.toLowerCase();
    if (!hay.includes(query.toLowerCase())) return false;
  }
  return true;
}

function updateCategoryOptions() {
  const cats = [...new Set(tasks.map((t) => (t.category || "").trim()).filter(Boolean))].sort();
  const currentVal = categoryFilterEl.value;
  categoryFilterEl.innerHTML = '<option value="">전체 분류</option>' +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (cats.includes(currentVal)) categoryFilterEl.value = currentVal;
  const datalist = document.getElementById("category-datalist");
  datalist.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
}

/* ---------------- Render ---------------- */
function renderAll() {
  updateCategoryOptions();
  renderBoard();
  renderDone();
  updateStats();
  updateDoneBadge();
}

function sortedColumnTasks(status, query) {
  return tasks
    .filter((t) => (t.status || "todo") === status)
    .filter((t) => matchesFilters(t, query))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function renderBoard() {
  const query = searchEl.value.trim();
  BOARD_STATUSES.forEach((status) => {
    const list = sortedColumnTasks(status, query);
    const colEl = document.getElementById("col-" + status);
    document.getElementById("count-" + status).textContent = list.length;
    if (!list.length) {
      colEl.innerHTML = '<div class="kanban-empty-msg">업무 없음</div>';
      return;
    }
    colEl.innerHTML = "";
    list.forEach((t) => colEl.appendChild(createCardEl(t)));
  });
}

function dueBadgeInfo(t) {
  if (!t.dueDate) return null;
  const today = todayStr();
  let cls = "";
  if (t.dueDate < today) cls = "due-overdue";
  else if (t.dueDate === today) cls = "due-today";
  return { cls, label: formatKorDate(t.dueDate) };
}

function createCardEl(t) {
  const card = document.createElement("div");
  card.className = `task-card priority-${t.priority || "mid"}`;
  card.draggable = true;
  card.dataset.id = t.id;

  const due = dueBadgeInfo(t);
  card.innerHTML = `
    <div class="task-card-top">
      <div class="task-card-title">${escapeHtml(t.title || "(제목 없음)")}</div>
      <button type="button" class="task-card-done-btn" title="완료 처리">✓</button>
    </div>
    <div class="task-card-meta">
      ${t.category ? `<span class="chip-category">${escapeHtml(t.category)}</span>` : ""}
      ${due ? `<span class="badge-due ${due.cls}">${due.label}</span>` : ""}
    </div>
    ${t.notes ? `<div class="task-card-notes">${escapeHtml(t.notes)}</div>` : ""}
  `;

  card.querySelector(".task-card-done-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    markDone(t.id);
  });
  card.addEventListener("click", () => openTaskModal(t.id));

  card.addEventListener("dragstart", () => {
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document.querySelectorAll(".kanban-col-body").forEach((c) => c.classList.remove("drag-over"));
    persistAllColumnsOrder();
  });

  return card;
}

/* ---------------- Drag & drop reordering ---------------- */
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll(".task-card:not(.dragging)")];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

document.querySelectorAll(".kanban-col-body").forEach((colEl) => {
  colEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = document.querySelector(".task-card.dragging");
    if (!dragging) return;
    colEl.classList.add("drag-over");
    const emptyMsg = colEl.querySelector(".kanban-empty-msg");
    if (emptyMsg) emptyMsg.remove();
    const afterEl = getDragAfterElement(colEl, e.clientY);
    if (afterEl == null) colEl.appendChild(dragging);
    else colEl.insertBefore(dragging, afterEl);
  });
  colEl.addEventListener("dragleave", (e) => {
    if (e.target === colEl) colEl.classList.remove("drag-over");
  });
  colEl.addEventListener("drop", (e) => {
    e.preventDefault();
    colEl.classList.remove("drag-over");
  });
});

function persistAllColumnsOrder() {
  BOARD_STATUSES.forEach((status) => {
    const colEl = document.getElementById("col-" + status);
    const ids = [...colEl.querySelectorAll(".task-card")].map((el) => el.dataset.id);
    ids.forEach((id, idx) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const patch = {};
      if ((t.order ?? -1) !== idx) patch.order = idx;
      if ((t.status || "todo") !== status) patch.status = status;
      if (Object.keys(patch).length) {
        Object.assign(t, patch);
        updateDoc(doc(db, "tasks", id), patch).catch((err) => console.error("순서 저장 오류:", err));
      }
    });
  });
}

/* ---------------- Done tab ---------------- */
function renderDone() {
  const query = doneSearchEl.value.trim().toLowerCase();
  const list = tasks
    .filter((t) => (t.status || "todo") === "done")
    .filter((t) => {
      if (!query) return true;
      const hay = `${t.title || ""} ${t.notes || ""} ${t.category || ""}`.toLowerCase();
      return hay.includes(query);
    })
    .sort((a, b) => {
      const at = a.completedAt && a.completedAt.toDate ? a.completedAt.toDate().getTime() : 0;
      const bt = b.completedAt && b.completedAt.toDate ? b.completedAt.toDate().getTime() : 0;
      return bt - at;
    });
  const container = document.getElementById("done-list");
  if (!list.length) {
    container.innerHTML = '<div class="kanban-empty-msg">완료된 업무가 없습니다.</div>';
    return;
  }
  container.innerHTML = "";
  list.forEach((t) => {
    const row = document.createElement("div");
    row.className = "done-row";
    row.innerHTML = `
      <span class="done-row-title">${escapeHtml(t.title || "(제목 없음)")}</span>
      ${t.category ? `<span class="chip-category">${escapeHtml(t.category)}</span>` : ""}
      <div class="done-row-actions">
        <button type="button" class="btn btn-sm restore-btn">복원</button>
        <button type="button" class="btn btn-sm btn-danger delete-btn">삭제</button>
      </div>
    `;
    row.querySelector(".restore-btn").addEventListener("click", (e) => { e.stopPropagation(); restoreTask(t.id); });
    row.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("이 업무를 완전히 삭제할까요?")) deleteDoc(doc(db, "tasks", t.id));
    });
    row.addEventListener("click", () => openTaskModal(t.id));
    container.appendChild(row);
  });
}

function markDone(id) {
  updateDoc(doc(db, "tasks", id), { status: "done", completedAt: serverTimestamp() })
    .catch((err) => console.error("완료 처리 오류:", err));
}
function restoreTask(id) {
  const maxOrder = Math.max(-1, ...tasks.filter((t) => (t.status || "todo") === "todo").map((t) => t.order ?? -1));
  updateDoc(doc(db, "tasks", id), { status: "todo", completedAt: null, order: maxOrder + 1 })
    .catch((err) => console.error("복원 오류:", err));
}

/* ---------------- Stats ---------------- */
function updateStats() {
  const active = tasks.filter((t) => (t.status || "todo") !== "done");
  const today = todayStr();
  document.getElementById("stat-total").textContent = active.length;
  document.getElementById("stat-due-today").textContent = active.filter((t) => t.dueDate === today).length;
  document.getElementById("stat-overdue").textContent = active.filter((t) => t.dueDate && t.dueDate < today).length;
  document.getElementById("stat-done").textContent = tasks.filter((t) => (t.status || "todo") === "done").length;
}
function updateDoneBadge() {
  const n = tasks.filter((t) => (t.status || "todo") === "done").length;
  const badge = document.getElementById("done-count-badge");
  badge.textContent = n;
  badge.hidden = n === 0;
}

/* ---------------- Task modal ---------------- */
const taskModal = document.getElementById("task-modal");
const taskForm = document.getElementById("task-form");
const taskModalTitle = document.getElementById("task-modal-title");
const taskDeleteBtn = document.getElementById("task-delete-btn");

document.getElementById("new-task-btn").addEventListener("click", () => openTaskModal(null));
document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeTaskModal));
taskModal.addEventListener("click", (e) => { if (e.target === taskModal) closeTaskModal(); });

function openTaskModal(id) {
  editingTaskId = id;
  const t = id ? tasks.find((x) => x.id === id) : null;
  taskModalTitle.textContent = t ? "업무 수정" : "새 업무";
  document.getElementById("t-title").value = t ? (t.title || "") : "";
  document.getElementById("t-category").value = t ? (t.category || "") : "";
  document.getElementById("t-priority").value = t ? (t.priority || "mid") : "mid";
  document.getElementById("t-status").value = t ? (t.status || "todo") : "todo";
  document.getElementById("t-due").value = t ? (t.dueDate || "") : "";
  document.getElementById("t-notes").value = t ? (t.notes || "") : "";
  taskDeleteBtn.hidden = !t;
  taskModal.hidden = false;
}
function closeTaskModal() {
  taskModal.hidden = true;
  editingTaskId = null;
  taskForm.reset();
}

taskDeleteBtn.addEventListener("click", async () => {
  if (!editingTaskId) return;
  if (!confirm("이 업무를 삭제할까요?")) return;
  try {
    await deleteDoc(doc(db, "tasks", editingTaskId));
    closeTaskModal();
  } catch (err) {
    console.error("삭제 오류:", err);
    alert("삭제 중 오류가 발생했습니다.");
  }
});

taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("t-title").value.trim();
  if (!title) return;
  const status = document.getElementById("t-status").value;
  const fields = {
    title,
    category: document.getElementById("t-category").value.trim(),
    priority: document.getElementById("t-priority").value,
    status,
    dueDate: document.getElementById("t-due").value || null,
    notes: document.getElementById("t-notes").value.trim()
  };
  try {
    if (editingTaskId) {
      const prev = tasks.find((x) => x.id === editingTaskId);
      const patch = { ...fields };
      if (prev && (prev.status || "todo") !== status) {
        // 상태(칼럼)가 모달에서 바뀐 경우 해당 칼럼 맨 뒤로 배치
        const maxOrder = Math.max(-1, ...tasks.filter((t) => (t.status || "todo") === status && t.id !== editingTaskId).map((t) => t.order ?? -1));
        patch.order = maxOrder + 1;
        if (status === "done") patch.completedAt = serverTimestamp();
        else if (prev.status === "done") patch.completedAt = null;
      }
      await updateDoc(doc(db, "tasks", editingTaskId), patch);
    } else {
      const maxOrder = Math.max(-1, ...tasks.filter((t) => (t.status || "todo") === status).map((t) => t.order ?? -1));
      await addDoc(tasksCol, {
        ...fields,
        order: maxOrder + 1,
        createdAt: serverTimestamp(),
        completedAt: status === "done" ? serverTimestamp() : null
      });
    }
    closeTaskModal();
  } catch (err) {
    console.error("저장 오류:", err);
    alert("저장 중 오류가 발생했습니다.");
  }
});
