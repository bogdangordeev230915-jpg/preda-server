require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_RENDER";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.get("/", (req, res) => {
  res.json({
    service: "PrēDa Messenger Server",
    status: "online"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      server: "online",
      database: "online"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      server: "online",
      database: "offline"
    });
  }
});

function generateCode() {
  return (
    "PD-" +
    crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()
  );
}

async function generateUniqueCode() {
  while (true) {
    const code = generateCode();

    const result = await pool.query(
      "SELECT id FROM users WHERE public_code = $1",
      [code]
    );

    if (result.rows.length === 0) {
      return code;
    }
  }
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      publicCode: user.public_code
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Требуется авторизация"
    });
  }

  const token = header.substring(7);

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Недействительный токен"
    });
  }
}

/*
================================
REGISTRATION
================================
*/

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, bio = "", password } = req.body;

    if (!name || !password) {
      return res.status(400).json({
        error: "Укажите имя и пароль"
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        error: "Имя слишком длинное"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Пароль должен содержать минимум 6 символов"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const publicCode = await generateUniqueCode();

    const result = await pool.query(
      `
      INSERT INTO users
      (public_code, name, bio, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, public_code, name, bio, avatar_url, created_at
      `,
      [publicCode, name, bio, passwordHash]
    );

    const user = result.rows[0];

    res.status(201).json({
      user,
      token: createToken(user)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка регистрации"
    });
  }
});

/*
================================
LOGIN
================================
*/

app.post("/api/auth/login", async (req, res) => {
  try {
    const { publicCode, password } = req.body;

    if (!publicCode || !password) {
      return res.status(400).json({
        error: "Введите код и пароль"
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE public_code = $1",
      [publicCode.toUpperCase()]
    );

    if (result.rows.length === 0) {
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

    res.json({
      user: {
        id: user.id,
        public_code: user.public_code,
        name: user.name,
        bio: user.bio,
        avatar_url: user.avatar_url,
        created_at: user.created_at
      },
      token: createToken(user)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка входа"
    });
  }
});

/*
================================
MY PROFILE
================================
*/

app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, public_code, name, bio,
             avatar_url, created_at
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Пользователь не найден"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: "Ошибка получения профиля"
    });
  }
});

app.patch("/api/me", auth, async (req, res) => {
  try {
    const { name, bio, avatar_url } = req.body;

    const result = await pool.query(
      `
      UPDATE users
      SET
        name = COALESCE($1, name),
        bio = COALESCE($2, bio),
        avatar_url = COALESCE($3, avatar_url)
      WHERE id = $4
      RETURNING id, public_code, name, bio,
                avatar_url, created_at
      `,
      [name, bio, avatar_url, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: "Ошибка изменения профиля"
    });
  }
});

/*
================================
SEARCH USER BY PUBLIC CODE
================================
*/

app.get(
  "/api/users/by-code/:code",
  auth,
  async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();

      const result = await pool.query(
        `
        SELECT id, public_code, name, bio, avatar_url
        FROM users
        WHERE public_code = $1
        `,
        [code]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Пользователь не найден"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({
        error: "Ошибка поиска"
      });
    }
  }
);

/*
================================
ADD CONTACT
================================
*/

app.post(
  "/api/contacts/:userId",
  auth,
  async (req, res) => {
    try {
      const contactId = Number(req.params.userId);

      if (contactId === Number(req.user.id)) {
        return res.status(400).json({
          error: "Нельзя добавить самого себя"
        });
      }

      await pool.query(
        `
        INSERT INTO contacts
        (user_id, contact_id)
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
        error: "Ошибка добавления контакта"
      });
    }
  }
);

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
      JOIN users u
        ON u.id = c.contact_id
      WHERE c.user_id = $1
      ORDER BY u.name
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Ошибка получения контактов"
    });
  }
});

/*
================================
CREATE DIRECT CHAT
================================
*/

app.post(
  "/api/chats/direct/:userId",
  auth,
  async (req, res) => {
    const otherUserId = Number(req.params.userId);

    if (otherUserId === Number(req.user.id)) {
      return res.status(400).json({
        error: "Нельзя создать чат с самим собой"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `
        SELECT c.id
        FROM chats c
        JOIN chat_members a
          ON a.chat_id = c.id
        JOIN chat_members b
          ON b.chat_id = c.id
        WHERE c.type = 'direct'
          AND a.user_id = $1
          AND b.user_id = $2
        LIMIT 1
        `,
        [req.user.id, otherUserId]
      );

      if (existing.rows.length > 0) {
        await client.query("COMMIT");

        return res.json({
          chatId: existing.rows[0].id
        });
      }

      const chat = await client.query(
        `
        INSERT INTO chats(type)
        VALUES('direct')
        RETURNING id
        `
      );

      const chatId = chat.rows[0].id;

      await client.query(
        `
        INSERT INTO chat_members(chat_id, user_id)
        VALUES
        ($1, $2),
        ($1, $3)
        `,
        [chatId, req.user.id, otherUserId]
      );

      await client.query("COMMIT");

      res.status(201).json({
        chatId
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res.status(500).json({
        error: "Ошибка создания чата"
      });
    } finally {
      client.release();
    }
  }
);

/*
================================
GET MESSAGES
================================
*/

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
          u.name AS sender_name,
          u.avatar_url AS sender_avatar
        FROM messages m
        JOIN users u
          ON u.id = m.sender_id
        WHERE m.chat_id = $1
        ORDER BY m.created_at ASC
        LIMIT 500
        `,
        [chatId]
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({
        error: "Ошибка получения сообщений"
      });
    }
  }
);

/*
================================
SEND TEXT MESSAGE
================================
*/

app.post(
  "/api/chats/:chatId/messages",
  auth,
  async (req, res) => {
    try {
      const chatId = Number(req.params.chatId);
      const { text } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({
          error: "Сообщение пустое"
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
          error: "Нет доступа к чату"
        });
      }

      const result = await pool.query(
        `
        INSERT INTO messages
        (chat_id, sender_id, type, text)
        VALUES ($1, $2, 'text', $3)
        RETURNING *
        `,
        [chatId, req.user.id, text.trim()]
      );

      const message = result.rows[0];

      broadcastToChat(chatId, {
        event: "message",
        message
      });

      res.status(201).json(message);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка отправки сообщения"
      });
    }
  }
);

/*
================================
WEBSOCKET
================================
*/

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

const connections = new Map();

wss.on("connection", (socket, request) => {
  try {
    const url = new URL(
      request.url,
      `http://${request.headers.host}`
    );

    const token = url.searchParams.get("token");

    if (!token) {
      socket.close();
      return;
    }

    const user = jwt.verify(token, JWT_SECRET);

    socket.userId = user.id;

    if (!connections.has(user.id)) {
      connections.set(user.id, new Set());
    }

    connections.get(user.id).add(socket);

    socket.send(
      JSON.stringify({
        event: "connected"
      })
    );

    socket.on("close", () => {
      const set = connections.get(user.id);

      if (!set) return;

      set.delete(socket);

      if (set.size === 0) {
        connections.delete(user.id);
      }
    });
  } catch {
    socket.close();
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

    for (const row of result.rows) {
      const sockets = connections.get(row.user_id);

      if (!sockets) continue;

      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      }
    }
  } catch (error) {
    console.error("Broadcast error:", error);
  }
}

/*
================================
START SERVER
================================
*/

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `PrēDa server started on port ${PORT}`
    );
  }
);