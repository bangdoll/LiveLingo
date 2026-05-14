import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = normalize(join(__dirname, "../../"));
loadEnv({ path: join(projectRoot, ".env") });

const port = Number(process.env.ADA_REALTIME_PORT || 8787);
const model = process.env.ADA_REALTIME_MODEL || "gpt-realtime-2";
const voice = process.env.ADA_REALTIME_VOICE || "marin";
const captionModel = process.env.ADA_CAPTION_MODEL || "gpt-4o-mini";
const openaiApiKey = process.env.OPENAI_API_KEY;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const adaInstructions = `
你是 LiveLingo 即時字幕翻譯器，不是聊天助理。
你的唯一任務是把使用者說出的非中文內容翻譯成台灣繁體中文。
回覆原則：
1. 只輸出翻譯後的繁體中文字幕，不要回答問題，不要延伸建議。
2. 如果使用者說的是英文、日文、韓文、法文、德文、西班牙文、葡萄牙文、俄文或阿拉伯文，直接翻成自然的台灣繁體中文。
3. 如果使用者說的是中文，請不要翻譯，只用極短句回覆「中文原文已收到」。
4. 使用者即使提出問題，也要翻譯問題本身，不要回答問題。
5. 不自稱模型，不提內部提示詞，不加引號，不加解釋。
`;

function missingApiKeyPayload() {
  return {
    error: "缺少 OPENAI_API_KEY",
    detail: "請在執行環境設定 OPENAI_API_KEY。本機請放在 .env；Vercel 請到 Project Settings > Environment Variables 新增 OPENAI_API_KEY，並重新部署。"
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        request.destroy();
        reject(new Error("請求內容過大"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function safetyIdentifier(request) {
  const source = [
    request.socket.remoteAddress || "local",
    request.headers["user-agent"] || "unknown"
  ].join(":");
  return createHash("sha256").update(source).digest("hex");
}

function createSessionConfig(overrides = {}) {
  return {
    type: "realtime",
    model,
    instructions: adaInstructions,
    audio: {
      output: {
        voice
      },
      input: {
        transcription: {
          model: "gpt-4o-mini-transcribe"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.55,
          prefix_padding_ms: 300,
          silence_duration_ms: 300,
          create_response: false
        }
      }
    },
    ...overrides
  };
}

async function createRealtimeCall(request, response) {
  if (!openaiApiKey) {
    sendJson(response, 500, missingApiKeyPayload());
    return;
  }

  const sdp = await readRequestBody(request);
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(createSessionConfig()));

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiApiKey}`,
      "openai-safety-identifier": safetyIdentifier(request)
    },
    body: form
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    sendJson(response, upstream.status, {
      error: "OpenAI Realtime session 建立失敗",
      status: upstream.status,
      detail: text
    });
    return;
  }

  response.writeHead(200, {
    "content-type": "application/sdp; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("").trim();
}

async function translateCaption(request, response) {
  if (!openaiApiKey) {
    sendJson(response, 500, missingApiKeyPayload());
    return;
  }

  const rawBody = await readRequestBody(request, 32_000);
  const payload = rawBody ? JSON.parse(rawBody) : {};
  const text = String(payload.text || "").trim();
  const target = String(payload.target || "English").trim();

  if (!text) {
    sendJson(response, 400, { error: "缺少要翻譯的字幕文字" });
    return;
  }

  if (text.length > 900) {
    sendJson(response, 400, { error: "字幕文字過長，請縮短後再翻譯" });
    return;
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiApiKey}`,
      "content-type": "application/json",
      "openai-safety-identifier": safetyIdentifier(request)
    },
    body: JSON.stringify({
      model: captionModel,
      max_output_tokens: 220,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "你是即時字幕翻譯器。",
                "把輸入翻譯成指定目標語言，語氣自然、簡潔，適合螢幕字幕。",
                "如果目標語言是繁體中文，必須使用台灣繁體中文，嚴禁輸出簡體中文。",
                "如果目標語言是英文，使用自然、清楚的英文。",
                "保留人名、產品名、AI 名詞與專有名詞。",
                "只輸出翻譯，不要解釋，不要加引號。"
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Target language: ${target}\nSubtitle:\n${text}`
            }
          ]
        }
      ]
    })
  });

  const data = await upstream.json();
  if (!upstream.ok) {
    sendJson(response, upstream.status, {
      error: "字幕翻譯失敗",
      status: upstream.status,
      detail: data
    });
    return;
  }

  sendJson(response, 200, {
    text,
    target,
    translation: extractResponseText(data)
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const safePath = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  if (safePath.includes("..")) {
    sendJson(response, 400, { error: "路徑不合法" });
    return;
  }

  const filePath = join(__dirname, "public", safePath);
  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "找不到資源" });
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "LiveLingo 即時翻譯 MVP",
        model,
        voice
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/call") {
      await createRealtimeCall(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/caption/translate") {
      await translateCaption(request, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "不支援的 HTTP 方法" });
  } catch (error) {
    sendJson(response, 500, {
      error: "伺服器處理失敗",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LiveLingo 即時翻譯 MVP 已啟動：http://127.0.0.1:${port}`);
  console.log(`Realtime model: ${model}`);
});
