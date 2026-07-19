# Pointerx Northflank Backend

Use this when deploying the Pointerx reviewer server to Northflank.

## Service

- Service type: Web Service
- Build type: Dockerfile
- Dockerfile path: `Dockerfile.northflank`
- Public HTTP port: `3333`
- Health check path: `/health`

## Environment Variables

Set these in Northflank, not in the mobile app:

```env
POINTERX_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_MODEL=mistralai/mistral-7b-instruct:free
OPENROUTER_APP_TITLE=Pointerx
```

Optional tuning:

```env
REVIEWER_MAX_FILE_BYTES=26214400
REVIEWER_MAX_CHUNKS=3
REVIEWER_CHUNK_SIZE=8000
FLASHCARD_MAX_CARDS=24
MOCK_TEST_MAX_QUESTIONS=15
```

For Gemini instead:

```env
POINTERX_AI_PROVIDER=gemini
GEMINI_API_KEY=your-google-ai-key
GEMINI_MODEL=gemini-3.5-flash
```

## Mobile App

After Northflank deploys, copy the public service URL and set this in the Expo app `.env`:

```env
EXPO_PUBLIC_REVIEWER_API_URL=https://your-pointerx-service.code.run
```

Restart Expo after changing `.env`:

```bash
npx expo start --clear
```

## Notes

- Do not use local Ollama on Northflank unless you also deploy Ollama somewhere reachable.
- Uploaded PDFs are processed in memory. The server does not permanently store uploaded files.
- Job state is stored in memory, so redeploys or restarts clear in-progress jobs.
