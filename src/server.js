require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "preda-change-this-secret-immediately";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* =========================
   DATABASE INITIALIZATION
========================= */

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    public_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    bio TEXT DEFAULT '',
    avatar_url TEXT,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, contact_id),
    CHECK (user_id <> contact_id)
);

CREATE TABLE IF NOT EXISTS chats (
    id BIGSERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL DEFAULT 'direct',
    name VARCHAR(150),
    description TEXT DEFAULT '',
    avatar_url TEXT,
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
    chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL DEFAULT 'text',
    text TEXT,
    file_url TEXT,
    file_name TEXT,
    file_size BIGINT,
    mime_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT DEFAULT '',
    avatar_url TEXT,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'subscriber',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_messages (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL DEFAULT 'text',
    text TEXT,
    file_url TEXT,
    file_name TEXT,
    file_size BIGINT,
    mime_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_public_code
ON users(public_code);

CREATE INDEX IF NOT EXISTS idx_messages_chat
ON messages(chat_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_members_user
ON chat_members(user_id);

CREATE INDEX IF NOT EXISTS idx_channel_messages
ON channel_messages(channel_id, created_at);
`;

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not configured.");
    return;
  }

  try {
    await pool.query(schema);
    console.log("PostgreSQL connected.");
    console.log("Database tables are ready.");
  } catch (error) {
    console.error("PostgreSQL initialization error:");
    console.error(error.message);
  }
}

/* =========================
   HELPERS
========================= */

function generatePublicCode() {
  return "PD-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      publicCode: user.public_code
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Требуется авторизация"
    });
  }

  const token = header.slice(7);

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Недействительный токен"
    });
  }
}

/* =========================
   BASIC ROUTES
========================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: true,
      service: "PrēDa Messenger Server"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: false,
      error: error.message
    });
  }
});

app.get("/api", (req, res) => {
  res.json({
    service: "PrēDa Messenger Server",
    status: "online"
  });
});

/* =========================
   REGISTRATION
========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      name,
      bio = "",
      password,
      avatar_url = null
    } = req.body;

    if (!name || !password) {
      return res.status(400).json({
        error: "Введите имя и пароль"
      });
    }

    if (String(name).trim().length < 1) {
      return res.status(400).json({
        error: "Имя не может быть пустым"
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        error: "Пароль должен содержать минимум 6 символов"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let publicCode;
    let user;

    for (let i = 0; i < 10; i++) {
      publicCode = generatePublicCode();

      try {
        const result = await pool.query(
          `
          INSERT INTO users
          (public_code, name, bio, avatar_url, password_hash)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING
            id,
            public_code,
            name,
            bio,
            avatar_url,
            created_at
          `,
          [
            publicCode,
            String(name).trim(),
            bio,
            avatar_url,
            passwordHash
          ]
        );

        user = result.rows[0];
        break;
      } catch (error) {
        if (error.code !== "23505") {
          throw error;
        }
      }
    }

    if (!user) {
      return res.status(500).json({
        error: "Не удалось создать уникальный код пользователя"
      });
    }

    const token = createToken(user);

    res.status(201).json({
      user,
      token
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      error: "Ошибка регистрации",
      details: error.message
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const publicCode = req.body.publicCode || req.body.code;
    const password = req.body.password;

    if (!publicCode || !password) {
      return res.status(400).json({
        error: "Введите код и пароль"
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE UPPER(public_code) = UPPER($1)
      LIMIT 1
      `,
      [publicCode.trim()]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Пользователь не найден"
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Неверный пароль"
      });
    }

    const token = createToken(user);

    delete user.password_hash;

    res.json({
      user,
      token
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      error: "Ошибка входа",
      details: error.message
    });
  }
});

/* =========================
   CURRENT USER
========================= */

