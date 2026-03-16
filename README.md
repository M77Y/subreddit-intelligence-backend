# Subreddit Intelligence API

Backend API for AI-powered Reddit community analysis using **Groq's FREE Llama 3.3 70B**.

## Features

- Fetch posts and comments from any public subreddit
- AI-powered analysis using **Groq's llama-3.3-70b-versatile** (FREE!)
- Theme clustering and extraction
- Pain point identification
- Community belief extraction
- Emotional tone analysis
- Topic sentiment analysis
- Report generation (Reddit post, Twitter thread, blog article, research report)

## Why Groq?

- **FREE tier** - No credit card required
- **Fast inference** - Extremely low latency
- **Llama 3.3 70B** - State-of-the-art open source model
- **Generous limits** - 20 requests/minute, 1M tokens/day on free tier

## Get Your Free Groq API Key

1. Go to https://console.groq.com/keys
2. Sign up (free, no credit card)
3. Create an API key
4. Done! You're ready to go.

## Deployment

### Option 1: Render (Recommended - FREE)

**Step 1: Deploy the Backend**

1. Go to https://render.com and sign up (free)
2. Click "New +" → "Blueprint"
3. Connect your GitHub repo or upload files
4. Render will auto-detect the `render.yaml` file
5. Click "Apply"
6. **IMPORTANT**: Add your Groq API key:
   - Go to your new web service
   - Click "Environment" tab
   - Add variable: `GROQ_API_KEY` = your key from https://console.groq.com
   - Click "Save Changes"

**Step 2: Get Your Backend URL**

After deployment, you'll get a URL like:
```
https://subreddit-intelligence-api.onrender.com
```

**Step 3: Deploy the Frontend**

1. Create another Web Service on Render
2. Connect the frontend repo/folder
3. Set build command: `cd app && npm install && npm run build`
4. Set start command: `cd app/dist && npx serve -s .`
5. Add environment variable:
   - `VITE_API_URL` = your backend URL from Step 2
6. Deploy!

### Option 2: Railway (FREE Tier)

1. Go to https://railway.app and sign up
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your backend repo
4. Add environment variable:
   - `GROQ_API_KEY` = your key
5. Deploy!

### Option 3: Fly.io (FREE Tier)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Deploy backend
cd backend
fly launch
fly secrets set GROQ_API_KEY=your_key_here
fly deploy
```

## API Endpoints

### POST /api/analyze
Start a new analysis job.

**Request:**
```json
{
  "subreddit": "technology",
  "timeRange": "year",
  "maxPosts": 100,
  "includeComments": true,
  "optionalTopic": "AI"
}
```

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "processing"
}
```

### GET /api/status/:jobId
Check analysis progress.

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "processing",
  "progress": 45,
  "currentStage": "Clustering themes",
  "postsFetched": 100,
  "commentsFetched": 450
}
```

### GET /api/results/:jobId
Get complete analysis results.

### POST /api/report/:jobId
Generate a formatted report.

**Request:**
```json
{
  "type": "reddit"
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Get free at https://console.groq.com/keys |
| `PORT` | No | Server port (default: 3000) |

## Groq Rate Limits (Free Tier)

- **Requests**: 20 per minute
- **Tokens**: 1,000,000 per day
- **Model**: llama-3.3-70b-versatile

This is plenty for analyzing subreddits! Each analysis uses ~5,000-15,000 tokens.

## Testing Your Deployment

1. Visit your deployed frontend
2. Enter a subreddit name (e.g., `technology`, `askreddit`)
3. Click "Analyze Subreddit"
4. Watch the real-time progress!
5. View your AI-generated analysis dashboard

## Troubleshooting

### "Groq API key not configured"
- Make sure you added the `GROQ_API_KEY` environment variable
- Get your free key at https://console.groq.com/keys

### "Groq rate limit hit"
- Free tier allows 20 requests/minute
- Wait a moment and try again
- Or upgrade to paid tier for higher limits

### "Failed to fetch from Reddit"
- The subreddit might be private or banned
- Try a public subreddit like `technology` or `science`

### Frontend can't connect to backend
- Verify `VITE_API_URL` is set correctly
- Make sure backend URL includes `https://`
- Check CORS is enabled on backend

## File Structure

```
backend/
├── server.js      # Main API with Reddit + Groq integration
├── package.json   # Dependencies
├── render.yaml    # Render deployment config
└── .env.example   # Environment variables template
```

## API Response Format

The analysis returns:

```json
{
  "config": { /* analysis settings */ },
  "summary": {
    "subreddit": "r/technology",
    "postsAnalyzed": 100,
    "commentsAnalyzed": 450,
    "timeRange": "Last 12 months",
    "datasetSize": "1.2 MB"
  },
  "themes": [ /* AI-extracted themes */ ],
  "painPoints": [ /* Common complaints */ ],
  "beliefs": [ /* Community opinions */ ],
  "emotions": [ /* Emotional breakdown */ ],
  "topicSentiment": { /* Optional topic analysis */ },
  "quotes": [ /* Representative quotes */ ],
  "engagementPatterns": [ /* Stats */ ]
}
```

## Support

If you run into issues:
1. Check the Render/Railway/Fly logs
2. Verify your Groq API key is valid at https://console.groq.com/keys
3. Try a different subreddit
4. Reduce the number of posts analyzed

---

**Enjoy your FREE AI-powered Subreddit Intelligence!** 🚀
