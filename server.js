require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/channel-videos', async (req, res) => {
  try {
    const { channelUrl, maxResults = 20, contentType = 'videos' } = req.body;
    console.log('Fetching content for channel URL:', channelUrl, 'Type:', contentType);
    
    let channelId = await extractChannelId(channelUrl);
    console.log('Extracted channel ID:', channelId);
    
    if (!channelId) {
      console.log('Failed to extract channel ID from URL:', channelUrl);
      return res.status(400).json({ error: 'Invalid channel URL or could not find channel' });
    }

    let allVideos = [];
    let shorts = [];
    let regularVideos = [];

    if (contentType === 'both' || contentType === 'videos' || contentType === 'shorts') {
      // Fetch much more videos initially to ensure we have enough after filtering
      // Since we don't know the ratio of videos vs shorts, fetch way more than needed
      const fetchSize = Math.max(parseInt(maxResults) * 5, 100); // Fetch 5x requested or 100, whichever is higher
      
      console.log('Making YouTube API request with channelId:', channelId, 'fetchSize:', fetchSize, 'maxResults:', maxResults);
      const response = await youtube.search.list({
        part: 'snippet',
        channelId: channelId,
        type: 'video',
        order: 'date',
        maxResults: fetchSize // Use dynamic fetch size based on user request
      });
      
      console.log('YouTube API returned', response.data.items.length, 'videos');
      console.log('Sample video titles:', response.data.items.slice(0, 3).map(item => item.snippet.title));
      
      if (response.data.items.length < 10) {
        console.log('WARNING: Very few videos returned. This might indicate:');
        console.log('1. Channel has few recent videos');
        console.log('2. Channel might be primarily Shorts');
        console.log('3. API quota/rate limiting');
      }

      // Get video details to determine duration, thumbnails, and shorts indicators
      const videoIds = response.data.items.map(item => item.id.videoId);
      const detailsResponse = await youtube.videos.list({
        part: 'contentDetails,snippet,statistics',
        id: videoIds.join(',')
      });

      // Create a map of video details
      const videoDetailsMap = {};
      detailsResponse.data.items.forEach(item => {
        videoDetailsMap[item.id] = {
          duration: item.contentDetails.duration,
          thumbnails: item.snippet.thumbnails,
          description: item.snippet.description,
          tags: item.snippet.tags || []
        };
      });

      // Process videos and categorize using improved shorts detection
      const videoProcessingPromises = response.data.items.map(async (item) => {
        const videoData = {
          id: item.id.videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          publishedAt: item.snippet.publishedAt,
          thumbnail: item.snippet.thumbnails.medium.url
        };

        // Use improved shorts detection
        const videoDetails = videoDetailsMap[item.id.videoId];
        let isShort = isYouTubeShort(videoDetails);

        console.log(`Video: ${item.snippet.title.substring(0, 50)}... -> ${isShort ? 'SHORT' : 'VIDEO'}`);
        if (videoDetails) {
          const durationSeconds = parseDuration(videoDetails.duration);
          console.log(`  Duration: ${videoDetails.duration} (${durationSeconds}s)`);
          console.log(`  Has thumbnails: ${!!videoDetails.thumbnails}`);
          
          // Use enhanced detection for uncertain cases (videos between 60-180 seconds)
          if (durationSeconds > 60 && durationSeconds <= 180) {
            console.log(`  🤔 Uncertain case (${durationSeconds}s), using enhanced detection...`);
            isShort = await isYouTubeShortEnhanced(item.id.videoId, isShort);
          }
        }

        return { videoData, isShort };
      });
      
      // Wait for all video processing to complete
      const processedVideos = await Promise.all(videoProcessingPromises);
      
      // Sort into categories
      processedVideos.forEach(({ videoData, isShort }) => {
        if (isShort) {
          shorts.push({ ...videoData, type: 'short' });
        } else {
          regularVideos.push({ ...videoData, type: 'video' });
        }
      });
    }

    // Return based on content type
    if (contentType === 'shorts') {
      allVideos = shorts.slice(0, parseInt(maxResults));
    } else if (contentType === 'videos') {
      allVideos = regularVideos.slice(0, parseInt(maxResults));
    } else if (contentType === 'both') {
      // For 'both', combine and limit to total requested amount
      const combined = [...regularVideos, ...shorts];
      // Sort by published date (most recent first)
      combined.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      // Take only the requested number of total items
      allVideos = combined.slice(0, parseInt(maxResults));
    }

    console.log(`Found ${regularVideos.length} regular videos, ${shorts.length} shorts`);
    console.log(`Returning ${allVideos.length} items for type: ${contentType}`);
    
    // Calculate counts for display (actual splits of the returned items)
    const displayedRegular = allVideos.filter(v => v.type !== 'short').length;
    const displayedShorts = allVideos.filter(v => v.type === 'short').length;
    
    res.json({ 
      videos: allVideos,
      counts: {
        regular: displayedRegular,
        shorts: displayedShorts,
        returned: allVideos.length
      }
    });
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    console.error('Error details:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch channel videos: ' + error.message });
  }
});

