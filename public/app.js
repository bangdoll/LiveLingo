const REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_TRANSLATE_MODEL = "gpt-realtime";
const TRANSLATE_ENABLED_KEY = "livelingo_translate_enabled";
const LEGACY_TRANSLATE_ENABLED_KEY = "livelingo_translate_mode";
const LIVE_TRANSLATION_DEBOUNCE_MS = 220;
const LOCAL_SPEECH_TRANSLATION_DEBOUNCE_MS = 120;
const LIVE_TRANSLATION_MIN_CHARS = 4;
const LIVE_SOURCE_MAX_WORDS = 14;
const LIVE_TRANSLATION_MAX_WORDS = 9;
const LIVE_TRANSLATION_MIN_WORDS = 3;
const LIVE_TRANSLATION_MAX_CHARS = 140;
const MAX_CAPTURED_SEGMENTS = 120;

const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const clearLogButton = document.querySelector("#clearLogButton");
const statusBadge = document.querySelector("#statusBadge");
const costBadge = document.querySelector("#costBadge");
const remoteAudio = document.querySelector("#remoteAudio");
const translateAudio = document.querySelector("#translateAudio");
const eventLog = document.querySelector("#eventLog");
const adaFace = document.querySelector("#adaFace");
const adaMouth = document.querySelector("#adaMouth");
let mouthAnimationId = null;
let currentFaceState = "idle";
const captionSpeaker = document.querySelector("#captionSpeaker");
const captionMode = document.querySelector("#captionMode");
const captionPrimary = document.querySelector("#captionPrimary");
const captionSecondary = document.querySelector("#captionSecondary");
const summarizeButton = document.querySelector("#summarizeButton");
const copySummaryButton = document.querySelector("#copySummaryButton");
const downloadSummaryButton = document.querySelector("#downloadSummaryButton");
const clearTranscriptButton = document.querySelector("#clearTranscriptButton");
const transcriptCount = document.querySelector("#transcriptCount");
const summaryOutput = document.querySelector("#summaryOutput");

