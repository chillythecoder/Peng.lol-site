const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new (require("connect-sqlite3")(session))({ db: "sessions.sqlite", dir: DATA }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const db = new Database(path.join(DATA, "penglol.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
 banned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mods (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, game TEXT NOT NULL,
 description TEXT NOT NULL, version TEXT NOT NULL, compatibility TEXT DEFAULT '',
 instructions TEXT DEFAULT '', author_id INTEGER NOT NULL,
 file_name TEXT, original_name TEXT, file_size INTEGER DEFAULT 0,
 downloads INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(author_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS favorites (
 user_id INTEGER NOT NULL, mod_id INTEGER NOT NULL,
 PRIMARY KEY(user_id, mod_id)
);
CREATE TABLE IF NOT EXISTS tutorials (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
 author_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
 author_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const ownerPassword = process.env.OWNER_PASSWORD;
if (ownerPassword) {
  const hash = bcrypt.hashSync(ownerPassword, 12);
  const existing = db.prepare("SELECT id FROM users WHERE username='chilly'").get();
  if (existing) db.prepare("UPDATE users SET password_hash=?, role='owner', banned=0 WHERE username='chilly'").run(hash);
  else db.prepare("INSERT INTO users(username,password_hash,role) VALUES('chilly',?,'owner')").run(hash);
} else {
  console.warn("OWNER_PASSWORD is not set. Set it in .env before first launch to create the chilly owner account.");
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".zip", ".7z", ".rar", ".apk", ".jar", ".dll", ".so", ".json", ".txt", ".pdf"];
    cb(allowed.includes(ext) ? null : new Error("File type not allowed."), allowed.includes(ext));
  }
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id, username, role, banned FROM users WHERE id=?").get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Please log in first." });
  if (user.banned) return res.status(403).json({ error: "This account is suspended." });
  req.user = user; next();
}
function requireAdmin(req, res, next) {
  if (!req.user || !["owner", "admin"].includes(req.user.role)) return res.status(403).json({ error: "Administrator access required." });
  next();
}
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  next();
}
function safeMod(row, userId) {
  return { ...row, is_favorite: userId ? !!db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND mod_id=?").get(userId, row.id) : false };
}

app.get("/api/me", (req, res) => res.json({ user: currentUser(req) }));
app.post("/api/register", authLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3–20 letters, numbers, or underscores." });
  if (username.toLowerCase() === "chilly") return res.status(400).json({ error: "That username is reserved." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username, hash);
    req.session.userId = result.lastInsertRowid;
    res.json({ user: currentUser(req) });
  } catch { res.status(409).json({ error: "That username is already taken." }); }
});
app.post("/api/login", authLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Incorrect username or password." });
  if (user.banned) return res.status(403).json({ error: "This account is suspended." });
  req.session.userId = user.id;
  res.json({ user: currentUser(req) });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/mods", (req, res) => {
  const q = String(req.query.q || "").trim();
  const sort = req.query.sort === "downloads" ? "m.downloads DESC" : req.query.sort === "updated" ? "m.created_at DESC" : "m.created_at DESC";
  const rows = db.prepare(`
    SELECT m.*, u.username AS author FROM mods m JOIN users u ON u.id=m.author_id
    WHERE (?='' OR m.name LIKE ? OR m.game LIKE ? OR m.description LIKE ? OR u.username LIKE ?)
    ORDER BY m.featured DESC, ${sort} LIMIT 100
  `).all(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json({ mods: rows.map(r => safeMod(r, currentUser(req)?.id)) });
});
app.post("/api/mods", requireAuth, upload.single("file"), (req, res) => {
  const { name, game, description, version, compatibility, instructions } = req.body;
  if (!name || !game || !description || !version) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Name, game, description, and version are required." });
  }
  const result = db.prepare(`INSERT INTO mods(name,game,description,version,compatibility,instructions,author_id,file_name,original_name,file_size)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(name.trim(), game.trim(), description.trim(), version.trim(), compatibility || "", instructions || "", req.user.id,
    req.file?.filename || null, req.file?.originalname || null, req.file?.size || 0);
  res.json({ id: result.lastInsertRowid });
});
app.get("/api/mods/:id/download", (req, res) => {
  const mod = db.prepare("SELECT * FROM mods WHERE id=?").get(req.params.id);
  if (!mod || !mod.file_name) return res.status(404).send("Download not found.");
  const filePath = path.join(UPLOADS, path.basename(mod.file_name));
  if (!fs.existsSync(filePath)) return res.status(404).send("File is no longer available.");
  db.prepare("UPDATE mods SET downloads=downloads+1 WHERE id=?").run(mod.id);
  res.download(filePath, mod.original_name || "mod-download");
});
app.post("/api/mods/:id/favorite", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND mod_id=?").get(req.user.id, id);
  if (exists) db.prepare("DELETE FROM favorites WHERE user_id=? AND mod_id=?").run(req.user.id, id);
  else db.prepare("INSERT OR IGNORE INTO favorites(user_id,mod_id) VALUES(?,?)").run(req.user.id, id);
  res.json({ favorite: !exists });
});
app.delete("/api/mods/:id", requireAuth, (req, res) => {
  const mod = db.prepare("SELECT * FROM mods WHERE id=?").get(req.params.id);
  if (!mod) return res.status(404).json({ error: "Mod not found." });
  if (req.user.role !== "owner" && req.user.role !== "admin" && mod.author_id !== req.user.id) return res.status(403).json({ error: "Not allowed." });
  if (mod.file_name) { const p = path.join(UPLOADS, path.basename(mod.file_name)); if (fs.existsSync(p)) fs.unlinkSync(p); }
  db.prepare("DELETE FROM favorites WHERE mod_id=?").run(mod.id);
  db.prepare("DELETE FROM mods WHERE id=?").run(mod.id);
  res.json({ ok: true });
});

app.get("/api/tutorials", (_req, res) => res.json({ tutorials: db.prepare("SELECT t.*,u.username AS author FROM tutorials t JOIN users u ON u.id=t.author_id ORDER BY t.created_at DESC").all() }));
app.post("/api/tutorials", requireAuth, requireAdmin, (req, res) => {
  if (!req.body.title || !req.body.body) return res.status(400).json({ error: "Title and content are required." });
  const r = db.prepare("INSERT INTO tutorials(title,body,author_id) VALUES(?,?,?)").run(req.body.title, req.body.body, req.user.id);
  res.json({ id: r.lastInsertRowid });
});
app.delete("/api/tutorials/:id", requireAuth, requireAdmin, (req, res) => { db.prepare("DELETE FROM tutorials WHERE id=?").run(req.params.id); res.json({ ok: true }); });

app.get("/api/announcements", (_req, res) => res.json({ announcements: db.prepare("SELECT a.*,u.username AS author FROM announcements a JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC LIMIT 10").all() }));
app.post("/api/announcements", requireAuth, requireAdmin, (req, res) => {
  if (!req.body.title || !req.body.body) return res.status(400).json({ error: "Title and message are required." });
  const r = db.prepare("INSERT INTO announcements(title,body,author_id) VALUES(?,?,?)").run(req.body.title, req.body.body, req.user.id);
  res.json({ id: r.lastInsertRowid });
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id,username,role,banned,created_at FROM users ORDER BY created_at DESC").all();
  res.json({ users });
});
app.post("/api/admin/users/:id/ban", requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.role === "owner") return res.status(403).json({ error: "The owner account is protected." });
  if (req.user.role !== "owner" && target.role === "admin") return res.status(403).json({ error: "Only the owner can manage administrators." });
  db.prepare("UPDATE users SET banned=? WHERE id=?").run(req.body.banned ? 1 : 0, target.id);
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/role", requireAuth, requireOwner, (req, res) => {
  const role = ["user", "admin"].includes(req.body.role) ? req.body.role : "user";
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!target || target.role === "owner") return res.status(400).json({ error: "Cannot change this account." });
  db.prepare("UPDATE users SET role=? WHERE id=?").run(role, target.id);
  res.json({ ok: true });
});
app.delete("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.role === "owner" || (req.user.role !== "owner" && target.role === "admin")) return res.status(403).json({ error: "This account is protected." });
  db.prepare("DELETE FROM favorites WHERE user_id=?").run(target.id);
  db.prepare("DELETE FROM mods WHERE author_id=?").run(target.id);
  db.prepare("DELETE FROM tutorials WHERE author_id=?").run(target.id);
  db.prepare("DELETE FROM announcements WHERE author_id=?").run(target.id);
  db.prepare("DELETE FROM users WHERE id=?").run(target.id);
  res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => {
  res.json({
    mods: db.prepare("SELECT COUNT(*) n FROM mods").get().n,
    users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
    downloads: db.prepare("SELECT COALESCE(SUM(downloads),0) n FROM mods").get().n
  });
});
app.use("/uploads", express.static(UPLOADS));
app.use(express.static(path.join(ROOT, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

app.listen(PORT, () => console.log(`PENG.LOL is running at http://localhost:${PORT}`));