// Helper function to parse YouTube duration format (PT1M30S -> 90 seconds)
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  
  return hours * 3600 + minutes * 60 + seconds;
}

// Improved YouTube Shorts detection using multiple indicators
function isYouTubeShort(videoDetails) {
  if (!videoDetails) {
    console.log('  No video details available');
    return false;
  }
  
  const { duration, thumbnails, description, tags } = videoDetails;
  
  // 1. Check Duration - YouTube Shorts are max 60 seconds typically
  if (duration) {
    const durationSeconds = parseDuration(duration);
    console.log(`  Analyzing duration: ${durationSeconds}s`);
    
    // 2. Check for Shorts indicators in description or tags first
    const textToCheck = ((description || '').toLowerCase() + ' ' + (tags || []).join(' ').toLowerCase());
    const shortsKeywords = ['#shorts', '#short', 'youtube shorts', 'ytshorts'];
    const hasShortIndicator = shortsKeywords.some(keyword => textToCheck.includes(keyword));
    
    if (hasShortIndicator) {
      console.log('  Found shorts keyword indicator');
      return true; // Explicitly marked as a Short
    }
    
    // 3. Check Aspect Ratio using thumbnail dimensions
    if (thumbnails) {
      // Get the highest resolution thumbnail available for better accuracy
      const thumbnailInfo = thumbnails.maxres || 
                           thumbnails.standard || 
                           thumbnails.high || 
                           thumbnails.medium || 
                           thumbnails.default;
      
      if (thumbnailInfo && thumbnailInfo.width && thumbnailInfo.height) {
        const { width, height } = thumbnailInfo;
        const aspectRatio = width / height;
        console.log(`  Aspect ratio: ${aspectRatio.toFixed(2)} (${width}x${height})`);
        
        // Vertical aspect ratio (9:16 or similar) indicates a Short
        if (aspectRatio < 0.9 && durationSeconds <= 180) { // More vertical than square, under 3 min
          console.log('  Detected as short: vertical aspect ratio');
          return true;
        }
      }
    }
    
    // 4. Duration-based detection (more lenient)
    if (durationSeconds <= 60) {
      console.log('  Detected as short: duration <= 60s');
      return true;
    }
    
    // 5. Definitive exclusion: over 3 minutes is definitely not a Short
    if (durationSeconds > 180) {
      console.log('  Detected as video: duration > 180s');
      return false;
    }
  }
  
  console.log('  Detected as video: no short indicators found');
  return false;
}

// Import child_process for Python API
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
// Enhanced shorts detection using URL conversion test
async function isYouTubeShortEnhanced(videoId, fallbackResult = false) {
  try {
    console.log(`  🔍 Testing shorts URL for: ${videoId}`);
    const shortsUrl = `https://www.youtube.com/shorts/${videoId}`;
    
    // Test if the shorts URL is accessible
    const response = await fetch(shortsUrl, { 
      method: 'HEAD',
      timeout: 3000 // 3 second timeout
    });
    
    console.log(`  📡 Shorts URL response: ${response.status}`);
    
    // If the shorts URL returns 200, it's likely a short
    if (response.status === 200) {
      console.log(`  ✅ Detected as SHORT: shorts URL accessible`);
      return true;
    } else {
      console.log(`  ✅ Detected as VIDEO: shorts URL not accessible`);
      return false;
    }
    
  } catch (error) {
    console.log(`  ❌ Shorts URL test failed for ${videoId}: ${error.message}`);
    console.log(`  🔄 Using fallback result: ${fallbackResult}`);
    return fallbackResult;
  }
}

// Simple transcript fetcher using Python API
async function getTranscript(videoId) {
  try {
    console.log('🐍 Fetching transcript...');
    
    const pythonCmd = `python3 -c "
from youtube_transcript_api import YouTubeTranscriptApi
import json
try:
    transcript = YouTubeTranscriptApi.get_transcript('${videoId}')
    text = ' '.join([item['text'] for item in transcript])
    print(json.dumps({'success': True, 'transcript': text}))
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
"`;
    
    const { stdout } = await execAsync(pythonCmd);
    const result = JSON.parse(stdout.trim());
    
    if (result.success) {
      console.log(`✅ Success! Transcript length: ${result.transcript.length} characters`);
      return result.transcript;
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    throw new Error(`Failed to get transcript: ${error.message}`);
  }
}

// Single transcript endpoint
app.post('/api/transcript', async (req, res) => {
  try {
    const { videoId } = req.body;
    console.log('\n🎯 Fetching transcript for video ID:', videoId);
    
    const transcript = await getTranscript(videoId);
    
    console.log('✅ Successfully fetched transcript!');
    res.json({ transcript });
    
  } catch (error) {
    console.error('❌ Error fetching transcript:', error.message);
    res.status(404).json({ 
      error: 'No transcript available for this video. This video may not have captions enabled or may be private/restricted.'
    });
  }
});

// Summary endpoint using Gemini
app.post('/api/summary', async (req, res) => {
  try {
    const { videoId } = req.body;
    console.log('\n📝 Generating summary for video ID:', videoId);
    
    // First get the transcript
    const transcript = await getTranscript(videoId);
    
    // Then generate summary with Gemini
    const summary = await generateSummary(transcript);
    
    console.log('✅ Successfully generated summary!');
    res.json({ summary });
    
  } catch (error) {
    console.error('❌ Error generating summary:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate summary. Please try again.'
    });
  }
});

