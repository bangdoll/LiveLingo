# LiveLingo

LiveLingo 是一個 WebRTC 即時翻譯 MVP。Node 後端只負責簽發 OpenAI Realtime 短效 token，瀏覽器拿到 token 後直連 OpenAI Realtime API，避免讓後端停在音訊連線的關鍵路徑。

## 啟動

```bash
cd 01.Docs/realtime_ada_coach_mvp
npm start
```

開啟：

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
ADA_REALTIME_SECRET_TTL_SECONDS=120
```

## Vercel 部署設定

正式部署到 Vercel 時，不會讀取本機 `.env`。請到 Vercel 專案設定新增環境變數：

```text
OPENAI_API_KEY=你的 OpenAI API Key
ADA_REALTIME_MODEL=gpt-realtime-2
ADA_REALTIME_VOICE=marin
ADA_CAPTION_MODEL=gpt-4o-mini
ADA_REALTIME_SECRET_TTL_SECONDS=120
```

至少一定要設定 `OPENAI_API_KEY`，並套用到 Production。設定完成後重新部署，否則 `/api/realtime/token`、`/api/realtime/call` 與 `/api/caption/translate` 會回傳「缺少 OPENAI_API_KEY」。

## 安全邊界

- 瀏覽器不會拿到長效 `OPENAI_API_KEY`。
- 瀏覽器只會向 `/api/realtime/token` 取得短效 client secret，再用短效 token 直連 `/v1/realtime/calls`。
- `/api/realtime/call` 保留為後端轉送備援路徑。

## MVP 範圍

- 即時語音對話
- 伺服器端 VAD
- 使用者語音轉錄事件
- Realtime 文字輸出翻譯，不額外呼叫 Responses API
- 自動字幕：第一行顯示偵測到的原語言。若原語言是中文，只顯示一行且不翻譯；若原語言不是中文，第二行固定顯示 Realtime 產生的繁體中文。第一語言偵測支援中文、英文、日文、西班牙文、韓文、法文、德文、葡萄牙文、俄文、阿拉伯文。

下一步可加入登入、逐日教練紀錄、成本計量、對話摘要寫入 `01.Notes/`。