app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        public_code,
        name,
        bio,
        avatar_url,
        created_at
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Пользователь не найден"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.patch("/api/me", auth, async (req, res) => {
  try {
    const {
      name,
      bio,
      avatar_url
    } = req.body;

    const result = await pool.query(
      `
      UPDATE users
      SET
        name = COALESCE($1, name),
        bio = COALESCE($2, bio),
        avatar_url = COALESCE($3, avatar_url)
      WHERE id = $4
      RETURNING
        id,
        public_code,
        name,
        bio,
        avatar_url,
        created_at
      `,
      [
        name ?? null,
        bio ?? null,
        avatar_url ?? null,
        req.user.id
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   USER SEARCH
========================= */

app.get("/api/users/by-code/:code", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        public_code,
        name,
        bio,
        avatar_url,
        created_at
      FROM users
      WHERE UPPER(public_code) = UPPER($1)
      `,
      [req.params.code.trim()]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Пользователь не найден"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   CONTACTS
========================= */

app.get("/api/contacts", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        u.id,
        u.public_code,
        u.name,
        u.bio,
        u.avatar_url
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = $1
      ORDER BY u.name
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/contacts/:userId", auth, async (req, res) => {
  try {
    const contactId = Number(req.params.userId);

    if (!Number.isInteger(contactId)) {
      return res.status(400).json({
        error: "Неверный пользователь"
      });
    }

    if (contactId === Number(req.user.id)) {
      return res.status(400).json({
        error: "Нельзя добавить себя"
      });
    }

    await pool.query(
      `
      INSERT INTO contacts (user_id, contact_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [req.user.id, contactId]
    );

    res.json({
      ok: true
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   DIRECT CHAT
========================= */

app.post("/api/chats/direct/:userId", auth, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId);

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({
        error: "Неверный пользователь"
      });
    }

    const existing = await pool.query(
      `
      SELECT c.id
      FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id
      JOIN chat_members cm2 ON cm2.chat_id = c.id
      WHERE c.type = 'direct'
        AND cm1.user_id = $1
        AND cm2.user_id = $2
      LIMIT 1
      `,
      [req.user.id, otherUserId]
    );

    if (existing.rows.length) {
      return res.json({
        chatId: existing.rows[0].id
      });
    }

    const chatResult = await pool.query(
      `
      INSERT INTO chats (type)
      VALUES ('direct')
      RETURNING id
      `
    );

    const chatId = chatResult.rows[0].id;

    await pool.query(
      `
      INSERT INTO chat_members
      (chat_id, user_id, role)
      VALUES
      ($1, $2, 'member'),
      ($1, $3, 'member')
      `,
      [chatId, req.user.id, otherUserId]
    );

    res.status(201).json({
      chatId
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   CHAT LIST
========================= */

app.get("/api/chats", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        c.id,
        c.type,
        c.name,
        c.description,
        c.avatar_url,
        c.created_at,
        (
          SELECT json_build_object(
            'id', u.id,
            'public_code', u.public_code,
            'name', u.name,
            'bio', u.bio,
            'avatar_url', u.avatar_url
          )
          FROM chat_members cm2
          JOIN users u ON u.id = cm2.user_id
          WHERE cm2.chat_id = c.id
            AND cm2.user_id <> $1
          LIMIT 1
        ) AS user
      FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE cm.user_id = $1
      ORDER BY c.created_at DESC
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   MESSAGES
========================= */

app.get("/api/chats/:chatId/messages", auth, async (req, res) => {
  try {
    const chatId = Number(req.params.chatId);

    const member = await pool.query(
      `
      SELECT 1
      FROM chat_members
      WHERE chat_id = $1
        AND user_id = $2
      `,
      [chatId, req.user.id]
    );

    if (!member.rows.length) {
      return res.status(403).json({
        error: "Нет доступа к этому чату"
      });
    }

    const result = await pool.query(
      `
      SELECT
        m.id,
        m.chat_id,
        m.sender_id,
        m.type,
        m.text,
        m.file_url,
        m.file_name,
        m.file_size,
        m.mime_type,
        m.created_at,
        u.name AS sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
      ORDER BY m.created_at ASC
      `,
      [chatId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/chats/:chatId/messages", auth, async (req, res) => {
  try {
    const chatId = Number(req.params.chatId);

    const member = await pool.query(
      `
      SELECT 1
      FROM chat_members
      WHERE chat_id = $1
        AND user_id = $2
      `,
      [chatId, req.user.id]
    );

    if (!member.rows.length) {
      return res.status(403).json({
        error: "Нет доступа к этому чату"
      });
    }

    const {
      text = "",
      type = "text",
      file_url = null,
      file_name = null,
      file_size = null,
      mime_type = null
    } = req.body;

    if (!text && !file_url) {
      return res.status(400).json({
        error: "Пустое сообщение"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO messages
      (
        chat_id,
        sender_id,
        type,
        text,
        file_url,
        file_name,
        file_size,
        mime_type
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        chatId,
        req.user.id,
        type,
        text,
        file_url,
        file_name,
        file_size,
        mime_type
      ]
    );

    const message = result.rows[0];

    broadcastToChat(chatId, {
      event: "message",
      message
    });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   WEBSOCKET
========================= */

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

const clients = new Map();

wss.on("connection", (ws, req) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const token = url.searchParams.get("token");

    if (!token) {
      ws.close();
      return;
    }

    const user = jwt.verify(token, JWT_SECRET);

    clients.set(ws, {
      userId: Number(user.id)
    });

    ws.send(
      JSON.stringify({
        event: "connected"
      })
    );

    ws.on("close", () => {
      clients.delete(ws);
    });
  } catch {
    ws.close();
  }
});

async function broadcastToChat(chatId, payload) {
  try {
    const result = await pool.query(
      `
      SELECT user_id
      FROM chat_members
      WHERE chat_id = $1
      `,
      [chatId]
    );

    const ids = new Set(
      result.rows.map(row => Number(row.user_id))
    );

    for (const [ws, client] of clients.entries()) {
      if (
        ws.readyState === WebSocket.OPEN &&
        ids.has(client.userId)
      ) {
        ws.send(JSON.stringify(payload));
      }
    }
  } catch (error) {
    console.error("WebSocket broadcast error:", error.message);
  }
}

/* =========================
   FRONTEND
========================= */

const publicPath = path.join(
  __dirname,
  "..",
  "public"
);

app.use(express.static(publicPath));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API route not found"
    });
  }

  res.sendFile(
    path.join(publicPath, "index.html")
  );
});

/* =========================
   START
========================= */

async function start() {
  await initDatabase();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`PrēDa server started on port ${PORT}`);
    console.log(`Frontend directory: ${publicPath}`);
  });
}

start().catch(error => {
  console.error("SERVER START ERROR:", error);
  process.exit(1);
});