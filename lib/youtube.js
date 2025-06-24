require('dotenv').config();
const { google } = require('googleapis');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
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

// Simple YouTube Shorts detection - just check duration threshold
function isYouTubeShort(videoDetails) {
  if (!videoDetails || !videoDetails.duration) {
    console.log('  No video duration available, defaulting to VIDEO');
    return false;
  }
  
  const durationSeconds = parseDuration(videoDetails.duration);
  console.log(`  Analyzing duration: ${durationSeconds}s`);
  
  // If more than 3 minutes (180 seconds), definitely a regular video
  if (durationSeconds > 180) {
    console.log('  Detected as VIDEO: duration > 3 minutes');
    return false;
  }
  
  // For videos ≤3 minutes, we need to check if it's vertical using yt-dlp
  console.log('  Duration ≤3 minutes, will use yt-dlp to check if vertical');
  return null; // Signal that we need enhanced detection
}

// Enhanced shorts detection using yt-dlp to get actual video dimensions
async function isYouTubeShortEnhanced(videoId, fallbackResult = false) {
  try {
    console.log(`  🔍 Using yt-dlp to check video dimensions for: ${videoId}`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Create temp cookies file for yt-dlp
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempCookiesPath = path.join(os.tmpdir(), `cookies_${Date.now()}.txt`);
    const cookiesContent = process.env.COOKIES_TXT || '';
    console.log(`  📝 Writing ${cookiesContent.length} characters of cookies to ${tempCookiesPath}`);
    console.log(`  🔍 First 100 chars: ${cookiesContent.substring(0, 100)}`);
    fs.writeFileSync(tempCookiesPath, cookiesContent);
    console.log(`  ✅ Temp file created, size: ${fs.statSync(tempCookiesPath).size} bytes`);
    
    let stdout;
    try {
      // Use yt-dlp to get video metadata
      const result = await execAsync(`yt-dlp --cookies "${tempCookiesPath}" -j "${videoUrl}"`);
      stdout = result.stdout;
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempCookiesPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    const data = JSON.parse(stdout.trim());
    
    const duration = data.duration; // in seconds
    const width = data.width;
    const height = data.height;
    
    if (!width || !height) {
      console.log(`  ⚠️  No dimension data available for ${videoId}`);
      return fallbackResult;
    }
    
    // Check vertical format
    const aspectRatio = height / width;
    const isVertical = aspectRatio > 1.0;
    
    console.log(`  📏 Video dimensions: ${width}x${height} (aspect ratio: ${aspectRatio.toFixed(2)})`);
    console.log(`  ⏱️  Duration: ${duration}s`);
    console.log(`  📱 Is vertical: ${isVertical}`);
    
    // YouTube Shorts criteria: just check if vertical (duration already filtered to ≤3 minutes)
    const isShort = isVertical;
    
    console.log(`  🎯 yt-dlp result: ${isShort ? 'SHORT' : 'VIDEO'} (duration: ${duration}s, vertical: ${isVertical})`);
    
    return isShort;
    
  } catch (error) {
    console.log(`  ❌ yt-dlp detection failed for ${videoId}: ${error.message}`);
    console.log(`  🔄 Using fallback result: ${fallbackResult}`);
    return fallbackResult;
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
    
    // Try different search approaches - prioritize exact handle search
    const searchQueries = [
      `@${handle}`,
      handle
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
        
        // Use first result when searching for handle
        if (query === `@${handle}` && response.data.items.length > 0) {
          console.log('Using first result for @handle search:', response.data.items[0].snippet.channelId);
          return response.data.items[0].snippet.channelId;
        }
        
        console.log('No exact match found for query:', query);
      }
    }
    
  } catch (error) {
    console.error('Error getting channel ID from handle:', error);
    console.error('Error details:', error.response?.data || error.message);
  }
  return null;
}

// Simple transcript fetcher using Python API
async function getTranscript(videoId) {
  try {
    console.log('🐍 Fetching transcript...');
    
    const pythonCmd = `python3 -c "
from youtube_transcript_api import YouTubeTranscriptApi
import json
import requests
import http.cookiejar
import tempfile
import os
try:
    # Write cookies from env to temp file
    cookies_content = '''${process.env.COOKIES_TXT || ''}'''
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(cookies_content)
        temp_cookies_path = f.name
    
    jar = http.cookiejar.MozillaCookieJar(temp_cookies_path)
    jar.load()
    
    # Create a session with cookies
    session = requests.Session()
    session.cookies = jar
    
    # Monkey patch the session into the API
    import youtube_transcript_api._api
    youtube_transcript_api._api.requests = session
    
    transcript = YouTubeTranscriptApi.get_transcript('${videoId}')
    text = ' '.join([item['text'] for item in transcript])
    
    # Clean up temp file
    os.unlink(temp_cookies_path)
    
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

module.exports = {
  youtube,
  parseDuration,
  isYouTubeShort,
  isYouTubeShortEnhanced,
  extractChannelId,
  getChannelIdFromHandle,
  getTranscript,
  generateSummary
};