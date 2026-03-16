const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (will use file-based in production)
const jobs = new Map();
const results = new Map();

// Reddit API configuration
const REDDIT_BASE_URL = 'https://www.reddit.com';

// Groq API configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Analysis stages
const STAGES = [
  'Fetching posts',
  'Reading comments',
  'Clustering themes',
  'Extracting opinions',
  'Scoring sentiment',
  'Finalizing report'
];

// Helper: Fetch posts from Reddit
async function fetchRedditPosts(subreddit, timeRange, maxPosts) {
  const timeParam = timeRange === 'month' ? 'month' : 
                    timeRange === 'year' ? 'year' : 'all';
  
  const limit = Math.min(maxPosts, 100); // Reddit's max per request
  const url = `${REDDIT_BASE_URL}/r/${subreddit}/top.json?t=${timeParam}&limit=${limit}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'SubredditIntelligence/1.0'
      }
    });
    
    return response.data.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext || '',
      score: child.data.score,
      num_comments: child.data.num_comments,
      created_utc: child.data.created_utc,
      permalink: child.data.permalink,
      author: child.data.author
    }));
  } catch (error) {
    console.error('Reddit API error:', error.message);
    throw new Error('Failed to fetch from Reddit. Subreddit may be private or non-existent.');
  }
}

// Helper: Fetch comments for a post
async function fetchComments(subreddit, postId) {
  const url = `${REDDIT_BASE_URL}/r/${subreddit}/comments/${postId}.json`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'SubredditIntelligence/1.0'
      }
    });
    
    const comments = [];
    const commentList = response.data[1]?.data?.children || [];
    
    function extractComments(nodes) {
      for (const node of nodes) {
        if (node.data && node.data.body) {
          comments.push({
            id: node.data.id,
            body: node.data.body,
            score: node.data.score,
            author: node.data.author,
            created_utc: node.data.created_utc
          });
        }
        if (node.data?.replies?.data?.children) {
          extractComments(node.data.replies.data.children);
        }
      }
    }
    
    extractComments(commentList);
    return comments.slice(0, 50); // Limit comments per post
  } catch (error) {
    console.error('Comments fetch error:', error.message);
    return [];
  }
}

// Helper: Call Groq API (OpenAI-compatible)
async function callGroq(messages, temperature = 0.7) {
  if (!GROQ_API_KEY) {
    throw new Error('Groq API key not configured. Get one free at https://console.groq.com');
  }
  
  try {
    const response = await axios.post(
      `${GROQ_API_URL}/chat/completions`,
      {
        model: GROQ_MODEL,
        messages,
        temperature,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Groq API error:', error.response?.data || error.message);
    if (error.response?.status === 429) {
      throw new Error('Groq rate limit hit. Please wait a moment and try again.');
    }
    if (error.response?.status === 401) {
      throw new Error('Invalid Groq API key. Check your key at https://console.groq.com');
    }
    throw new Error('AI analysis failed: ' + (error.response?.data?.error?.message || error.message));
  }
}

// Helper: Analyze themes with AI
async function analyzeThemes(posts, comments) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  
  const prompt = `Analyze the following Reddit posts and identify the top 3-5 recurring themes.
  
For each theme, provide:
- Theme name (short, descriptive)
- Percentage estimate (how much of the content relates to this)
- Description (2-3 sentences)
- Key phrases (3-5 common phrases related to this theme)
- 2 representative quotes from the content

Format as JSON:
{
  "themes": [
    {
      "name": "Theme Name",
      "percentage": 25,
      "description": "Description here",
      "keyPhrases": ["phrase1", "phrase2"],
      "quotes": ["quote1", "quote2"]
    }
  ]
}

POSTS:
${combinedText.substring(0, 8000)}`;

  const response = await callGroq([
    { role: 'system', content: 'You are an expert at analyzing online communities and identifying patterns in discussions. Always respond with valid JSON.' },
    { role: 'user', content: prompt }
  ]);
  
  try {
    // Extract JSON from response (in case there's extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return parsed.themes || [];
  } catch (e) {
    console.error('Failed to parse themes:', e);
    console.log('Raw response:', response);
    return [];
  }
}

// Helper: Extract pain points
async function extractPainPoints(posts, comments) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  
  const prompt = `Analyze these Reddit posts and identify the top 5 recurring complaints or pain points people express.

For each pain point, provide:
- Description of the problem
- Frequency estimate (percentage of posts mentioning this)
- Emotional intensity (Low, Medium, or High)
- One representative quote

Format as JSON:
{
  "painPoints": [
    {
      "description": "Description here",
      "frequency": 45,
      "intensity": "High",
      "quote": "Quote here"
    }
  ]
}

POSTS:
${combinedText.substring(0, 8000)}`;

  const response = await callGroq([
    { role: 'system', content: 'You are an expert at identifying user pain points and complaints from community discussions. Always respond with valid JSON.' },
    { role: 'user', content: prompt }
  ]);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return parsed.painPoints || [];
  } catch (e) {
    console.error('Failed to parse pain points:', e);
    return [];
  }
}

// Helper: Extract community beliefs
async function extractBeliefs(posts, comments) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  
  const prompt = `Analyze these Reddit posts and extract 4-5 common beliefs or opinions that appear repeatedly in the community.

For each belief, provide:
- The belief statement (as a quote-style sentence)
- 2 example quotes from posts that support this belief
- Related themes (2-3 theme names)

Format as JSON:
{
  "beliefs": [
    {
      "statement": "Belief statement here",
      "quotes": ["quote1", "quote2"],
      "relatedThemes": ["Theme1", "Theme2"]
    }
  ]
}

POSTS:
${combinedText.substring(0, 8000)}`;

  const response = await callGroq([
    { role: 'system', content: 'You are an expert at identifying shared beliefs and worldviews in online communities. Always respond with valid JSON.' },
    { role: 'user', content: prompt }
  ]);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return parsed.beliefs || [];
  } catch (e) {
    console.error('Failed to parse beliefs:', e);
    return [];
  }
}

// Helper: Analyze emotions
async function analyzeEmotions(posts, comments) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  
  const prompt = `Analyze the emotional tone of these Reddit posts. Categorize them into these emotions: Anger, Frustration, Sadness, Support, Healing.

Provide:
- Percentage for each emotion (must total 100%)
- One representative quote for each emotion

Format as JSON:
{
  "emotions": [
    {
      "emotion": "Anger",
      "percentage": 35,
      "quote": "Quote here"
    }
  ]
}

POSTS:
${combinedText.substring(0, 8000)}`;

  const response = await callGroq([
    { role: 'system', content: 'You are an expert at emotional sentiment analysis. Always respond with valid JSON.' },
    { role: 'user', content: prompt }
  ]);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return parsed.emotions || [];
  } catch (e) {
    console.error('Failed to parse emotions:', e);
    return [];
  }
}

// Helper: Analyze topic sentiment
async function analyzeTopicSentiment(posts, comments, topic) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  
  const prompt = `Analyze how the community feels about "${topic}" based on these posts.

Provide:
- Number of mentions
- Sentiment breakdown (positive %, negative %, mixed %)
- 3 arguments in favor
- 3 arguments against
- 3 representative quotes

Format as JSON:
{
  "mentions": 47,
  "sentiment": {
    "positive": 30,
    "negative": 50,
    "mixed": 20
  },
  "argumentsFor": ["arg1", "arg2", "arg3"],
  "argumentsAgainst": ["arg1", "arg2", "arg3"],
  "quotes": ["quote1", "quote2", "quote3"]
}

POSTS:
${combinedText.substring(0, 8000)}`;

  const response = await callGroq([
    { role: 'system', content: 'You are an expert at topic-specific sentiment analysis. Always respond with valid JSON.' },
    { role: 'user', content: prompt }
  ]);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response;
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (e) {
    console.error('Failed to parse topic sentiment:', e);
    return null;
  }
}

// Helper: Extract representative quotes
async function extractQuotes(posts, comments) {
  const allContent = [
    ...posts.map(p => ({ type: 'post', text: p.title + ' ' + p.selftext, ...p })),
    ...comments.map(c => ({ type: 'comment', text: c.body, ...c }))
  ];
  
  // Simple selection: pick diverse, high-quality quotes
  const selected = allContent
    .filter(item => item.text.length > 50 && item.text.length < 500)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6);
  
  return selected.map((item, i) => ({
    id: `quote-${i}`,
    text: item.text.substring(0, 300),
    date: new Date(item.created_utc * 1000).toISOString().split('T')[0],
    score: item.score || 0,
    theme: 'General',
    emotion: 'Mixed',
    sentiment: 'mixed',
    url: `https://reddit.com${item.permalink || ''}`
  }));
}

