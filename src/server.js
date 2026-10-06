require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_RENDER";

const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    })
  : null;

// =========================
// BASIC SETTINGS
// =========================

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// =========================
// FRONTEND
// =========================

const publicPath = path.join(__dirname, "..", "public");

app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// =========================
// HEALTH
// =========================

app.get("/api/health", async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        status: "online",
        database: "not configured",
      });
    }

    await pool.query("SELECT 1");

    res.json({
      status: "online",
      database: "connected",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// =========================
// HELPERS
// =========================

function generatePublicCode() {
  return (
    "PD-" +
    crypto.randomBytes(5).toString("hex").toUpperCase()
  );
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      publicCode: user.public_code,
    },
    JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );
}

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Требуется авторизация",
      });
    }

    const token = header.substring(7);

    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Недействительный токен",
    });
  }
}

// =========================
// REGISTER
// =========================

app.post("/api/auth/register", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        error: "PostgreSQL ещё не подключён",
      });
    }

    const {
      name,
      bio = "",
      password,
    } = req.body;

    if (!name || !password) {
      return res.status(400).json({
        error: "Введите имя и пароль",
      });
    }

    if (String(name).length < 2) {
      return res.status(400).json({
        error: "Имя слишком короткое",
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        error: "Пароль должен содержать минимум 6 символов",
      });
    }

    let publicCode;

    for (let i = 0; i < 10; i++) {
      const candidate = generatePublicCode();

      const check = await pool.query(
        "SELECT id FROM users WHERE public_code = $1",
        [candidate]
      );

      if (check.rows.length === 0) {
        publicCode = candidate;
        break;
      }
    }

    if (!publicCode) {
      return res.status(500).json({
        error: "Не удалось создать публичный код",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users
      (
        public_code,
        name,
        bio,
        password_hash
      )
      VALUES
      ($1, $2, $3, $4)
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
        String(bio || "").trim(),
        passwordHash,
      ]
    );

    const user = result.rows[0];

    const token = createToken(user);

    res.status(201).json({
      user: {
        id: user.id,
        publicCode: user.public_code,
        name: user.name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
      },
      token,
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      error: "Ошибка регистрации",
    });
  }
});

// =========================
// LOGIN
// =========================

app.post("/api/auth/login", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        error: "PostgreSQL ещё не подключён",
      });
    }

    const {
      publicCode,
      password,
      code,
    } = req.body;

    const finalCode = publicCode || code;

    if (!finalCode || !password) {
      return res.status(400).json({
        error: "Введите публичный код и пароль",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        public_code,
        name,
        bio,
        avatar_url,
        password_hash
      FROM users
      WHERE UPPER(public_code) = UPPER($1)
      LIMIT 1
      `,
      [String(finalCode).trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Пользователь не найден",
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Неверный пароль",
      });
    }

    const token = createToken(user);

    res.json({
      user: {
        id: user.id,
        publicCode: user.public_code,
        name: user.name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
      },
      token,
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      error: "Ошибка входа",
    });
  }
});

// =========================
// CURRENT USER
// =========================

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

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Пользователь не найден",
      });
    }

    const user = result.rows[0];

    res.json({
      id: user.id,
      publicCode: user.public_code,
      name: user.name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка получения профиля",
    });
  }
});

// =========================
// UPDATE PROFILE
// =========================

app.patch("/api/me", auth, async (req, res) => {
  try {
    const {
      name,
      bio,
      avatarUrl,
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
        avatar_url
      `,
      [
        name ?? null,
        bio ?? null,
        avatarUrl ?? null,
        req.user.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Пользователь не найден",
      });
    }

    const user = result.rows[0];

    res.json({
      id: user.id,
      publicCode: user.public_code,
      name: user.name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка обновления профиля",
    });
  }
});

// =========================
// SEARCH USER BY PUBLIC CODE
// =========================

app.get(
  "/api/users/by-code/:code",
  auth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          public_code,
          name,
          bio,
          avatar_url
        FROM users
        WHERE UPPER(public_code) = UPPER($1)
        LIMIT 1
        `,
        [req.params.code.trim()]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Пользователь не найден",
        });
      }

      const user = result.rows[0];

      res.json({
        id: user.id,
        publicCode: user.public_code,
        name: user.name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка поиска",
      });
    }
  }
);

// =========================
// CONTACTS
// =========================

// Новый вариант
app.post(
  "/api/contacts/:userId",
  auth,
  async (req, res) => {
    try {
      const contactId = Number(req.params.userId);

      if (!Number.isInteger(contactId)) {
        return res.status(400).json({
          error: "Неверный ID пользователя",
        });
      }

      if (contactId === Number(req.user.id)) {
        return res.status(400).json({
          error: "Нельзя добавить самого себя",
        });
      }

      await pool.query(
        `
        INSERT INTO contacts
        (
          user_id,
          contact_id
        )
        VALUES
        ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [req.user.id, contactId]
      );

      res.json({
        success: true,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка добавления контакта",
      });
    }
  }
);

// Совместимость со старым frontend
app.post(
  "/api/contacts",
  auth,
  async (req, res) => {
    try {
      const contactId = Number(req.body.userId);

      if (!Number.isInteger(contactId)) {
        return res.status(400).json({
          error: "Неверный ID пользователя",
        });
      }

      if (contactId === Number(req.user.id)) {
        return res.status(400).json({
          error: "Нельзя добавить самого себя",
        });
      }

      await pool.query(
        `
        INSERT INTO contacts
        (
          user_id,
          contact_id
        )
        VALUES
        ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [req.user.id, contactId]
      );

      res.json({
        success: true,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка добавления контакта",
      });
    }
  }
);

app.get(
  "/api/contacts",
  auth,
  async (req, res) => {
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
        JOIN users u
          ON u.id = c.contact_id
        WHERE c.user_id = $1
        ORDER BY u.name ASC
        `,
        [req.user.id]
      );

      res.json(
        result.rows.map((user) => ({
          id: user.id,
          publicCode: user.public_code,
          name: user.name,
          bio: user.bio,
          avatarUrl: user.avatar_url,
        }))
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка получения контактов",
      });
    }
  }
);

