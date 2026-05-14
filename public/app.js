const REALTIME_MODEL = "gpt-realtime-2";

const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const clearLogButton = document.querySelector("#clearLogButton");
const statusBadge = document.querySelector("#statusBadge");
const remoteAudio = document.querySelector("#remoteAudio");
const eventLog = document.querySelector("#eventLog");
const pulse = document.querySelector("#pulse");
const captionSpeaker = document.querySelector("#captionSpeaker");
const captionMode = document.querySelector("#captionMode");
const captionPrimary = document.querySelector("#captionPrimary");
const captionSecondary = document.querySelector("#captionSecondary");

let peerConnection;
let dataChannel;
let localStream;
let captionTranslateTimer;
let captionRequestId = 0;

const translationCache = new Map();
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
  if (event.type === "response.audio_transcript.done") return event.transcript || "";
  if (event.type === "response.output_audio_transcript.done") return event.transcript || "";
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
  return `第一語言：${label} / 第二行：繁體中文・${mode}`;
}

function renderCaption(role, mode = "即時") {
  const caption = captions[role];
  captionSpeaker.textContent = caption.label;
  captionMode.textContent = captionModeLabel(caption.sourceLanguage, mode);
  captionPrimary.textContent = caption.source || "正在聆聽...";
  captionSecondary.textContent = caption.translation || "繁體中文翻譯中...";
  captionPrimary.lang = caption.sourceLanguage;
  captionSecondary.lang = "zh-Hant";
}

async function translateCaption(text, role, mode = "近即時翻譯") {
  const normalized = normalizeCaptionText(text);
  if (normalized.length < 4) return;
  const sourceLanguage = captions[role].sourceLanguage;
  const target = "Traditional Chinese";
  const cacheKey = `${sourceLanguage}:${target}:${normalized}`;

  if (translationCache.has(cacheKey)) {
    captions[role].translation = translationCache.get(cacheKey);
    renderCaption(role, mode);
    return;
  }

  const requestId = ++captionRequestId;
  try {
    const response = await fetch("/api/caption/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: normalized,
        target
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "字幕翻譯失敗");
    if (requestId < captionRequestId && mode !== "完整字幕") return;

    captions[role].translation = payload.translation || "";
    translationCache.set(cacheKey, captions[role].translation);
    renderCaption(role, mode);
  } catch (error) {
    captions[role].translation = "Translation unavailable.";
    renderCaption(role, "翻譯失敗");
    logEvent("字幕翻譯失敗", error instanceof Error ? error.message : String(error));
  }
}

function scheduleCaptionTranslation(text, role) {
  clearTimeout(captionTranslateTimer);
  captionTranslateTimer = window.setTimeout(() => {
    translateCaption(text, role, "近即時翻譯");
  }, 900);
}

function applyTranscriptDelta(role, delta) {
  captions[role].source = normalizeCaptionText(`${captions[role].source}${delta || ""}`);
  captions[role].sourceLanguage = detectCaptionLanguage(captions[role].source);
  renderCaption(role, "即時轉錄中");
  scheduleCaptionTranslation(captions[role].source, role);
}

function applyTranscriptDone(role, transcript) {
  const text = normalizeCaptionText(transcript);
  if (!text) return;
  captions[role].source = text;
  captions[role].translation = "";
  captions[role].sourceLanguage = detectCaptionLanguage(text);
  renderCaption(role, "完整字幕");
  translateCaption(text, role, "完整字幕");
}

function handleCaptionEvent(event) {
  if (event.type === "conversation.item.input_audio_transcription.delta") {
    applyTranscriptDelta("user", event.delta);
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    applyTranscriptDone("user", event.transcript);
    return;
  }

  if (event.type === "response.audio_transcript.delta" || event.type === "response.output_audio_transcript.delta") {
    applyTranscriptDelta("assistant", event.delta);
    return;
  }

  if (event.type === "response.audio_transcript.done" || event.type === "response.output_audio_transcript.done") {
    applyTranscriptDone("assistant", event.transcript);
  }
}

async function startConversation() {
  startButton.disabled = true;
  stopButton.disabled = false;
  setStatus("連線中", "connected");
  pulse.classList.add("live");
  logEvent("準備連線", "正在建立 WebRTC 連線。");

  try {
    peerConnection = new RTCPeerConnection();

    peerConnection.onconnectionstatechange = () => {
      logEvent("WebRTC 狀態", peerConnection.connectionState);
      if (peerConnection.connectionState === "connected") setStatus("對話中", "connected");
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        pulse.classList.remove("live");
      }
    };

    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      logEvent("Ada 音訊已接入", "瀏覽器正在播放模型回覆。");
    };

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => {
      logEvent("事件通道已開啟", "你可以開始說話。");
      dataChannel.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: "請用繁體中文一句話歡迎使用者，並請他說出現在最需要被教練協助的一件事。"
        }
      }));
    };
    dataChannel.onmessage = (message) => {
      const event = JSON.parse(message.data);
      handleCaptionEvent(event);
      const summary = eventSummary(event);
      if (summary || event.type === "error") logEvent(event.type, summary);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch("/api/realtime/call", {
      method: "POST",
      body: offer.sdp,
      headers: {
        "content-type": "application/sdp"
      }
    });

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });
  } catch (error) {
    setStatus("錯誤", "error");
    logEvent("啟動失敗", error instanceof Error ? error.message : String(error));
    stopConversation();
  }
}

function stopConversation() {
  if (dataChannel && dataChannel.readyState !== "closed") dataChannel.close();
  if (peerConnection && peerConnection.connectionState !== "closed") peerConnection.close();
  if (localStream) localStream.getTracks().forEach((track) => track.stop());

  dataChannel = undefined;
  peerConnection = undefined;
  localStream = undefined;
  remoteAudio.srcObject = null;
  clearTimeout(captionTranslateTimer);

  pulse.classList.remove("live");
  setStatus("待命");
  startButton.disabled = false;
  stopButton.disabled = true;
  logEvent("已停止", "WebRTC 連線與麥克風已關閉。");
}

startButton.addEventListener("click", startConversation);
stopButton.addEventListener("click", stopConversation);
clearLogButton.addEventListener("click", () => {
  eventLog.textContent = "";
});