// Main analysis function
async function runAnalysis(jobId, config) {
  const job = jobs.get(jobId);
  if (!job) return;
  
  try {
    // Stage 1: Fetch posts
    job.currentStage = 0;
    job.progress = 10;
    const posts = await fetchRedditPosts(config.subreddit, config.timeRange, config.maxPosts);
    job.postsFetched = posts.length;
    
    // Stage 2: Fetch comments (if enabled)
    job.currentStage = 1;
    job.progress = 25;
    let comments = [];
    if (config.includeComments) {
      for (const post of posts.slice(0, 10)) { // Limit to top 10 posts for comments
        const postComments = await fetchComments(config.subreddit, post.id);
        comments.push(...postComments);
      }
    }
    job.commentsFetched = comments.length;
    
    // Stage 3: Analyze themes
    job.currentStage = 2;
    job.progress = 40;
    const themes = await analyzeThemes(posts, comments);
    
    // Stage 4: Extract pain points
    job.currentStage = 3;
    job.progress = 55;
    const painPoints = await extractPainPoints(posts, comments);
    
    // Stage 5: Extract beliefs
    job.progress = 65;
    const beliefs = await extractBeliefs(posts, comments);
    
    // Stage 6: Analyze emotions
    job.currentStage = 4;
    job.progress = 75;
    const emotions = await analyzeEmotions(posts, comments);
    
    // Stage 7: Topic sentiment (if specified)
    let topicSentiment = null;
    if (config.optionalTopic) {
      job.progress = 85;
      topicSentiment = await analyzeTopicSentiment(posts, comments, config.optionalTopic);
    }
    
    // Stage 8: Extract quotes
    job.currentStage = 5;
    job.progress = 95;
    const quotes = await extractQuotes(posts, comments);
    
    // Finalize
    job.progress = 100;
    job.status = 'completed';
    
    // Store results
    const result = {
      config,
      summary: {
        subreddit: `r/${config.subreddit}`,
        postsAnalyzed: posts.length,
        commentsAnalyzed: comments.length,
        timeRange: config.timeRange === 'month' ? 'Last 30 days' : 
                   config.timeRange === 'year' ? 'Last 12 months' : 'All time',
        datasetSize: `${((JSON.stringify(posts).length + JSON.stringify(comments).length) / 1024 / 1024).toFixed(2)} MB`
      },
      themes: themes.map((t, i) => ({ ...t, id: String(i + 1) })),
      painPoints: painPoints.map((p, i) => ({ ...p, id: String(i + 1) })),
      beliefs: beliefs.map((b, i) => ({ ...b, id: String(i + 1) })),
      emotions,
      topicSentiment,
      quotes,
      engagementPatterns: [
        { metric: 'Average score', value: Math.round(posts.reduce((a, p) => a + p.score, 0) / posts.length).toString(), description: 'Upvotes per post' },
        { metric: 'Avg comments', value: Math.round(posts.reduce((a, p) => a + p.num_comments, 0) / posts.length).toString(), description: 'Comments per post' },
        { metric: 'Top theme', value: themes[0]?.name || 'N/A', description: 'Most discussed' },
        { metric: 'Analysis time', value: new Date().toLocaleTimeString(), description: 'Completed at' }
      ],
      trends: []
    };
    
    results.set(jobId, result);
    
  } catch (error) {
    console.error('Analysis error:', error);
    job.status = 'failed';
    job.error = error.message;
  }
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    aiProvider: 'Groq',
    model: GROQ_MODEL
  });
});

