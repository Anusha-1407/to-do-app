(function () {
  const $ = (id) => document.getElementById(id);
  let tasks = [];
  let filter = "all";
  let editingId = null;
  let dragId = null;

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function fail(err) {
    if (err.status === 401) return showAuth();
    $("appError").textContent = err.message;
    setTimeout(function () { $("appError").textContent = ""; }, 4000);
  }

  async function refresh() {
    try { tasks = await api("GET", "/api/tasks"); render(); } catch (e) { fail(e); }
  }

  async function act(promise) {
    try { await promise; await refresh(); } catch (e) { fail(e); }
  }

  // ---------- views ----------
  function showAuth() {
    $("authView").hidden = false;
    $("appView").hidden = true;
  }
  function showApp(name) {
    $("authView").hidden = true;
    $("appView").hidden = false;
    $("who").textContent = name;
    refresh();
  }

  async function submitAuth(kind) {
    $("authError").textContent = "";
    try {
      const u = await api("POST", "/api/" + kind, {
        username: $("username").value.trim(),
        password: $("password").value
      });
      $("password").value = "";
      showApp(u.username);
    } catch (e) {
      $("authError").textContent = e.message;
    }
  }

  $("authForm").onsubmit = function (e) { e.preventDefault(); submitAuth("login"); };
  $("registerBtn").onclick = function () { submitAuth("register"); };
  $("logoutBtn").onclick = async function () {
    try { await api("POST", "/api/logout"); } catch (e) {}
    tasks = [];
    showAuth();
  };

  // ---------- tasks ----------
  function todayStr() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function visible() {
    return tasks.filter(function (t) {
      return filter === "all" || (filter === "active" ? !t.done : t.done);
    });
  }

  function moveTask(fromId, toId) {
    if (fromId === null || fromId === toId) return;
    const from = tasks.findIndex(function (t) { return t.id === fromId; });
    const to = tasks.findIndex(function (t) { return t.id === toId; });
    if (from < 0 || to < 0) return;
    const moved = tasks.splice(from, 1)[0];
    tasks.splice(to, 0, moved);
    render();
    act(api("PUT", "/api/tasks/order", { ids: tasks.map(function (t) { return t.id; }) }));
  }

  function render() {
    const list = $("list");
    list.innerHTML = "";
    const items = visible();
    const today = todayStr();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = tasks.length ? "Nothing in this view." : "No tasks yet. Add your first one above.";
      list.appendChild(empty);
    }

    items.forEach(function (t) {
      const li = document.createElement("li");
      li.className = "p-" + t.priority +
        (t.done ? " done" : "") +
        (t.dueDate && t.dueDate < today && !t.done ? " overdue" : "");

      // drag handle (only active on the All tab)
      const handle = document.createElement("span");
      handle.className = "handle" + (filter === "all" ? "" : " off");
      handle.textContent = "⋮⋮";
      handle.title = filter === "all" ? "Drag to reorder" : "Switch to All to reorder";
      if (filter === "all") {
        handle.onmousedown = function () { li.draggable = true; };
        li.ondragstart = function (e) {
          dragId = t.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(t.id));
          li.classList.add("dragging");
        };
        li.ondragend = function () {
          li.draggable = false;
          li.classList.remove("dragging");
          dragId = null;
          Array.prototype.forEach.call(list.children, function (c) { c.classList.remove("over"); });
        };
        li.ondragover = function (e) {
          if (dragId === null) return;
          e.preventDefault();
          li.classList.add("over");
        };
        li.ondragleave = function () { li.classList.remove("over"); };
        li.ondrop = function (e) {
          e.preventDefault();
          li.classList.remove("over");
          const from = dragId;
          dragId = null;
          moveTask(from, t.id);
        };
      }
      li.appendChild(handle);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = t.done;
      cb.onchange = function () { act(api("PATCH", "/api/tasks/" + t.id, { done: cb.checked })); };
      li.appendChild(cb);

      if (editingId === t.id) {
        const ed = document.createElement("input");
        ed.className = "edit";
        ed.value = t.text;
        ed.maxLength = 200;
        let cancelled = false;
        ed.onkeydown = function (e) {
          if (e.key === "Enter") ed.blur();
          if (e.key === "Escape") { cancelled = true; editingId = null; render(); }
        };
        ed.onblur = function () {
          if (cancelled) return;
          editingId = null;
          const v = ed.value.trim();
          act(v ? api("PATCH", "/api/tasks/" + t.id, { text: v }) : api("DELETE", "/api/tasks/" + t.id));
        };
        li.appendChild(ed);
        setTimeout(function () { ed.focus(); ed.select(); }, 0);
      } else {
        const span = document.createElement("span");
        span.className = "text";
        span.textContent = t.text;
        span.ondblclick = function () { editingId = t.id; render(); };
        li.appendChild(span);
      }

      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "Priority");
      ["low", "medium", "high"].forEach(function (p) {
        const o = document.createElement("option");
        o.value = p;
        o.textContent = p[0].toUpperCase() + p.slice(1);
        if (p === t.priority) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { act(api("PATCH", "/api/tasks/" + t.id, { priority: sel.value })); };
      li.appendChild(sel);

      const due = document.createElement("input");
      due.type = "date";
      due.value = t.dueDate || "";
      due.setAttribute("aria-label", "Due date");
      due.onchange = function () { act(api("PATCH", "/api/tasks/" + t.id, { dueDate: due.value || null })); };
      li.appendChild(due);

      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Delete task");
      del.onclick = function () { act(api("DELETE", "/api/tasks/" + t.id)); };
      li.appendChild(del);

      list.appendChild(li);
    });

    const left = tasks.filter(function (t) { return !t.done; }).length;
    $("count").textContent = left + (left === 1 ? " task left" : " tasks left");
    $("clearBtn").style.visibility = tasks.some(function (t) { return t.done; }) ? "visible" : "hidden";
  }

  // ---------- controls ----------
  function addTask() {
    const text = $("newTask").value.trim();
    if (!text) return;
    const body = {
      text: text,
      priority: $("newPriority").value,
      dueDate: $("newDue").value || null
    };
    $("newTask").value = "";
    $("newDue").value = "";
    act(api("POST", "/api/tasks", body));
  }

  $("addBtn").onclick = function () { addTask(); $("newTask").focus(); };
  $("newTask").onkeydown = function (e) { if (e.key === "Enter") addTask(); };
  $("clearBtn").onclick = function () { act(api("DELETE", "/api/tasks")); };
  $("filters").onclick = function (e) {
    const f = e.target.getAttribute("data-f");
    if (!f) return;
    filter = f;
    Array.prototype.forEach.call($("filters").children, function (b) {
      b.classList.toggle("active", b === e.target);
    });
    render();
  };

  // ---------- start ----------
  api("GET", "/api/me")
    .then(function (u) { showApp(u.username); })
    .catch(function () { showAuth(); });
})();
