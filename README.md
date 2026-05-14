# LiveLingo

LiveLingo 是一個本地 WebRTC 即時翻譯 MVP。瀏覽器負責麥克風與 WebRTC，Node 後端使用 OpenAI Realtime GA unified interface，把瀏覽器產生的 SDP 與 session 設定送到 OpenAI。

## 啟動

```bash
cd 01.Docs/realtime_ada_coach_mvp
npm start
```

打開：

```text
http://127.0.0.1:8787
```

## 檢查

```bash
cd 01.Docs/realtime_ada_coach_mvp
npm run doctor
curl http://127.0.0.1:8787/health
```

## 設定

專案根目錄 `.env` 需要有：

```text
OPENAI_API_KEY=...
```

可選設定：

```text
ADA_REALTIME_PORT=8787
ADA_REALTIME_MODEL=gpt-realtime-2
ADA_REALTIME_VOICE=marin
ADA_CAPTION_MODEL=gpt-4o-mini
```

## Vercel 部署設定

正式部署到 Vercel 時，不會讀取本機 `.env`。請到 Vercel 專案設定新增環境變數：

```text
OPENAI_API_KEY=你的 OpenAI API Key
ADA_REALTIME_MODEL=gpt-realtime-2
ADA_REALTIME_VOICE=marin
ADA_CAPTION_MODEL=gpt-4o-mini
```

至少一定要設定 `OPENAI_API_KEY`，並套用到 Production。設定完成後重新部署，否則 `/api/realtime/call` 與 `/api/caption/translate` 會回傳「缺少 OPENAI_API_KEY」。

## 安全邊界

- 瀏覽器不會拿到長效 `OPENAI_API_KEY`。
- 瀏覽器只把 SDP 送到本地 `/api/realtime/call`，由後端呼叫 `/v1/realtime/calls`。
- MVP 預設只綁定 `127.0.0.1`，不對區網開放。

## MVP 範圍

- 即時語音對話
- 伺服器端 VAD
- 使用者語音轉錄事件
- Ada 繁體中文短句教練提示詞
- 自動雙語字幕：第一行顯示偵測到的原語言，第二行固定顯示繁體中文。第一語言偵測支援中文、英文、日文、西班牙文、韓文、法文、德文、葡萄牙文、俄文、阿拉伯文。翻譯以近即時 debounce 產生，完整句子完成後校正。

下一步可加入登入、逐日教練紀錄、成本計量、對話摘要寫入 `01.Notes/`。