// BYOK 設定
const settingsToggle = document.querySelector("#settingsToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const apiKeyInput = document.querySelector("#apiKeyInput");
const toggleKeyVisibility = document.querySelector("#toggleKeyVisibility");
const translateLangSelect = document.querySelector("#translateLang");
const enableTranslateModeCheckbox = document.querySelector("#enableTranslateMode");

// Realtime-Translate 狀態
let translatePeerConnection;
let translateDataChannel;
let translateModeActive = false;

let peerConnection;
let dataChannel;
let localStream;
let activeAssistantResponseId;
let activeAssistantText = "";
let translationSequence = 0;
let transcriptTextByRole = {
  user: "",
  assistant: ""
};
let translatedUntilByRole = {
  user: 0,
  assistant: 0
};
let sentenceTranslationQueueByRole = {
  user: Promise.resolve(),
  assistant: Promise.resolve()
};
let latestTranslationSequenceByRole = {
  user: 0,
  assistant: 0
};
let pendingTranslationByRole = {
  user: false,
  assistant: false
};
let liveTranslationTimersByRole = {
  user: undefined,
  assistant: undefined
};
let liveTranslationLastTextByRole = {
  user: "",
  assistant: ""
};
let liveTranslationInFlightByRole = {
  user: false,
  assistant: false
};
let pendingLiveTranslationTextByRole = {
  user: "",
  assistant: ""
};
let localSpeechRecognition;
let localSpeechActive = false;
let localSpeechFinalText = "";
let localSpeechInterimText = "";
let usingLocalSpeechCaptions = false;
let capturedTranscriptSegments = [];
let latestSummary = "";
let sessionTokens = 0;
let sessionCostUsd = 0;
let lifetimeTokens = Number(localStorage.getItem("livelingo_lifetime_tokens") || 0);
let lifetimeCostUsd = Number(localStorage.getItem("livelingo_lifetime_cost") || 0);
const MIN_FINAL_SENTENCE_CHARS = 4;

const captions = {
  user: {
    label: "你",
    source: "",
    translation: "",
    sourceLanguage: "zh-Hant"
  },
  assistant: {
    label: "Ada",
    source: "",
    translation: "",
    sourceLanguage: "zh-Hant"
  }
};

const languageLabels = {
  "zh-Hant": "中文",
  en: "英文",
  ja: "日文",
  es: "西班牙文",
  ko: "韓文",
  fr: "法文",
  de: "德文",
  pt: "葡萄牙文",
  ru: "俄文",
  ar: "阿拉伯文"
};

function setStatus(label, mode = "idle") {
  statusBadge.textContent = label;
  statusBadge.className = `status ${mode}`;
}

function setFaceState(state) {
  if (currentFaceState === state) return;
  currentFaceState = state;
  adaFace.className = `ada-face ${state}`;
  if (state === "speaking") {
    startMouthAnimation();
  } else {
    stopMouthAnimation();
  }
}

function startMouthAnimation() {
  stopMouthAnimation();
  let frame = 0;
  function animate() {
    frame += 1;
    // 模擬說話的嘴型變化 (用正弦波疊加)
    const openAmount = Math.abs(Math.sin(frame * 0.18)) * 0.6 + Math.abs(Math.sin(frame * 0.07)) * 0.4;
    const h = 4 + openAmount * 14;
    const w = 20 + openAmount * 10;
    const r = 4 + openAmount * 6;
    adaMouth.style.height = `${h}px`;
    adaMouth.style.width = `${w}px`;
    adaMouth.style.borderRadius = `${r}px`;
    mouthAnimationId = requestAnimationFrame(animate);
  }
  mouthAnimationId = requestAnimationFrame(animate);
}

function stopMouthAnimation() {
  if (mouthAnimationId) {
    cancelAnimationFrame(mouthAnimationId);
    mouthAnimationId = null;
  }
  adaMouth.style.height = "";
  adaMouth.style.width = "";
  adaMouth.style.borderRadius = "";
}

function logEvent(title, detail = "") {
  const item = document.createElement("div");
  item.className = "event";
  const strong = document.createElement("strong");
  strong.textContent = title;
  item.append(strong);
  if (detail) {
    const text = document.createElement("span");
    text.textContent = detail;
    item.append(text);
  }
  eventLog.prepend(item);
}

function eventSummary(event) {
  if (event.type === "response.audio_transcript.delta") return event.delta || "";
  if (event.type === "response.output_audio_transcript.delta") return event.delta || "";
  if (event.type === "response.audio_transcript.done") return event.transcript || "";
  if (event.type === "response.output_audio_transcript.done") return event.transcript || "";
  if (event.type === "response.created") return event.response?.metadata?.response_purpose || event.response?.id || "";
  if (event.type === "response.function_call_arguments.done") return `${event.name}: ${event.arguments || ""}`;
  if (event.type === "response.output_text.done") return event.text || "";
  if (event.type === "response.done") return event.response?.status || "";
  if (event.type === "conversation.item.input_audio_transcription.completed") return event.transcript || "";
  if (event.type === "error") return event.error?.message || "Realtime 發生錯誤";
  return "";
}

function normalizeCaptionText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function detectCaptionLanguage(text) {
  const normalized = normalizeCaptionText(text);
  if (/[\u3040-\u30ff]/.test(normalized)) return "ja";
  if (/[\uac00-\ud7af]/.test(normalized)) return "ko";
  if (/[\u0600-\u06ff]/.test(normalized)) return "ar";
  if (/[\u0400-\u04ff]/.test(normalized)) return "ru";
  if (/[\u3400-\u9fff]/.test(normalized)) return "zh-Hant";

  const lower = normalized.toLowerCase();
  if (/[ñ¿¡]/.test(lower) || /\b(el|la|los|las|que|para|con|una|estoy|quiero|hábito|mañana)\b/.test(lower)) return "es";
  if (/[àâçéèêëîïôùûüÿœ]/.test(lower) || /\b(le|la|les|des|une|avec|pour|bonjour|je|veux|être)\b/.test(lower)) return "fr";
  if (/[äöüß]/.test(lower) || /\b(der|die|das|und|ich|nicht|mit|für|ein|eine|möchte)\b/.test(lower)) return "de";
  if (/[ãõáàâêéíóôúç]/.test(lower) || /\b(o|a|os|as|que|para|com|uma|estou|quero|hábito)\b/.test(lower)) return "pt";
  return "en";
}

function captionModeLabel(sourceLanguage, mode) {
  const label = languageLabels[sourceLanguage] || "原語言";
  if (isChineseCaption(sourceLanguage)) return `第一語言：${label}・不翻譯・${mode}`;
  return `第一語言：${label} / 第二行：繁體中文・${mode}`;
}

function isChineseCaption(sourceLanguage) {
  return sourceLanguage === "zh-Hant";
}

function renderCaption(role, mode = "即時") {
  const caption = captions[role];
  const isChinese = isChineseCaption(caption.sourceLanguage);
  
  // 顯示當前辨識語言與目標語言
  const sourceLabel = languageLabels[caption.sourceLanguage] || "未知";
  const targetLang = resolveTranslateLang();
  const targetLabel = languageLabels[targetLang === "zh" ? "zh-Hant" : targetLang] || "繁體中文";
  
  if (role === "user") {
    captionSpeaker.textContent = `即時轉錄 (${sourceLabel} → ${targetLabel})`;
    captionMode.textContent = `模式: ${
      usingLocalSpeechCaptions
        ? "本機即時 + 背景校正"
        : translateModeActive
          ? "Realtime-Translate"
          : "標準"
    }・${mode}`;
  } else {
    captionSpeaker.textContent = "Ada";
    captionMode.textContent = mode;
  }
  
  captionPrimary.textContent = caption.source || (role === "user" ? "" : "正在聆聽...");
  captionPrimary.lang = caption.sourceLanguage;
  
  captionSecondary.textContent = isChinese ? "" : (caption.translation || "翻譯中...");
  captionSecondary.hidden = isChinese;
  captionPrimary.lang = caption.sourceLanguage;
  captionSecondary.lang = resolveTranslateLang() === "zh" ? "zh-Hant" : resolveTranslateLang();
}

function updateSummaryControls() {
  const count = capturedTranscriptSegments.length;
  if (transcriptCount) {
    transcriptCount.textContent = count
      ? `已累積 ${count} 個穩定字幕片段，可生成段落總結。`
      : "尚未累積可總結的字幕片段。";
  }
  if (summarizeButton) summarizeButton.disabled = count === 0;
  if (clearTranscriptButton) clearTranscriptButton.disabled = count === 0;
  if (copySummaryButton) copySummaryButton.disabled = !latestSummary;
  if (downloadSummaryButton) downloadSummaryButton.disabled = !latestSummary;
}

function addCapturedSegment(role, source, translation, mode = "字幕") {
  const normalizedSource = normalizeCaptionText(source);
  const normalizedTranslation = normalizeCaptionText(translation);
  if (!normalizedSource && !normalizedTranslation) return;

  const previous = capturedTranscriptSegments.at(-1);
  if (
    previous &&
    previous.role === role &&
    previous.source === normalizedSource &&
    previous.translation === normalizedTranslation
  ) {
    return;
  }

  capturedTranscriptSegments.push({
    role,
    source: normalizedSource,
    translation: normalizedTranslation,
    mode,
    at: new Date().toISOString()
  });

  if (capturedTranscriptSegments.length > MAX_CAPTURED_SEGMENTS) {
    capturedTranscriptSegments = capturedTranscriptSegments.slice(-MAX_CAPTURED_SEGMENTS);
  }
  updateSummaryControls();
}

function clearCapturedTranscript() {
  capturedTranscriptSegments = [];
  latestSummary = "";
  if (summaryOutput) {
    summaryOutput.textContent = "聽完一個段落後，按「生成總結」即可整理重點、關鍵詞與可行動事項。";
  }
  updateSummaryControls();
}

async function summarizeCapturedTranscript() {
  if (!capturedTranscriptSegments.length || !summaryOutput) return;
  summarizeButton.disabled = true;
  summaryOutput.textContent = "正在整理目前段落...";

  try {
    const response = await fetch("/api/caption/summarize", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        segments: capturedTranscriptSegments.slice(-80)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "段落總結失敗");
    if (result.usage) updateCostFromUsage(result.usage);
    latestSummary = normalizeSummaryMarkdown(result.summary || "");
    summaryOutput.textContent = latestSummary || "目前片段不足以產生總結。";
    logEvent("段落總結完成", `已整理 ${capturedTranscriptSegments.length} 個字幕片段。`);
  } catch (error) {
    latestSummary = "";
    summaryOutput.textContent = `段落總結失敗：${error instanceof Error ? error.message : String(error)}`;
    logEvent("段落總結失敗", error instanceof Error ? error.message : String(error));
  } finally {
    updateSummaryControls();
  }
}

function normalizeSummaryMarkdown(markdown) {
  const normalized = String(markdown || "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!normalized) return "";
  const lines = normalized.split("\n").map((line) => line.trimEnd());
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^##\s+(段落總結|重點|可行動事項)/gm, "### $1")
    .replace(/^###\s+關鍵詞\s*\n(.+)$/gm, "關鍵詞：$1")
    .replace(/^(### .+)\n{2,}/gm, "$1\n")
    .replace(/\n{2,}(關鍵詞：)/g, "\n$1")
    .trim();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summaryMarkdownToHtml(markdown) {
  const html = [];
  let inList = false;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }

    if (line.startsWith("### ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h3 style="margin:0 0 4px 0;line-height:1.35;">${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html.push('<ul style="margin:0 0 10px 1.2em;padding-left:1.2em;">');
        inList = true;
      }
      html.push(`<li style="margin:0 0 2px 0;line-height:1.55;">${escapeHtml(line.slice(2))}</li>`);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    html.push(`<p style="margin:0 0 10px 0;line-height:1.65;">${escapeHtml(line)}</p>`);
  }

  if (inList) html.push("</ul>");
  return html.join("\n");
}

async function copyLatestSummary() {
  if (!latestSummary) return;
  const markdown = normalizeSummaryMarkdown(latestSummary);
  const html = summaryMarkdownToHtml(markdown);

  if (window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([markdown], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" })
      })
    ]);
  } else {
    await navigator.clipboard.writeText(markdown);
  }
  logEvent("總結已複製", "可貼到 Heptabase、日記、會議紀錄或其他文件。");
}

function downloadLatestSummary() {
  if (!latestSummary) return;
  const blob = new Blob([latestSummary], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `livelingo-summary-${stamp}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  logEvent("總結已下載", "已產生 Markdown 檔。");
}

function resetCaptions() {
  for (const caption of Object.values(captions)) {
    caption.source = "";
    caption.translation = "";
    caption.sourceLanguage = "zh-Hant";
  }
  liveTranslationInFlightByRole = {
    user: false,
    assistant: false
  };
  pendingLiveTranslationTextByRole = {
    user: "",
    assistant: ""
  };
  localSpeechFinalText = "";
  localSpeechInterimText = "";
  usingLocalSpeechCaptions = false;
  renderCaption("user", "待命");
  updateSummaryControls();
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function preferredSpeechRecognitionLanguage() {
  const targetLang = getTranslateLang();
  if (targetLang === "en") return "zh-TW";
  return "en-US";
}

function visibleLocalSpeechText() {
  return normalizeCaptionText(`${localSpeechFinalText} ${localSpeechInterimText}`);
}

function wordsOf(text) {
  return normalizeCaptionText(text).split(/\s+/).filter(Boolean);
}

function lastWords(text, maxWords) {
  const words = wordsOf(text);
  if (words.length <= maxWords) return normalizeCaptionText(text);
  return words.slice(-maxWords).join(" ");
}

function latestReadableSegment(text, maxWords = LIVE_SOURCE_MAX_WORDS) {
  const normalized = normalizeCaptionText(text);
  if (!normalized) return "";
  const segments = normalized
    .split(/(?<=[.!?。！？；;])\s+|[\n\r]+/)
    .map((segment) => normalizeCaptionText(segment))
    .filter(Boolean);
  return lastWords(segments.at(-1) || normalized, maxWords);
}

function liveTranslationSegment(text) {
  const segment = latestReadableSegment(text, LIVE_TRANSLATION_MAX_WORDS);
  if (!segment) return "";
  return segment.slice(-LIVE_TRANSLATION_MAX_CHARS);
}

function shouldTranslateLiveSegment(text) {
  const normalized = normalizeCaptionText(text);
  if (normalized.length < LIVE_TRANSLATION_MIN_CHARS) return false;
  if (wordsOf(normalized).length < LIVE_TRANSLATION_MIN_WORDS) return false;
  if (isChineseCaption(detectCaptionLanguage(normalized))) return false;
  return true;
}

function updateLocalSpeechCaption(mode) {
  const text = visibleLocalSpeechText();
  if (!text) return;

  usingLocalSpeechCaptions = true;
  const displayText = latestReadableSegment(text);
  const translationText = liveTranslationSegment(text);
  captions.user.source = displayText;
  captions.user.sourceLanguage = detectCaptionLanguage(text);
  renderCaption("user", mode);
  if (shouldTranslateLiveSegment(translationText)) {
    scheduleLiveTranslation("user", translationText, {
      force: true,
      delayMs: LOCAL_SPEECH_TRANSLATION_DEBOUNCE_MS
    });
  }
}

function startLocalInterimCaptions() {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    logEvent("本機即時聽寫不可用", "此瀏覽器不支援 SpeechRecognition，會改用雲端 Realtime 字幕。");
    return;
  }

  stopLocalInterimCaptions();
  localSpeechRecognition = new SpeechRecognition();
  localSpeechRecognition.continuous = true;
  localSpeechRecognition.interimResults = true;
  localSpeechRecognition.lang = preferredSpeechRecognitionLanguage();
  localSpeechActive = true;
  localSpeechFinalText = "";
  localSpeechInterimText = "";
  usingLocalSpeechCaptions = true;

  localSpeechRecognition.onresult = (event) => {
    let finalDelta = "";
    let interim = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (result.isFinal) {
        finalDelta = normalizeCaptionText(`${finalDelta} ${transcript}`);
      } else {
        interim = normalizeCaptionText(`${interim} ${transcript}`);
      }
    }

    if (finalDelta) {
      localSpeechFinalText = normalizeCaptionText(`${localSpeechFinalText} ${finalDelta}`);
      transcriptTextByRole.user = visibleLocalSpeechText();
    }
    localSpeechInterimText = interim;
    updateLocalSpeechCaption(localSpeechInterimText ? "本機即時聽寫" : "本機聽寫確認");
  };

  localSpeechRecognition.onerror = (event) => {
    logEvent("本機即時聽寫錯誤", event.error || "SpeechRecognition 發生錯誤");
  };

  localSpeechRecognition.onend = () => {
    if (!localSpeechActive || !localStream) return;
    window.setTimeout(() => {
      try {
        localSpeechRecognition?.start();
      } catch {
        // 已在啟動中時瀏覽器會丟例外，可忽略。
      }
    }, 120);
  };

  try {
    localSpeechRecognition.start();
    logEvent("本機即時聽寫已啟動", `語言：${localSpeechRecognition.lang}`);
  } catch (error) {
    logEvent("本機即時聽寫啟動失敗", error instanceof Error ? error.message : String(error));
  }
}

function stopLocalInterimCaptions() {
  localSpeechActive = false;
  if (!localSpeechRecognition) return;
  try {
    localSpeechRecognition.stop();
  } catch {
    // 停止時可能已被瀏覽器關閉，可忽略。
  }
  localSpeechRecognition = undefined;
}

function sendRealtimeEvent(event) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    throw new Error("Realtime 事件通道尚未開啟");
  }
  dataChannel.send(JSON.stringify(event));
}

function trackTranslationRequest(role, text, mode) {
  translationSequence += 1;
  const request = {
    role,
    text,
    mode,
    sequence: translationSequence
  };
  latestTranslationSequenceByRole[role] = request.sequence;
  return request;
}

function isSentenceEnd(char) {
  return /[。！？!?；;，,、\n]/.test(char) || char === ".";
}

function trimSentenceBoundary(text, start, end) {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/.test(text[nextStart])) nextStart += 1;
  while (nextEnd > nextStart && /\s/.test(text[nextEnd - 1])) nextEnd -= 1;
  return {
    text: text.slice(nextStart, nextEnd),
    start: nextStart,
    end: nextEnd
  };
}

function extractSentenceChunks(text, startIndex, forceTail = false) {
  const chunks = [];
  let sentenceStart = startIndex;

  for (let index = startIndex; index < text.length; index += 1) {
    if (!isSentenceEnd(text[index])) continue;
    const chunk = trimSentenceBoundary(text, sentenceStart, index + 1);
    if (chunk.text) chunks.push(chunk);
    sentenceStart = index + 1;
  }

  if (forceTail && sentenceStart < text.length) {
    const chunk = trimSentenceBoundary(text, sentenceStart, text.length);
    if (chunk.text.length >= MIN_FINAL_SENTENCE_CHARS) chunks.push(chunk);
  }

  return chunks;
}

function currentUntranslatedTail(role) {
  return normalizeCaptionText(transcriptTextByRole[role].slice(translatedUntilByRole[role]));
}

async function callWebSearchTool(argumentsJson) {
  let payload = {};
  try {
    payload = argumentsJson ? JSON.parse(argumentsJson) : {};
  } catch {
    payload = { query: String(argumentsJson || "") };
  }

  const response = await fetch("/api/web-search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: String(payload.query || "").trim(),
      reason: String(payload.reason || "").trim()
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "網路搜尋失敗");
  }
  return result;
}

async function handleFunctionCall(event) {
  if (event.name !== "search_web") return;

  logEvent("Ada 正在搜尋網路", event.arguments || "");
  try {
    const result = await callWebSearchTool(event.arguments);
    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(result)
      }
    });
    sendRealtimeEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: [
          "根據 search_web 工具回傳的結果，用自然台灣繁體中文回答使用者。",
          "答案要適合語音朗讀，先講結論，再簡短補充依據。",
          "如果 sources 有內容，口語提到一到兩個來源名稱或網址。"
        ].join("\n")
      }
    });
    logEvent("網路搜尋完成", result.answer || result.query || "");
  } catch (error) {
    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      }
    });
    sendRealtimeEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: "請告訴使用者目前網路搜尋失敗，並詢問是否要換一個查詢再試。"
      }
    });
    logEvent("網路搜尋失敗", error instanceof Error ? error.message : String(error));
  }
}

async function requestCaptionTranslation(text, role, mode = "final") {
  const normalized = normalizeCaptionText(text);
  if (normalized.length < 2 || isChineseCaption(captions[role].sourceLanguage)) return;
  if (mode === "live" && liveTranslationInFlightByRole[role]) {
    pendingLiveTranslationTextByRole[role] = normalized;
    return;
  }

  const request = trackTranslationRequest(role, normalized, mode);
  pendingTranslationByRole[role] = true;
  if (mode === "live") liveTranslationInFlightByRole[role] = true;
  captions[role].source = normalized;
  if (mode !== "live") captions[role].translation = "";
  captions[role].sourceLanguage = detectCaptionLanguage(normalized);
  renderCaption(role, mode === "live" ? "低延遲翻譯中" : "逐句翻譯中");

  try {
    const response = await fetch("/api/caption/translate", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text: normalized,
        target: { zh: "繁體中文", en: "English", ja: "日本語", ko: "한국어", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", ru: "Русский", ar: "العربية", it: "Italiano", hi: "हिन्दी", nl: "Nederlands" }[resolveTranslateLang()] || "繁體中文",
        low_latency: mode === "live"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "字幕翻譯失敗");
    if (request.sequence < latestTranslationSequenceByRole[role]) return;
    
    // 記錄 Token 消耗
    if (result.usage) {
      updateCostFromUsage(result.usage);
    }
    
    captions[role].translation = normalizeCaptionText(result.translation || "");
    addCapturedSegment(role, normalized, captions[role].translation, mode === "live" ? "低延遲翻譯" : "逐句翻譯");
    renderCaption(role, mode === "live" ? "低延遲翻譯" : "逐句翻譯完成");
  } finally {
    if (mode === "live") {
      liveTranslationInFlightByRole[role] = false;
      const pendingText = pendingLiveTranslationTextByRole[role];
      pendingLiveTranslationTextByRole[role] = "";
      if (pendingText && pendingText !== normalized && pendingText !== liveTranslationLastTextByRole[role]) {
        scheduleLiveTranslation(role, pendingText, { force: true, delayMs: 40 });
      }
    }
    if (mode === "sentence" || mode === "live" || request.sequence >= latestTranslationSequenceByRole[role]) {
      pendingTranslationByRole[role] = false;
    }
  }
}

function queueSentenceTranslation(role, sentence) {
  sentenceTranslationQueueByRole[role] = sentenceTranslationQueueByRole[role]
    .then(() => requestCaptionTranslation(sentence, role, "sentence"))
    .catch((error) => {
      captions[role].source = sentence;
      captions[role].translation = "翻譯暫時無法產生";
      renderCaption(role, "逐句翻譯失敗");
      logEvent("逐句翻譯失敗", error instanceof Error ? error.message : String(error));
    });
}

function requestSentenceTranslations(role, forceTail = false) {
  const chunks = extractSentenceChunks(transcriptTextByRole[role], translatedUntilByRole[role], forceTail);
  for (const chunk of chunks) {
    translatedUntilByRole[role] = chunk.end;
    const sentence = normalizeCaptionText(chunk.text);
    if (!sentence) continue;

    captions[role].source = sentence;
    captions[role].translation = "";
    captions[role].sourceLanguage = detectCaptionLanguage(sentence);

    if (isChineseCaption(captions[role].sourceLanguage)) {
      renderCaption(role, "逐句原文");
    } else {
      renderCaption(role, "逐句翻譯中");
      queueSentenceTranslation(role, sentence);
    }
  }
}

function clearLiveTranslationTimer(role) {
  if (!liveTranslationTimersByRole[role]) return;
  clearTimeout(liveTranslationTimersByRole[role]);
  liveTranslationTimersByRole[role] = undefined;
}

function scheduleLiveTranslation(role, text, options = {}) {
  if (translateModeActive && !options.force) return;
  const normalized = normalizeCaptionText(text);
  if (!shouldTranslateLiveSegment(normalized)) return;
  if (normalized === liveTranslationLastTextByRole[role]) return;

  clearLiveTranslationTimer(role);
  liveTranslationTimersByRole[role] = setTimeout(() => {
    liveTranslationLastTextByRole[role] = normalized;
    void requestCaptionTranslation(normalized, role, "live").catch((error) => {
      logEvent("低延遲翻譯失敗", error instanceof Error ? error.message : String(error));
    });
  }, options.delayMs ?? LIVE_TRANSLATION_DEBOUNCE_MS);
}

function applyAssistantDelta(event) {
  if (!activeAssistantResponseId) activeAssistantResponseId = event.response_id;
  if (event.response_id !== activeAssistantResponseId) return;
  activeAssistantText = normalizeCaptionText(`${activeAssistantText}${event.delta || ""}`);
  captions.assistant.source = activeAssistantText;
  captions.assistant.translation = "";
  captions.assistant.sourceLanguage = detectCaptionLanguage(activeAssistantText);
  renderCaption("assistant", "Ada 回覆中");
}

function applyAssistantDone(event) {
  if (activeAssistantResponseId && event.response_id !== activeAssistantResponseId) return;
  const transcript = normalizeCaptionText(event.transcript || event.text || activeAssistantText);
  if (!transcript) return;
  activeAssistantText = transcript;
  captions.assistant.source = transcript;
  captions.assistant.translation = "";
  captions.assistant.sourceLanguage = detectCaptionLanguage(transcript);
  renderCaption("assistant", "Ada 完整回覆");
}

function applyTranscriptDelta(role, delta) {
  transcriptTextByRole[role] = `${transcriptTextByRole[role]}${delta || ""}`;
  const tail = currentUntranslatedTail(role);
  if (tail) {
    const displayText = latestReadableSegment(tail);
    const translationText = liveTranslationSegment(tail);
    captions[role].source = displayText;
    captions[role].sourceLanguage = detectCaptionLanguage(tail);
    renderCaption(role, "即時轉錄中");
    if (shouldTranslateLiveSegment(translationText)) scheduleLiveTranslation(role, translationText);
  }
  requestSentenceTranslations(role, false);
}

function applyTranscriptDone(role, transcript) {
  const text = normalizeCaptionText(transcript);
  if (!text) return;
  clearLiveTranslationTimer(role);
  transcriptTextByRole[role] = text;
  if (isChineseCaption(detectCaptionLanguage(text))) addCapturedSegment(role, text, "", "原文");
  requestSentenceTranslations(role, true);
}

function updateCostFromUsage(usage) {
  if (!usage) return;
  const tokens = usage.total_tokens || 0;
  sessionTokens += tokens;
  lifetimeTokens += tokens;
  
  const inAudio = usage.input_token_details?.audio_tokens || 0;
  const inText = Math.max(0, (usage.input_tokens || 0) - inAudio);
  const outAudio = usage.output_token_details?.audio_tokens || 0;
  const outText = Math.max(0, (usage.output_tokens || 0) - outAudio);
  
  // Audio In: $0.10/1k, Text In: $0.005/1k, Audio Out: $0.20/1k, Text Out: $0.02/1k
  const cost = (inAudio * 0.0001) + (inText * 0.000005) + (outAudio * 0.0002) + (outText * 0.00002);
  sessionCostUsd += cost;
  lifetimeCostUsd += cost;
  
  // 持久化累計數據
  localStorage.setItem("livelingo_lifetime_tokens", lifetimeTokens);
  localStorage.setItem("livelingo_lifetime_cost", lifetimeCostUsd);
  
  if (costBadge) {
    costBadge.textContent = `當次: ${sessionTokens} / 累計: ${lifetimeTokens} Tokens ($${sessionCostUsd.toFixed(3)})`;
  }
}

function handleCaptionEvent(event) {
  if (event.type === "response.done" && event.response?.usage) {
    updateCostFromUsage(event.response.usage);
  }

  if (event.type === "response.function_call_arguments.done") {
    void handleFunctionCall(event);
    return;
  }

  if (event.type === "response.created") {
    activeAssistantResponseId = event.response?.id;
    activeAssistantText = "";
    captions.assistant.source = "";
    captions.assistant.translation = "";
    captions.assistant.sourceLanguage = "zh-Hant";
    setFaceState("thinking");
    // 不立即 renderCaption，保留用戶最後一段話的顯示，直到 Ada 開始有 delta 輸出
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.delta") {
    setFaceState("listening");
    if (translateModeActive) return; // 翻譯模式開啟時，由翻譯通道負責更新 UI
    applyTranscriptDelta("user", event.delta);
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    if (translateModeActive) return;
    applyTranscriptDone("user", event.transcript);
    return;
  }

  if (event.type === "response.output_text.delta") {
    applyAssistantDelta(event);
    return;
  }

  if (event.type === "response.output_text.done") {
    applyAssistantDone(event);
    return;
  }

  if (event.type === "response.audio_transcript.delta" || event.type === "response.output_audio_transcript.delta") {
    setFaceState("speaking");
    applyAssistantDelta(event);
    return;
  }

  if (event.type === "response.audio_transcript.done" || event.type === "response.output_audio_transcript.done") {
    applyAssistantDone(event);
    // 語音播完後短暫延遲回到 idle
    setTimeout(() => setFaceState("idle"), 800);
  }
}

// ──── BYOK 設定管理 ────

function getStoredApiKey() {
  return localStorage.getItem("livelingo_api_key") || "";
}

function saveApiKey(key) {
  if (key) {
    localStorage.setItem("livelingo_api_key", key);
  } else {
    localStorage.removeItem("livelingo_api_key");
  }
}

function getTranslateEnabled() {
  const stored = localStorage.getItem(TRANSLATE_ENABLED_KEY);
  if (stored !== null) return stored === "true";
  const legacy = localStorage.getItem(LEGACY_TRANSLATE_ENABLED_KEY);
  if (legacy !== null) {
    localStorage.setItem(TRANSLATE_ENABLED_KEY, legacy);
    localStorage.removeItem(LEGACY_TRANSLATE_ENABLED_KEY);
    return legacy === "true";
  }
  return true;
}

function getTranslateLang() {
  return localStorage.getItem("livelingo_translate_lang") || "auto";
}

function resolveTranslateLang() {
  const setting = getTranslateLang();
  if (setting !== "auto") return setting;
  // 自動偵測：如果來源是中文就翻成英文，否則翻成中文
  const sourceLanguage = captions.user.sourceLanguage || "zh-Hant";
  return sourceLanguage === "zh-Hant" ? "en" : "zh";
}

function initSettings() {
  apiKeyInput.value = getStoredApiKey();
  enableTranslateModeCheckbox.checked = getTranslateEnabled();
  translateLangSelect.value = getTranslateLang();

  settingsToggle.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  apiKeyInput.addEventListener("change", () => {
    saveApiKey(apiKeyInput.value.trim());
    logEvent("API Key 已更新", apiKeyInput.value ? "使用自備金鑰" : "使用系統金鑰");
  });

  toggleKeyVisibility.addEventListener("click", () => {
    apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  });

  enableTranslateModeCheckbox.addEventListener("change", () => {
    localStorage.setItem(TRANSLATE_ENABLED_KEY, enableTranslateModeCheckbox.checked);
    logEvent("即時口譯模式", enableTranslateModeCheckbox.checked ? "已開啟" : "已關閉");
  });

  translateLangSelect.addEventListener("change", () => {
    localStorage.setItem("livelingo_translate_lang", translateLangSelect.value);
    if (localSpeechActive) startLocalInterimCaptions();
  });

  const saveApiKeyBtn = document.querySelector("#saveApiKeyBtn");
  if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener("click", () => {
      const key = apiKeyInput.value.trim();
      saveApiKey(key);
      logEvent("API Key 已儲存", key ? "已啟用自備金鑰" : "已切換回系統金鑰");
      alert("API Key 已成功儲存！");
      settingsPanel.hidden = true;
    });
  }
}

// ──── Token 建立（支援 BYOK） ────

async function createEphemeralKey() {
  const userKey = getStoredApiKey();
  if (userKey) {
    const response = await fetch("/api/realtime/byok-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: userKey })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "BYOK token 建立失敗");
    const key = payload.value || payload.client_secret?.value || payload.client_secret;
    if (!key) throw new Error("BYOK token 回傳格式不完整");
    return key;
  }

  const response = await fetch("/api/realtime/token", { method: "POST" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Realtime token 建立失敗");
  const key = payload.value || payload.client_secret?.value || payload.client_secret;
  if (!key) throw new Error("Realtime token 回傳格式不完整");
  return key;
}

async function exchangeSdpDirectly(offerSdp) {
  const ephemeralKey = await createEphemeralKey();
  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offerSdp,
    headers: {
      authorization: `Bearer ${ephemeralKey}`,
      "content-type": "application/sdp"
    }
  });

  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

// ──── Realtime-Translate 連線 ────

async function createTranslateEphemeralKey(targetLang) {
  const userKey = getStoredApiKey();
  const body = { target_language: targetLang };
  if (userKey) body.api_key = userKey;

  const response = await fetch("/api/realtime/translate-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Translate token 建立失敗");
  const key = payload.value || payload.client_secret?.value || payload.client_secret;
  if (!key) throw new Error("Translate token 回傳格式不完整");
  return {
    key,
    model: payload.model || DEFAULT_TRANSLATE_MODEL
  };
}

function handleTranslateEvent(event) {
  const isDebug = false;
  if (isDebug && event.type !== "rate_limits.updated") {
    logEvent(`[Translate] ${event.type}`, eventSummary(event));
  }

  // 1. 使用者轉錄（第一行字幕）
  if (event.type === "conversation.item.input_audio_transcription.delta") {
    if (usingLocalSpeechCaptions) return;
    const delta = event.delta || "";
    captions.user.source = normalizeCaptionText(`${captions.user.source}${delta}`);
    captions.user.sourceLanguage = detectCaptionLanguage(captions.user.source);
    renderCaption("user", "Realtime-Translate");
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    if (usingLocalSpeechCaptions) return;
    captions.user.source = normalizeCaptionText(event.transcript || captions.user.source);
    captions.user.sourceLanguage = detectCaptionLanguage(captions.user.source);
    renderCaption("user", "Realtime-Translate");
    return;
  }

  // 2. 翻譯後的文字（第二行字幕）
  if (event.type === "response.audio_transcript.delta" || event.type === "response.text.delta") {
    if (usingLocalSpeechCaptions) return;
    const delta = event.delta || "";
    captions.user.translation = normalizeCaptionText(`${captions.user.translation}${delta}`);
    renderCaption("user", "Realtime-Translate");
    return;
  }

  if (event.type === "response.audio_transcript.done" || event.type === "response.text.done") {
    captions.user.translation = normalizeCaptionText(event.transcript || event.text || captions.user.translation);
    renderCaption("user", "Realtime-Translate");
    return;
  }

  // 3. Token 消耗記錄 (Translate Connection)
  if (event.type === "response.done" && event.response?.usage) {
    updateCostFromUsage(event.response.usage);
  }

  // 當偵測到新句子開始，清空前一句
  if (event.type === "input_audio_buffer.committed" || event.type === "session.input_audio_started") {
    if (usingLocalSpeechCaptions) return;
    captions.user.source = "";
    captions.user.translation = "";
    liveTranslationLastTextByRole.user = "";
    renderCaption("user", "Realtime-Translate");
    return;
  }

  if (event.type === "error") {
    logEvent("翻譯引擎錯誤", event.error?.message || "Realtime-Translate 發生錯誤");
  }
}

async function startTranslateConnection(stream) {
  const targetLang = resolveTranslateLang();
  logEvent("啟動即時口譯", `目標語言：${targetLang}`);

  try {
    const { key: ephemeralKey, model: activeTranslateModel } = await createTranslateEphemeralKey(targetLang);

    translatePeerConnection = new RTCPeerConnection();

    translatePeerConnection.ontrack = (event) => {
      translateAudio.srcObject = event.streams[0];
      logEvent("翻譯音訊已接入", "即時口譯音訊就緒");
    };

    // 共用同一個麥克風串流
    stream.getTracks().forEach((track) => {
      translatePeerConnection.addTrack(track, stream);
    });

    translateDataChannel = translatePeerConnection.createDataChannel("oai-events");
    translateDataChannel.onmessage = (message) => {
      const event = JSON.parse(message.data);
      handleTranslateEvent(event);
    };

    const offer = await translatePeerConnection.createOffer();
    await translatePeerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: {
        authorization: `Bearer ${ephemeralKey}`,
        "content-type": "application/sdp"
      }
    });

    if (!sdpResponse.ok) throw new Error(await sdpResponse.text());

    await translatePeerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    translateModeActive = true;
    logEvent("即時口譯已連線", "Realtime-Translate 就緒");
  } catch (error) {
    logEvent("即時口譯啟動失敗", error instanceof Error ? error.message : String(error));
    translateModeActive = false;
  }
}

function stopTranslateConnection() {
  if (translateDataChannel && translateDataChannel.readyState !== "closed") translateDataChannel.close();
  if (translatePeerConnection && translatePeerConnection.connectionState !== "closed") translatePeerConnection.close();
  translateDataChannel = undefined;
  translatePeerConnection = undefined;
  translateModeActive = false;
  translateAudio.srcObject = null;
}

// ──── 主對話流程 ────

async function startConversation() {
  startButton.disabled = true;
  stopButton.disabled = false;
  sessionTokens = 0;
  sessionCostUsd = 0;
  if (costBadge) costBadge.textContent = `0 / ${lifetimeTokens} Tokens`;
  resetCaptions();
  setStatus("連線中", "connected");
  adaFace.classList.add("live");
  setFaceState("idle");
  logEvent("準備連線", "正在建立 WebRTC 連線。");

  try {
    peerConnection = new RTCPeerConnection();

    peerConnection.onconnectionstatechange = () => {
      logEvent("WebRTC 狀態", peerConnection.connectionState);
      if (peerConnection.connectionState === "connected") setStatus("對話中", "connected");
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        adaFace.classList.remove("live");
        setFaceState("idle");
      }
    };

    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      logEvent("Realtime 音訊軌已接入", "Ada 會以語音回覆，字幕同步顯示。");
    };

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    startLocalInterimCaptions();
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => {
      logEvent("事件通道已開啟", "你可以開始說話。");
    };
    dataChannel.onmessage = (message) => {
      const event = JSON.parse(message.data);
      handleCaptionEvent(event);
      const summary = eventSummary(event);
      if (summary || event.type === "error") logEvent(event.type, summary);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await exchangeSdpDirectly(offer.sdp)
    });

    // 如果啟用了即時口譯模式，同時啟動翻譯連線
    if (getTranslateEnabled()) {
      await startTranslateConnection(localStream);
    }
  } catch (error) {
    setStatus("錯誤", "error");
    logEvent("啟動失敗", error instanceof Error ? error.message : String(error));
    stopConversation();
  }
}

function stopConversation() {
  stopLocalInterimCaptions();
  stopTranslateConnection();

  if (dataChannel && dataChannel.readyState !== "closed") dataChannel.close();
  if (peerConnection && peerConnection.connectionState !== "closed") peerConnection.close();
  if (localStream) localStream.getTracks().forEach((track) => track.stop());

  dataChannel = undefined;
  peerConnection = undefined;
  localStream = undefined;
  activeAssistantResponseId = undefined;
  activeAssistantText = "";
  translationSequence = 0;
  transcriptTextByRole = {
    user: "",
    assistant: ""
  };
  translatedUntilByRole = {
    user: 0,
    assistant: 0
  };
  sentenceTranslationQueueByRole = {
    user: Promise.resolve(),
    assistant: Promise.resolve()
  };
  latestTranslationSequenceByRole = {
    user: 0,
    assistant: 0
  };
  pendingTranslationByRole = {
    user: false,
    assistant: false
  };
  clearLiveTranslationTimer("user");
  clearLiveTranslationTimer("assistant");
  liveTranslationLastTextByRole = {
    user: "",
    assistant: ""
  };
  liveTranslationInFlightByRole = {
    user: false,
    assistant: false
  };
  pendingLiveTranslationTextByRole = {
    user: "",
    assistant: ""
  };
  localSpeechFinalText = "";
  localSpeechInterimText = "";
  usingLocalSpeechCaptions = false;
  remoteAudio.srcObject = null;

  adaFace.classList.remove("live");
  setFaceState("idle");
  setStatus("待命");
  startButton.disabled = false;
  stopButton.disabled = true;
  logEvent("已停止", "WebRTC 連線與麥克風已關閉。");
}

// ──── 初始化 ────

initSettings();
startButton.addEventListener("click", startConversation);
stopButton.addEventListener("click", stopConversation);
clearLogButton.addEventListener("click", () => {
  eventLog.textContent = "";
});
summarizeButton?.addEventListener("click", () => {
  void summarizeCapturedTranscript();
});
copySummaryButton?.addEventListener("click", () => {
  void copyLatestSummary();
});
downloadSummaryButton?.addEventListener("click", downloadLatestSummary);
clearTranscriptButton?.addEventListener("click", clearCapturedTranscript);
updateSummaryControls();
