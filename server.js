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

// ENVIRONMENT VARIABLES

const OWNER_USERNAME = (process.env.OWNER_USERNAME || "PENG").trim();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!OWNER_PASSWORD) {
    throw new Error("OWNER_PASSWORD is missing from Render environment variables.");
}

if (process.env.NODE_ENV === "production" && !SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing from Render environment variables.");
}

// DATABASE

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

    if (!columns.some(col => col.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

addColumn("mods", "image_url", "TEXT DEFAULT ''");
addColumn("mods", "download_url", "TEXT DEFAULT ''");

// OWNER ACCOUNT

async function setupOwner() {
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 12);

    const existing = db.prepare(
        "SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1"
    ).get();

    if (existing) {
        db.prepare(`
            UPDATE users
            SET username = ?, password_hash = ?, role = 'owner'
            WHERE id = ?
        `).run(OWNER_USERNAME, passwordHash, existing.id);

        console.log("Owner account updated.");
    } else {
        db.prepare(`
            INSERT INTO users (username, password_hash, role)
            VALUES (?, ?, 'owner')
        `).run(OWNER_USERNAME, passwordHash);

        console.log("Owner account created.");
    }
}

// IMAGE UPLOADS

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image uploads are allowed."));
        }

        cb(null, true);
    }
});

// SECURITY AND MIDDLEWARE

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(session({
    name: "penglol.sid",

    store: new SQLiteStore({
        db: "sessions.sqlite",
        dir: DATA_DIR
    }),

    secret: SESSION_SECRET || "development-only-secret",
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

// HELPERS

function requireOwner(req, res, next) {
    if (!req.session.user || req.session.user.role !== "owner") {
        return res.status(403).json({
            error: "Owner access required. Please log in."
        });
    }

    next();
}

function validUrl(value) {
    try {
        const url = new URL(value);

        return url.protocol === "https:" ||
            url.protocol === "http:";
    } catch {
        return false;
    }
}

// HEALTH CHECK

app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        website: "PENG.LOL"
    });
});

// ACCOUNT INFORMATION

app.get("/api/me", (req, res) => {
    res.json({
        user: req.session.user || null
    });
});

// LOGIN

app.post("/api/login", loginLimiter, async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = req.body.password;

        if (!username || typeof password !== "string" || !password) {
            return res.status(400).json({
                error: "Enter your username and password."
            });
        }

        const user = db.prepare(`
            SELECT * FROM users
            WHERE username = ? AND role = 'owner'
        `).get(username);

        if (!user) {
            return res.status(401).json({
                error: "Incorrect username or password."
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                error: "Incorrect username or password."
            });
        }

        req.session.regenerate(err => {
            if (err) {
                console.error("Session error:", err);

                return res.status(500).json({
                    error: "Could not create login session."
                });
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                role: "owner"
            };

            req.session.save(saveError => {
                if (saveError) {
                    console.error("Session save error:", saveError);

                    return res.status(500).json({
                        error: "Could not save login session."
                    });
                }

                res.json({
                    success: true,
                    user: req.session.user
                });
            });
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            error: "Login failed. Please try again."
        });
    }
});

// LOGOUT

app.post("/api/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);

            return res.status(500).json({
                error: "Could not log out."
            });
        }

        res.clearCookie("penglol.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });

        res.json({ success: true });
    });
});

// GET MODS

app.get("/api/mods", (req, res) => {
    try {
        const search = String(req.query.q || "").trim().toLowerCase();

        let mods = db.prepare(`
            SELECT id, name, game, description, version,
                   compatibility, instructions, image_url,
                   download_url, downloads, created_at
            FROM mods
            ORDER BY created_at DESC
        `).all();

        if (search) {
            mods = mods.filter(mod =>
                [mod.name, mod.game, mod.description]
                    .some(value =>
                        String(value || "").toLowerCase().includes(search)
                    )
            );
        }

        res.json({ mods });
    } catch (error) {
        console.error("Get mods error:", error);

        res.status(500).json({
            error: "Could not load mods."
        });
    }
});

// ADD MOD

