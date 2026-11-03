const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be configured.");
}

if (!process.env.OWNER_PASSWORD) {
    throw new Error("Set OWNER_PASSWORD in your hosting environment.");
}

const db = new Database(path.join(DATA_DIR, "penglol.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'owner',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    game TEXT DEFAULT '',
    description TEXT DEFAULT '',
    version TEXT DEFAULT '',
    compatibility TEXT DEFAULT '',
    instructions TEXT DEFAULT '',
    author_id INTEGER,
    file_name TEXT,
    original_name TEXT,
    file_size INTEGER DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    image_url TEXT DEFAULT '',
    download_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    url TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function addColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(c => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

addColumn("mods", "image_url", "TEXT DEFAULT ''");
addColumn("mods", "download_url", "TEXT DEFAULT ''");

async function setupOwner() {
    const username = process.env.OWNER_USERNAME || "chilly";
    const passwordHash = await bcrypt.hash(process.env.OWNER_PASSWORD, 12);

    const existing = db.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").get();

    if (existing) {
        db.prepare(`
            UPDATE users
            SET username = ?, password_hash = ?
            WHERE id = ?
        `).run(username, passwordHash, existing.id);
    } else {
        db.prepare(`
            INSERT INTO users (username, password_hash, role)
            VALUES (?, ?, 'owner')
        `).run(username, passwordHash);
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image uploads are allowed."));
        }
        cb(null, true);
    }
});

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(session({
    store: new SQLiteStore({
        db: "sessions.sqlite",
        dir: DATA_DIR
    }),
    secret: process.env.SESSION_SECRET || "development-secret-only",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
});

function requireOwner(req, res, next) {
    if (!req.session.user || req.session.user.role !== "owner") {
        return res.status(403).json({ error: "Owner access required." });
    }
    next();
}

function validUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

// Account information
app.get("/api/me", (req, res) => {
    res.json({
        user: req.session.user || null
    });
});

// Owner login
app.post("/api/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Enter your username and password." });
    }

    const user = db.prepare(
        "SELECT * FROM users WHERE username = ? AND role = 'owner'"
    ).get(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "Incorrect login details." });
    }

    req.session.regenerate(err => {
        if (err) return res.status(500).json({ error: "Login failed." });

        req.session.user = {
            id: user.id,
            username: user.username,
            role: "owner"
        };

        res.json({ success: true, user: req.session.user });
    });
});

// Logout
app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ success: true });
    });
});

// Get mods
app.get("/api/mods", (req, res) => {
    const search = String(req.query.q || "").trim();

    let mods = db.prepare(`
        SELECT id, name, game, description, version,
               compatibility, instructions, image_url,
               download_url, downloads, created_at
        FROM mods
        ORDER BY created_at DESC
    `).all();

    if (search) {
        const term = search.toLowerCase();
        mods = mods.filter(mod =>
            [mod.name, mod.game, mod.description]
                .some(value => String(value || "").toLowerCase().includes(term))
        );
    }

    res.json({ mods });
});

// Add a mod — owner only
app.post("/api/mods", requireOwner, upload.single("image"), (req, res) => {
    const {
        name,
        description,
        game,
        download_url,
        version,
        compatibility,
        instructions
    } = req.body;

    if (!name || !download_url || !validUrl(download_url)) {
        return res.status(400).json({
            error: "A mod name and valid download URL are required."
        });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";

    const result = db.prepare(`
        INSERT INTO mods
        (name, game, description, version, compatibility,
         instructions, author_id, image_url, download_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        name,
        game || "",
        description || "",
        version || "",
        compatibility || "",
        instructions || "",
        req.session.user.id,
        imageUrl,
        download_url
    );

    res.json({ success: true, id: result.lastInsertRowid });
});

// Edit a mod — owner only
app.put("/api/mods/:id", requireOwner, upload.single("image"), (req, res) => {
    const mod = db.prepare("SELECT * FROM mods WHERE id = ?").get(req.params.id);

    if (!mod) return res.status(404).json({ error: "Mod not found." });

    const name = req.body.name || mod.name;
    const description = req.body.description ?? mod.description;
    const downloadUrl = req.body.download_url || mod.download_url;

    if (!validUrl(downloadUrl)) {
        return res.status(400).json({ error: "Invalid download URL." });
    }

    const imageUrl = req.file
        ? `/uploads/${req.file.filename}`
        : mod.image_url;

    db.prepare(`
        UPDATE mods
        SET name = ?, description = ?, download_url = ?, image_url = ?
        WHERE id = ?
    `).run(name, description, downloadUrl, imageUrl, mod.id);

    res.json({ success: true });
});

// Delete a mod — owner only
app.delete("/api/mods/:id", requireOwner, (req, res) => {
    db.prepare("DELETE FROM mods WHERE id = ?").run(req.params.id);
    res.json({ success: true });
});

// Count a download and redirect
app.get("/api/mods/:id/download", (req, res) => {
    const mod = db.prepare(
        "SELECT download_url FROM mods WHERE id = ?"
    ).get(req.params.id);

    if (!mod || !validUrl(mod.download_url)) {
        return res.status(404).send("Download not found.");
    }

    db.prepare(
        "UPDATE mods SET downloads = downloads + 1 WHERE id = ?"
    ).run(req.params.id);

    res.redirect(mod.download_url);
});

// Get tools
app.get("/api/tools", (req, res) => {
    const tools = db.prepare(
        "SELECT * FROM tools ORDER BY created_at DESC"
    ).all();

    res.json({ tools });
});

// Add a tool — owner only
app.post("/api/tools", requireOwner, (req, res) => {
    const { name, description, url } = req.body;

    if (!name || !url || !validUrl(url)) {
        return res.status(400).json({ error: "Enter a name and valid URL." });
    }

    const result = db.prepare(`
        INSERT INTO tools (name, description, url)
        VALUES (?, ?, ?)
    `).run(name, description || "", url);

    res.json({ success: true, id: result.lastInsertRowid });
});

// Delete a tool — owner only
app.delete("/api/tools/:id", requireOwner, (req, res) => {
    db.prepare("DELETE FROM tools WHERE id = ?").run(req.params.id);
    res.json({ success: true });
});

// Uploaded images
app.use("/uploads", express.static(UPLOAD_DIR));

// Website files
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(400).json({ error: err.message || "Something went wrong." });
});

setupOwner().then(() => {
    app.listen(PORT, () => {
        console.log(`PENG.LOL running on port ${PORT}`);
    });
}).catch(err => {
    console.error("Owner setup failed:", err);
    process.exit(1);
});