// Start analysis
app.post('/api/analyze', async (req, res) => {
  const { subreddit, timeRange, maxPosts, includeComments, optionalTopic } = req.body;
  
  if (!subreddit) {
    return res.status(400).json({ error: 'Subreddit name is required' });
  }
  
  if (!GROQ_API_KEY) {
    return res.status(500).json({ 
      error: 'Groq API key not configured',
      help: 'Get a free API key at https://console.groq.com'
    });
  }
  
  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: 'processing',
    currentStage: 0,
    progress: 0,
    postsFetched: 0,
    commentsFetched: 0,
    createdAt: new Date().toISOString()
  };
  
  jobs.set(jobId, job);
  
  // Start analysis in background
  runAnalysis(jobId, { subreddit, timeRange, maxPosts, includeComments, optionalTopic });
  
  res.json({ jobId, status: 'processing' });
});

// Get job status
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    currentStage: STAGES[job.currentStage],
    postsFetched: job.postsFetched,
    commentsFetched: job.commentsFetched,
    error: job.error
  });
});

// Get results
app.get('/api/results/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Analysis not complete', status: job.status });
  }
  
  const result = results.get(req.params.jobId);
  
  if (!result) {
    return res.status(404).json({ error: 'Results not found' });
  }
  
  res.json(result);
});

// Generate report
app.post('/api/report/:jobId', async (req, res) => {
  const { type } = req.body;
  const result = results.get(req.params.jobId);
  
  if (!result) {
    return res.status(404).json({ error: 'Results not found' });
  }
  
  const prompt = `Generate a ${type} report based on this Reddit analysis data:

Subreddit: ${result.summary.subreddit}
Posts analyzed: ${result.summary.postsAnalyzed}
Themes: ${result.themes.map(t => t.name).join(', ')}
Top emotions: ${result.emotions.map(e => `${e.emotion} (${e.percentage}%)`).join(', ')}

Key themes:
${result.themes.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Pain points:
${result.painPoints.map(p => `- ${p.description}`).join('\n')}

Community beliefs:
${result.beliefs.map(b => `- ${b.statement}`).join('\n')}

Generate a well-formatted ${type} report that summarizes these insights. Make it engaging and suitable for ${type === 'reddit' ? 'a Reddit post' : type === 'twitter' ? 'a Twitter thread' : type === 'blog' ? 'a blog article' : 'a research report'}.`;

  try {
    const report = await callGroq([
      { role: 'system', content: 'You are an expert at writing engaging reports and summaries.' },
      { role: 'user', content: prompt }
    ], 0.8);
    
    res.json({ report });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report: ' + error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`AI Provider: Groq`);
  console.log(`Model: ${GROQ_MODEL}`);
  console.log(`Groq API Key configured: ${GROQ_API_KEY ? 'Yes' : 'No (get free key at https://console.groq.com)'}`);
});
