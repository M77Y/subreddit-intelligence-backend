const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - Must be FIRST
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10mb' }));

const jobs = new Map();
const results = new Map();
const REDDIT_BASE_URL = 'https://www.reddit.com';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const STAGES = ['Fetching posts', 'Reading comments', 'Clustering themes', 'Extracting opinions', 'Scoring sentiment', 'Finalizing report'];

async function fetchRedditPosts(subreddit, timeRange, maxPosts) {
  const timeParam = timeRange === 'month' ? 'month' : timeRange === 'year' ? 'year' : 'all';
  const limit = Math.min(maxPosts, 100);
  const url = `${REDDIT_BASE_URL}/r/${subreddit}/top.json?t=${timeParam}&limit=${limit}`;
  const response = await axios.get(url, { headers: { 'User-Agent': 'SubredditIntelligence/1.0' } });
  return response.data.data.children.map(child => ({
    id: child.data.id, title: child.data.title, selftext: child.data.selftext || '',
    score: child.data.score, num_comments: child.data.num_comments,
    created_utc: child.data.created_utc, permalink: child.data.permalink, author: child.data.author
  }));
}

async function fetchComments(subreddit, postId) {
  const url = `${REDDIT_BASE_URL}/r/${subreddit}/comments/${postId}.json`;
  try {
    const response = await axios.get(url, { headers: { 'User-Agent': 'SubredditIntelligence/1.0' } });
    const comments = [];
    const commentList = response.data[1]?.data?.children || [];
    function extractComments(nodes) {
      for (const node of nodes) {
        if (node.data && node.data.body) {
          comments.push({ id: node.data.id, body: node.data.body, score: node.data.score, author: node.data.author, created_utc: node.data.created_utc });
        }
        if (node.data?.replies?.data?.children) extractComments(node.data.replies.data.children);
      }
    }
    extractComments(commentList);
    return comments.slice(0, 50);
  } catch (error) { return []; }
}

async function callGroq(messages, temperature = 0.7) {
  if (!GROQ_API_KEY) throw new Error('Groq API key not configured');
  const response = await axios.post(`${GROQ_API_URL}/chat/completions`, {
    model: GROQ_MODEL, messages, temperature, max_tokens: 4000
  }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } });
  return response.data.choices[0].message.content;
}

async function analyzeThemes(posts) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  const prompt = `Analyze these Reddit posts and identify top 3-5 recurring themes. Format as JSON: {"themes":[{"name":"Theme","percentage":25,"description":"...","keyPhrases":["..."],"quotes":["..."]}]}\n\nPOSTS:\n${combinedText.substring(0, 8000)}`;
  const response = await callGroq([{ role: 'system', content: 'Always respond with valid JSON.' }, { role: 'user', content: prompt }]);
  try { const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || response); return parsed.themes || []; } catch (e) { return []; }
}

async function extractPainPoints(posts) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  const prompt = `Identify top 5 complaints. Format JSON: {"painPoints":[{"description":"...","frequency":45,"intensity":"High","quote":"..."}]}\n\nPOSTS:\n${combinedText.substring(0, 8000)}`;
  const response = await callGroq([{ role: 'system', content: 'Always respond with valid JSON.' }, { role: 'user', content: prompt }]);
  try { const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || response); return parsed.painPoints || []; } catch (e) { return []; }
}

async function extractBeliefs(posts) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  const prompt = `Extract 4-5 common beliefs. Format JSON: {"beliefs":[{"statement":"...","quotes":["..."],"relatedThemes":["..."]}]}\n\nPOSTS:\n${combinedText.substring(0, 8000)}`;
  const response = await callGroq([{ role: 'system', content: 'Always respond with valid JSON.' }, { role: 'user', content: prompt }]);
  try { const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || response); return parsed.beliefs || []; } catch (e) { return []; }
}

async function analyzeEmotions(posts) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  const prompt = `Analyze emotions: Anger, Frustration, Sadness, Support, Healing. Format JSON: {"emotions":[{"emotion":"Anger","percentage":35,"quote":"..."}]}\n\nPOSTS:\n${combinedText.substring(0, 8000)}`;
  const response = await callGroq([{ role: 'system', content: 'Always respond with valid JSON.' }, { role: 'user', content: prompt }]);
  try { const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || response); return parsed.emotions || []; } catch (e) { return []; }
}

async function analyzeTopicSentiment(posts, topic) {
  const combinedText = posts.map(p => p.title + ' ' + p.selftext).join('\n---\n');
  const prompt = `Analyze sentiment for "${topic}". Format JSON: {"mentions":47,"sentiment":{"positive":30,"negative":50,"mixed":20},"argumentsFor":["..."],"argumentsAgainst":["..."],"quotes":["..."]}\n\nPOSTS:\n${combinedText.substring(0, 8000)}`;
  const response = await callGroq([{ role: 'system', content: 'Always respond with valid JSON.' }, { role: 'user', content: prompt }]);
  try { const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || response); return parsed; } catch (e) { return null; }
}

