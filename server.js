const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db");

const isProd = process.env.NODE_ENV === "production";
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (isProd) {
    console.error("JWT_SECRET must be set in production.");
    process.exit(1);
  }
  SECRET = "dev-only-secret-change-me";
  console.warn("Warning: using a development JWT secret. Set JWT_SECRET before deploying.");
}

const PORT = process.env.PORT || 3000;
const PRIORITIES = ["low", "medium", "high"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ---------- helpers ----------
function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function auth(req, res, next) {
  try {
    req.user = jwt.verify(req.cookies.token, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "Please log in." });
  }
}

// returns a valid date string, null (clear), or undefined (invalid)
function cleanDate(v) {
  if (v === null || v === "") return null;
  if (typeof v === "string" && DATE_RE.test(v)) return v;
  return undefined;
}

const toTask = (r) => ({
  id: r.id,
  text: r.text,
  done: !!r.done,
  priority: r.priority,
  dueDate: r.due_date
});

// ---------- accounts ----------
app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-30 letters, numbers or underscores." });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 6-72 characters." });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    const user = { id: Number(info.lastInsertRowid), username };
    setAuthCookie(res, user);
    res.status(201).json({ username });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "That username is taken." });
    }
    throw e;
  }
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  setAuthCookie(res, user);
  res.json({ username: user.username });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.status(204).end();
});

app.get("/api/me", auth, (req, res) => {
  res.json({ username: req.user.username });
});

// ---------- tasks (always scoped to the logged-in user) ----------
app.get("/api/tasks", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY position, id").all(req.user.id);
  res.json(rows.map(toTask));
});

app.post("/api/tasks", auth, (req, res) => {
  const text = String(req.body.text || "").trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: "Task text is required." });
  const priority = req.body.priority === undefined ? "medium" : req.body.priority;
  if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid priority." });
  const due = cleanDate(req.body.dueDate === undefined ? null : req.body.dueDate);
  if (due === undefined) return res.status(400).json({ error: "Invalid due date." });

  const pos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE user_id = ?").get(req.user.id).p;
  const info = db
    .prepare("INSERT INTO tasks (user_id, text, priority, due_date, position) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, text, priority, due, pos);
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(toTask(row));
});

app.put("/api/tasks/order", auth, (req, res) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids must be an array." });
  const upd = db.prepare("UPDATE tasks SET position = ? WHERE id = ? AND user_id = ?");
  db.transaction(() => {
    ids.forEach((id, i) => upd.run(i, Number(id), req.user.id));
  })();
  res.status(204).end();
});

app.delete("/api/tasks", auth, (req, res) => {
  db.prepare("DELETE FROM tasks WHERE user_id = ? AND done = 1").run(req.user.id);
  res.status(204).end();
});

app.patch("/api/tasks/:id", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: "Task not found." });

  const b = req.body;
  let text = row.text, done = row.done, priority = row.priority, due = row.due_date;

  if (b.text !== undefined) {
    text = String(b.text).trim().slice(0, 200);
    if (!text) return res.status(400).json({ error: "Task text is required." });
  }
  if (b.done !== undefined) done = b.done ? 1 : 0;
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) return res.status(400).json({ error: "Invalid priority." });
    priority = b.priority;
  }
  if (b.dueDate !== undefined) {
    const d = cleanDate(b.dueDate);
    if (d === undefined) return res.status(400).json({ error: "Invalid due date." });
    due = d;
  }

  db.prepare("UPDATE tasks SET text = ?, done = ?, priority = ?, due_date = ? WHERE id = ?")
    .run(text, done, priority, due, row.id);
  res.json(toTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(row.id)));
});

app.delete("/api/tasks/:id", auth, (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
  res.status(204).end();
});

// ---------- errors ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => console.log("To-do app running at http://localhost:" + PORT));