// =========================
// DIRECT CHAT
// =========================

app.post(
  "/api/chats/direct/:userId",
  auth,
  async (req, res) => {
    try {
      const otherUserId = Number(req.params.userId);

      if (!Number.isInteger(otherUserId)) {
        return res.status(400).json({
          error: "Неверный пользователь",
        });
      }

      if (otherUserId === Number(req.user.id)) {
        return res.status(400).json({
          error: "Нельзя создать чат с собой",
        });
      }

      const existing = await pool.query(
        `
        SELECT c.id
        FROM chats c
        JOIN chat_members cm1
          ON cm1.chat_id = c.id
        JOIN chat_members cm2
          ON cm2.chat_id = c.id
        WHERE c.type = 'direct'
          AND cm1.user_id = $1
          AND cm2.user_id = $2
        LIMIT 1
        `,
        [req.user.id, otherUserId]
      );

      if (existing.rows.length > 0) {
        return res.json({
          chatId: existing.rows[0].id,
        });
      }

      const chatResult = await pool.query(
        `
        INSERT INTO chats(type)
        VALUES ('direct')
        RETURNING id
        `
      );

      const chatId = chatResult.rows[0].id;

      await pool.query(
        `
        INSERT INTO chat_members
        (
          chat_id,
          user_id
        )
        VALUES
        ($1, $2),
        ($1, $3)
        `,
        [
          chatId,
          req.user.id,
          otherUserId,
        ]
      );

      res.status(201).json({
        chatId,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка создания чата",
      });
    }
  }
);

// =========================
// GET MESSAGES
// =========================

app.get(
  "/api/chats/:chatId/messages",
  auth,
  async (req, res) => {
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

      if (member.rows.length === 0) {
        return res.status(403).json({
          error: "Нет доступа к этому чату",
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
        JOIN users u
          ON u.id = m.sender_id
        WHERE m.chat_id = $1
        ORDER BY m.created_at ASC
        LIMIT 200
        `,
        [chatId]
      );

      res.json(
        result.rows.map((message) => ({
          id: message.id,
          chatId: message.chat_id,
          senderId: message.sender_id,
          senderName: message.sender_name,
          type: message.type,
          text: message.text,
          fileUrl: message.file_url,
          fileName: message.file_name,
          fileSize: message.file_size,
          mimeType: message.mime_type,
          createdAt: message.created_at,
        }))
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка загрузки сообщений",
      });
    }
  }
);

// =========================
// SEND MESSAGE
// =========================

app.post(
  "/api/chats/:chatId/messages",
  auth,
  async (req, res) => {
    try {
      const chatId = Number(req.params.chatId);

      const {
        text = "",
        type = "text",
      } = req.body;

      if (!String(text).trim()) {
        return res.status(400).json({
          error: "Сообщение пустое",
        });
      }

      const member = await pool.query(
        `
        SELECT 1
        FROM chat_members
        WHERE chat_id = $1
          AND user_id = $2
        `,
        [chatId, req.user.id]
      );

      if (member.rows.length === 0) {
        return res.status(403).json({
          error: "Нет доступа к чату",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO messages
        (
          chat_id,
          sender_id,
          type,
          text
        )
        VALUES
        ($1, $2, $3, $4)
        RETURNING
          id,
          chat_id,
          sender_id,
          type,
          text,
          created_at
        `,
        [
          chatId,
          req.user.id,
          type,
          String(text).trim(),
        ]
      );

      const message = result.rows[0];

      broadcastToChat(chatId, {
        event: "message",
        message,
      });

      res.status(201).json({
        ...message,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка отправки сообщения",
      });
    }
  }
);

// =========================
// WEBSOCKET
// =========================

const wss = new WebSocketServer({
  server,
  path: "/ws",
});

const sockets = new Map();

wss.on("connection", (ws, req) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(1008, "No token");
      return;
    }

    const user = jwt.verify(
      token,
      JWT_SECRET
    );

    ws.userId = Number(user.id);

    if (!sockets.has(ws.userId)) {
      sockets.set(ws.userId, new Set());
    }

    sockets.get(ws.userId).add(ws);

    ws.send(
      JSON.stringify({
        event: "connected",
      })
    );

    ws.on("close", () => {
      const userSockets = sockets.get(ws.userId);

      if (!userSockets) return;

      userSockets.delete(ws);

      if (userSockets.size === 0) {
        sockets.delete(ws.userId);
      }
    });
  } catch (error) {
    ws.close(1008, "Invalid token");
  }
});

async function broadcastToChat(chatId, payload) {
  try {
    const members = await pool.query(
      `
      SELECT user_id
      FROM chat_members
      WHERE chat_id = $1
      `,
      [chatId]
    );

    for (const member of members.rows) {
      const userSockets = sockets.get(
        Number(member.user_id)
      );

      if (!userSockets) continue;

      for (const ws of userSockets) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      }
    }
  } catch (error) {
    console.error(
      "WEBSOCKET BROADCAST ERROR:",
      error
    );
  }
}

// =========================
// 404 API
// =========================

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found",
  });
});

// =========================
// START
// =========================

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `PrēDa server started on port ${PORT}`
  );
  console.log(
    `Frontend directory: ${publicPath}`
  );
});