function extractQuotes(posts, comments) {
  const allContent = [...posts.map(p => ({ text: p.title + ' ' + p.selftext, ...p })), ...comments.map(c => ({ text: c.body, ...c }))];
  return allContent.filter(i => i.text.length > 50 && i.text.length < 500).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6).map((item, i) => ({
    id: `quote-${i}`, text: item.text.substring(0, 300), date: new Date(item.created_utc * 1000).toISOString().split('T')[0],
    score: item.score || 0, theme: 'General', emotion: 'Mixed', sentiment: 'mixed', url: `https://reddit.com${item.permalink || ''}`
  }));
}

async function runAnalysis(jobId, config) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    job.currentStage = 0; job.progress = 10;
    const posts = await fetchRedditPosts(config.subreddit, config.timeRange, config.maxPosts);
    job.postsFetched = posts.length;
    
    job.currentStage = 1; job.progress = 25;
    let comments = [];
    if (config.includeComments) {
      for (const post of posts.slice(0, 10)) { comments.push(...await fetchComments(config.subreddit, post.id)); }
    }
    job.commentsFetched = comments.length;
    
    job.currentStage = 2; job.progress = 40;
    const themes = await analyzeThemes(posts);
    
    job.currentStage = 3; job.progress = 55;
    const painPoints = await extractPainPoints(posts);
    
    job.progress = 65;
    const beliefs = await extractBeliefs(posts);
    
    job.currentStage = 4; job.progress = 75;
    const emotions = await analyzeEmotions(posts);
    
    let topicSentiment = null;
    if (config.optionalTopic) { job.progress = 85; topicSentiment = await analyzeTopicSentiment(posts, config.optionalTopic); }
    
    job.currentStage = 5; job.progress = 95;
    const quotes = extractQuotes(posts, comments);
    
    job.progress = 100; job.status = 'completed';
    results.set(jobId, {
      config, summary: { subreddit: `r/${config.subreddit}`, postsAnalyzed: posts.length, commentsAnalyzed: comments.length,
        timeRange: config.timeRange === 'month' ? 'Last 30 days' : config.timeRange === 'year' ? 'Last 12 months' : 'All time',
        datasetSize: `${((JSON.stringify(posts).length + JSON.stringify(comments).length) / 1024 / 1024).toFixed(2)} MB` },
      themes: themes.map((t, i) => ({ ...t, id: String(i + 1) })),
      painPoints: painPoints.map((p, i) => ({ ...p, id: String(i + 1) })),
      beliefs: beliefs.map((b, i) => ({ ...b, id: String(i + 1) })),
      emotions, topicSentiment, quotes,
      engagementPatterns: [
        { metric: 'Average score', value: Math.round(posts.reduce((a, p) => a + p.score, 0) / posts.length).toString(), description: 'Upvotes per post' },
        { metric: 'Avg comments', value: Math.round(posts.reduce((a, p) => a + p.num_comments, 0) / posts.length).toString(), description: 'Comments per post' },
        { metric: 'Top theme', value: themes[0]?.name || 'N/A', description: 'Most discussed' },
        { metric: 'Analysis time', value: new Date().toLocaleTimeString(), description: 'Completed at' }
      ], trends: []
    });
  } catch (error) { console.error('Analysis error:', error); job.status = 'failed'; job.error = error.message; }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), aiProvider: 'Groq', model: GROQ_MODEL, groqConfigured: !!GROQ_API_KEY }));

app.post('/api/analyze', async (req, res) => {
  const { subreddit, timeRange, maxPosts, includeComments, optionalTopic } = req.body;
  if (!subreddit) return res.status(400).json({ error: 'Subreddit name is required' });
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'Groq API key not configured', help: 'Get a free API key at https://console.groq.com' });
  const jobId = uuidv4();
  jobs.set(jobId, { id: jobId, status: 'processing', currentStage: 0, progress: 0, postsFetched: 0, commentsFetched: 0, createdAt: new Date().toISOString() });
  runAnalysis(jobId, { subreddit, timeRange, maxPosts, includeComments, optionalTopic });
  res.json({ jobId, status: 'processing' });
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ jobId: job.id, status: job.status, progress: job.progress, currentStage: STAGES[job.currentStage], postsFetched: job.postsFetched, commentsFetched: job.commentsFetched, error: job.error });
});

app.get('/api/results/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed') return res.status(400).json({ error: 'Analysis not complete', status: job.status });
  const result = results.get(req.params.jobId);
  if (!result) return res.status(404).json({ error: 'Results not found' });
  res.json(result);
});

app.post('/api/report/:jobId', async (req, res) => {
  const { type } = req.body;
  const result = results.get(req.params.jobId);
  if (!result) return res.status(404).json({ error: 'Results not found' });
  const prompt = `Generate a ${type} report for ${result.summary.subreddit} with themes: ${result.themes.map(t => t.name).join(', ')}`;
  try {
    const report = await callGroq([{ role: 'system', content: 'Write engaging reports.' }, { role: 'user', content: prompt }], 0.8);
    res.json({ report });
  } catch (error) { res.status(500).json({ error: 'Failed to generate report' }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
