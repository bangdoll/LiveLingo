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
let activeTranslationResponseId;
let activeTranslationText = "";

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
  captionSpeaker.textContent = caption.label;
  captionMode.textContent = captionModeLabel(caption.sourceLanguage, mode);
  captionPrimary.textContent = caption.source || "正在聆聽...";
  captionSecondary.textContent = isChinese ? "" : caption.translation || "繁體中文翻譯中...";
  captionSecondary.hidden = isChinese;
  captionSecondary.setAttribute("aria-hidden", String(isChinese));
  captionPrimary.lang = caption.sourceLanguage;
  captionSecondary.lang = "zh-Hant";
}

function resetCaptions() {
  for (const caption of Object.values(captions)) {
    caption.source = "";
    caption.translation = "";
    caption.sourceLanguage = "zh-Hant";
  }
  renderCaption("user", "待命");
}

function sendRealtimeEvent(event) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    throw new Error("Realtime 事件通道尚未開啟");
  }
  dataChannel.send(JSON.stringify(event));
}

function requestRealtimeTranslation(text, role) {
  const normalized = normalizeCaptionText(text);
  if (normalized.length < 2 || isChineseCaption(captions[role].sourceLanguage)) return;

  activeTranslationResponseId = undefined;
  activeTranslationText = "";
  captions[role].translation = "";
  renderCaption(role, "Realtime 翻譯中");

  sendRealtimeEvent({
    type: "response.create",
    response: {
      conversation: "none",
      output_modalities: ["text"],
      metadata: {
        response_purpose: "caption_translation"
      },
      instructions: [
        "你是 LiveLingo 即時字幕翻譯器。",
        "把使用者提供的字幕翻成台灣繁體中文。",
        "只輸出翻譯，不要回答問題，不要補充說明，不要加引號。"
      ].join("\n"),
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `請翻譯成台灣繁體中文：\n${normalized}`
            }
          ]
        }
      ]
    }
  });
}

function applyTranslationDelta(event) {
  if (!activeTranslationResponseId) activeTranslationResponseId = event.response_id;
  if (event.response_id !== activeTranslationResponseId) return;
  activeTranslationText = normalizeCaptionText(`${activeTranslationText}${event.delta || ""}`);
  captions.user.translation = activeTranslationText;
  renderCaption("user", "Realtime 翻譯中");
}

function applyTranslationDone(event) {
  if (activeTranslationResponseId && event.response_id !== activeTranslationResponseId) return;
  activeTranslationText = normalizeCaptionText(event.text || activeTranslationText);
  captions.user.translation = activeTranslationText;
  renderCaption("user", "Realtime 翻譯完成");
}

function applyTranscriptDelta(role, delta) {
  captions[role].source = normalizeCaptionText(`${captions[role].source}${delta || ""}`);
  captions[role].sourceLanguage = detectCaptionLanguage(captions[role].source);
  if (isChineseCaption(captions[role].sourceLanguage)) captions[role].translation = "";
  renderCaption(role, "即時轉錄中");
}

function applyTranscriptDone(role, transcript) {
  const text = normalizeCaptionText(transcript);
  if (!text) return;
  captions[role].source = text;
  captions[role].translation = "";
  captions[role].sourceLanguage = detectCaptionLanguage(text);
  renderCaption(role, "完整字幕");
  if (!isChineseCaption(captions[role].sourceLanguage)) {
    try {
      requestRealtimeTranslation(text, role);
    } catch (error) {
      captions[role].translation = "翻譯暫時無法產生";
      renderCaption(role, "翻譯失敗");
      logEvent("Realtime 翻譯失敗", error instanceof Error ? error.message : String(error));
    }
  }
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

  if (event.type === "response.output_text.delta") {
    applyTranslationDelta(event);
    return;
  }

  if (event.type === "response.output_text.done") {
    applyTranslationDone(event);
  }
}

async function createEphemeralKey() {
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

async function startConversation() {
  startButton.disabled = true;
  stopButton.disabled = false;
  resetCaptions();
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
      logEvent("Realtime 音訊軌已接入", "目前只輸出文字翻譯。");
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
  activeTranslationResponseId = undefined;
  activeTranslationText = "";
  remoteAudio.srcObject = null;

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