app.post("/api/mods", requireOwner, upload.single("image"), (req, res) => {
    try {
        const {
            name,
            description,
            game,
            download_url,
            version,
            compatibility,
            instructions
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                error: "Enter a mod name."
            });
        }

        if (!download_url || !validUrl(download_url)) {
            return res.status(400).json({
                error: "Enter a valid download URL."
            });
        }

        const imageUrl = req.file
            ? `/uploads/${req.file.filename}`
            : "";

        const result = db.prepare(`
            INSERT INTO mods (
                name, game, description, version,
                compatibility, instructions, author_id,
                image_url, download_url
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            name.trim(),
            game || "",
            description || "",
            version || "",
            compatibility || "",
            instructions || "",
            req.session.user.id,
            imageUrl,
            download_url.trim()
        );

        res.json({
            success: true,
            id: result.lastInsertRowid
        });
    } catch (error) {
        console.error("Add mod error:", error);

        res.status(500).json({
            error: "Could not publish mod."
        });
    }
});

// EDIT MOD

app.put("/api/mods/:id", requireOwner, upload.single("image"), (req, res) => {
    try {
        const mod = db.prepare(
            "SELECT * FROM mods WHERE id = ?"
        ).get(req.params.id);

        if (!mod) {
            return res.status(404).json({
                error: "Mod not found."
            });
        }

        const name = req.body.name?.trim() || mod.name;
        const description = req.body.description ?? mod.description;
        const game = req.body.game ?? mod.game;
        const downloadUrl = req.body.download_url || mod.download_url;

        if (!validUrl(downloadUrl)) {
            return res.status(400).json({
                error: "Invalid download URL."
            });
        }

        const imageUrl = req.file
            ? `/uploads/${req.file.filename}`
            : mod.image_url;

        db.prepare(`
            UPDATE mods
            SET name = ?,
                game = ?,
                description = ?,
                download_url = ?,
                image_url = ?
            WHERE id = ?
        `).run(
            name,
            game,
            description,
            downloadUrl,
            imageUrl,
            mod.id
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Edit mod error:", error);

        res.status(500).json({
            error: "Could not update mod."
        });
    }
});

// DELETE MOD

app.delete("/api/mods/:id", requireOwner, (req, res) => {
    try {
        db.prepare(
            "DELETE FROM mods WHERE id = ?"
        ).run(req.params.id);

        res.json({ success: true });
    } catch (error) {
        console.error("Delete mod error:", error);

        res.status(500).json({
            error: "Could not delete mod."
        });
    }
});

// MOD DOWNLOAD

app.get("/api/mods/:id/download", (req, res) => {
    try {
        const mod = db.prepare(`
            SELECT download_url FROM mods WHERE id = ?
        `).get(req.params.id);

        if (!mod || !validUrl(mod.download_url)) {
            return res.status(404).send("Download not found.");
        }

        db.prepare(`
            UPDATE mods
            SET downloads = downloads + 1
            WHERE id = ?
        `).run(req.params.id);

        res.redirect(mod.download_url);
    } catch (error) {
        console.error("Download error:", error);

        res.status(500).send("Download failed.");
    }
});

// GET TOOLS

app.get("/api/tools", (req, res) => {
    try {
        const tools = db.prepare(`
            SELECT * FROM tools
            ORDER BY created_at DESC
        `).all();

        res.json({ tools });
    } catch (error) {
        console.error("Get tools error:", error);

        res.status(500).json({
            error: "Could not load tools."
        });
    }
});

// ADD TOOL

app.post("/api/tools", requireOwner, (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const description = String(req.body.description || "");
        const url = String(req.body.url || "").trim();

        if (!name || !url || !validUrl(url)) {
            return res.status(400).json({
                error: "Enter a tool name and valid URL."
            });
        }

        const result = db.prepare(`
            INSERT INTO tools (name, description, url)
            VALUES (?, ?, ?)
        `).run(name, description, url);

        res.json({
            success: true,
            id: result.lastInsertRowid
        });
    } catch (error) {
        console.error("Add tool error:", error);

        res.status(500).json({
            error: "Could not publish tool."
        });
    }
});

// DELETE TOOL

app.delete("/api/tools/:id", requireOwner, (req, res) => {
    try {
        db.prepare(
            "DELETE FROM tools WHERE id = ?"
        ).run(req.params.id);

        res.json({ success: true });
    } catch (error) {
        console.error("Delete tool error:", error);

        res.status(500).json({
            error: "Could not delete tool."
        });
    }
});

// UPLOADED IMAGES

app.use("/uploads", express.static(UPLOAD_DIR));

// WEBSITE FILES

app.use(express.static(path.join(__dirname, "public")));

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ERROR HANDLER

app.use((err, req, res, next) => {
    console.error("Server error:", err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(err instanceof multer.MulterError ? 400 : 500).json({
        error: err.message || "Something went wrong."
    });
});

// START SERVER

setupOwner()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`PENG.LOL running on port ${PORT}`);
        });
    })
    .catch(error => {
        console.error("Owner setup failed:", error);
        process.exit(1);
    });
