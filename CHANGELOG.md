# LiveLingo ChangeLog

更新日期：2026-05-18

LiveLingo 目前是一個即時雙語語音助理網站，目標是把「聽、看、翻譯、摘要、複製」整合成接近 Thinking Machines interaction model 概念的互動層。它不是原生 200ms interaction model，但已經用現有瀏覽器、WebRTC、OpenAI Realtime API 與背景摘要模型做出可用的近似架構。

## 目前能做到的功能

### 1. 即時雙語字幕

使用者開啟麥克風後，LiveLingo 會顯示原語言字幕，並在第二行輸出目標語言翻譯。預設目標語言可設定為繁體中文，也支援自動偵測中外語方向。

目前字幕策略不是等待完整長句，而是使用滑動片段：前台只顯示最近可讀的小段文字，避免整段英文或錯亂 interim transcription 堆滿畫面。

### 2. 低延遲滑動片段翻譯

系統會把最新語音轉錄切成較短片段，約最近 9 個詞，優先翻譯當下最需要看的內容。這讓字幕速度比「等整句話結束再翻譯」更快。

如果新的語音片段進來，舊的翻譯請求不會一直搶畫面；系統會保留上一個穩定譯文，並把最新片段排成下一筆翻譯，減少跳動與空白。

### 3. 本機即時聽寫

前端會優先使用瀏覽器的 `SpeechRecognition` / `webkitSpeechRecognition` 做本機即時聽寫。這條路徑負責快速產生第一行原文字幕，讓畫面不必等雲端 VAD 判斷使用者說完。

如果瀏覽器不支援本機即時聽寫，系統會退回雲端 Realtime transcription。

### 4. OpenAI Realtime 對話

LiveLingo 內建 Ada 語音助理。使用者可以直接用語音與 Ada 對話；Ada 會用繁體中文回應，也會在需要最新資訊時透過網路搜尋工具查證。

系統使用 WebRTC 與 OpenAI Realtime API 建立低延遲語音連線，並透過 data channel 接收事件、轉錄、回覆與 token usage。

### 5. Realtime-Translate 模式

網站支援獨立的 Realtime-Translate 連線，目標是處理更接近即時口譯的場景。這條路徑會與主對話共用麥克風串流，並使用 `gpt-realtime` 類型的 GA 即時翻譯模型。

目前 Realtime-Translate 仍保留為選項；主要字幕體驗則使用「本機即時聽寫 + 低延遲文字翻譯 + 背景校正」的混合模式。

### 6. 段落總結

LiveLingo 會記錄已穩定的字幕片段，包括原文、繁體中文翻譯、模式與時間。使用者聽完一段後，可以按「生成總結」，系統會整理：

### 段落總結
一段 2 到 4 句的段落摘要。

### 重點
- 3 到 5 個重點。
- 使用條列格式，方便快速閱讀。

關鍵詞：以頓號列出 3 到 8 個關鍵詞。

### 可行動事項
- 1 到 3 個下一步行動。

### 7. 一鍵複製完整格式

總結產出後，可以按「複製」。系統會同時寫入：

- `text/html`：貼到 Heptabase、Notion、Google Docs 等支援富文字的工具時，會直接保留 H3 標題與 bullet 格式。
- `text/plain`：貼到 Markdown 或純文字工具時，會保留乾淨 Markdown。

為避免貼上後每段多出空白行，前端會對摘要做二次格式清理，並在 HTML 剪貼簿中加入低 margin 的 inline style。

### 8. 下載 Markdown

總結內容可以下載成 `.md` 檔，檔名會自動帶上時間戳，方便歸檔到本地筆記、日記或會議紀錄。

### 9. BYOK 自備 OpenAI API Key

使用者可以在設定面板中輸入自己的 OpenAI API Key。金鑰只存在瀏覽器本地，不會送到第三方儲存。留空時則使用系統端金鑰。

### 10. 成本與 token 顯示

LiveLingo 會顯示當次與累計 token 使用量，並根據 Realtime usage / Chat completion usage 更新成本估算。

## 背後使用的技術

### 前端

- HTML / CSS / JavaScript 原生實作。
- WebRTC：建立低延遲語音連線。
- RTCDataChannel：接收 Realtime API 事件。
- MediaDevices `getUserMedia`：取得麥克風音訊。
- Web Speech API：使用 `SpeechRecognition` / `webkitSpeechRecognition` 取得本機 interim transcription。
- Clipboard API：使用 `ClipboardItem` 同時寫入 `text/html` 與 `text/plain`。
- Blob / Object URL：下載 Markdown 總結檔。
- localStorage：保存 BYOK API Key、語言設定、累計 token / cost。

### 後端

- Node.js HTTP server。
- Vercel 部署。
- OpenAI Realtime API：建立 client secret 與 WebRTC session。
- OpenAI Chat Completions：處理低延遲文字翻譯、段落總結與 web search 答案整理。
- server-side `.env` / `.env.local` 載入：管理 OpenAI API Key 與模型設定。
- 安全識別：使用 `openai-safety-identifier` 依 request 產生 hash。

### 模型與任務分工

- `gpt-realtime-2`：主語音對話與 Ada 語音助理。
- `gpt-realtime`：Realtime-Translate 即時口譯模式。
- `gpt-4o-mini`：低延遲字幕翻譯、段落總結。
- 搜尋模型設定預設為 `gpt-5.5`，用於需要最新資訊的查證回答。

### Interaction Layer 設計

LiveLingo 目前模擬 Thinking Machines 提到的 interaction model，但不是原生模型。實作方式是：

1. 前台使用短週期檢查與滑動片段顯示，降低字幕延遲。
2. 翻譯器只處理最新可讀片段，不等待完整長句。
3. 背景模型負責段落總結、關鍵詞與行動項目。
4. 穩定片段會被保存成段落記憶，供後續摘要與複製使用。

## 尚未做到，但已規劃的方向

### 1. 正式 micro-turn scheduler

目前已有滑動片段與短 debounce，但尚未建立真正的 200ms micro-turn scheduler。下一步可以加入固定 loop：

- 每 200ms 讀取最新 input。
- 判斷可讀片段。
- 更新第一行字幕。
- 派發短翻譯。
- 淘汰過期翻譯。
- 保存穩定片段到段落記憶。

### 2. 系統音訊直連

目前如果用喇叭播放 YouTube，再由麥克風收音，ASR 會受到環境聲與回音影響。更好的方式是支援系統音訊輸入或 YouTube 字幕 / 音軌直連。

### 3. 自動段落邊界

目前段落總結由使用者按鈕觸發。未來可以根據沉默時間、主題轉換或標點穩定度，自動切段並提示使用者生成摘要。

### 4. 儲存到 Heptabase / 本地筆記

目前支援複製與下載。下一步可以加入「存到 Heptabase」或「存到本地 `01.Notes`」的安全接口，但需要額外授權與路徑設定。

### 5. 多模態輸入

Thinking Machines 的互動模型同時處理聲音、影像、文字。LiveLingo 目前主要處理語音與文字；未來可加入螢幕畫面、攝影機或簡報畫面理解。

## 目前產品定位

LiveLingo 現階段不是完整複製 Thinking Machines 原生 interaction model，而是用可取得的 Web 技術與 OpenAI API 做出「類 interaction layer」：

- 即時字幕是前台。
- 翻譯是滑動片段。
- 摘要是背景模型。
- 複製與下載是輸出層。

這個方向適合用在：

- 即時雙語會議。
- YouTube / Podcast 學習。
- 外語演講聽懂與整理。
- AI 教學現場輔助。
- 會議紀錄與課後筆記。