// Function to generate summary using Gemini 2.0 Flash
async function generateSummary(transcript) {
  try {
    console.log('🤖 Generating summary with Gemini 2.0 Flash...');
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Please provide a comprehensive summary of the following YouTube video transcript in this exact format:

# **[VIDEO TITLE/TOPIC]**

## 🎯 Overview
[Comprehensive overview paragraph explaining what the video covers, who presents it, and the main purpose/goals]

## 📝 Main Topics Covered
* [Detailed bullet points of all major topics discussed in the video]

## 💡 Key Takeaways & Insights
1. [Numbered list of the most important insights and lessons from the video]

## 🎯 Actionable Strategies & Recommendations
* **[Category]:** [Specific actionable advice organized by relevant categories]

## 📊 Specific Details & Examples
* [Important statistics, examples, or specific details mentioned]

## ⚠️ Critical Warnings & Common Mistakes
* [Any warnings or common pitfalls discussed in the video]

## 🔗 Resources & References
* [Any resources, tools, or references mentioned]

Transcript to summarize:
${transcript}`
          }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API error response: ${errorText}`);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      const summary = data.candidates[0].content.parts[0].text;
      console.log(`✅ Gemini 2.0 Flash summary generated! Length: ${summary.length} characters`);
      return summary;
    } else {
      throw new Error('No summary generated by Gemini');
    }
    
  } catch (error) {
    throw new Error(`Gemini API failed: ${error.message}`);
  }
}

async function extractChannelId(url) {
  console.log('Extracting channel ID from URL:', url);
  
  // Clean URL by removing common suffixes
  const cleanUrl = url.replace(/\/(videos|shorts|playlists|community|about).*$/, '');
  console.log('Cleaned URL:', cleanUrl);
  
  const patterns = [
    /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/@([a-zA-Z0-9_-]+)/,
    /youtube\.com\/user\/([a-zA-Z0-9_-]+)/
  ];
  
  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match) {
      console.log('Pattern matched:', pattern, 'Extract:', match[1]);
      if (cleanUrl.includes('/@')) {
        console.log('Handle detected, converting to channel ID...');
        return await getChannelIdFromHandle(match[1]);
      }
      return match[1];
    }
  }
  console.log('No pattern matched for URL:', cleanUrl);
  return null;
}

async function getChannelIdFromHandle(handle) {
  try {
    console.log('Looking up channel ID for handle:', handle);
    
    // Try different search approaches
    const searchQueries = [
      `@${handle}`,
      handle,
      `${handle} channel`
    ];
    
    for (const query of searchQueries) {
      console.log('Trying search query:', query);
      const response = await youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 10
      });
      
      console.log(`Search results for "${query}":`, response.data.items.length, 'channels found');
      
      if (response.data.items.length > 0) {
        
        // Priority 2: Exact handle match
        for (const item of response.data.items) {
          const channelHandle = item.snippet.customUrl || '';
          const searchHandle = handle.toLowerCase();
          
          console.log('Checking channel:', item.snippet.title, 'Handle:', channelHandle);
          
          if (channelHandle === `@${searchHandle}` || channelHandle === searchHandle) {
            console.log('Found exact handle match:', item.snippet.channelId);
            return item.snippet.channelId;
          }
        }
        
        // Priority 3: Title starts with search term
        for (const item of response.data.items) {
          const channelTitle = item.snippet.title.toLowerCase();
          const searchHandle = handle.toLowerCase();
          
          if (channelTitle.startsWith(searchHandle) || channelTitle.startsWith(searchHandle.replace('-', ' '))) {
            console.log('Found title start match:', item.snippet.channelId);
            return item.snippet.channelId;
          }
        }
        
        // Priority 4: Exact word match in title (for other cases)
        for (const item of response.data.items) {
          const channelTitle = item.snippet.title.toLowerCase();
          const searchHandle = handle.toLowerCase();
          const titleWords = channelTitle.split(/[\s-]+/);
          const searchWords = searchHandle.split(/[\s-]+/);
          
          // Only match if ALL search words are found AND it's not a partial match
          if (searchWords.every(word => titleWords.includes(word)) && searchWords.length > 1) {
            console.log('Found word match:', item.snippet.channelId);
            return item.snippet.channelId;
          }
        }
        
        // If no exact match, return first result
        console.log('No exact match, using first result:', response.data.items[0].snippet.channelId);
        return response.data.items[0].snippet.channelId;
      }
    }
    
  } catch (error) {
    console.error('Error getting channel ID from handle:', error);
    console.error('Error details:', error.response?.data || error.message);
  }
  return null;
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (process.env.YOUTUBE_API_KEY) {
    console.log('YouTube API key loaded successfully');
  } else {
    console.log('WARNING: YOUTUBE_API_KEY not found in environment variables');
  }
});