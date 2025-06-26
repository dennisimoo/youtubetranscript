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

// YouTube Shorts detection - check duration then vertical format if needed
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
    
    let stdout;
    try {
      // Use basic yt-dlp to get video metadata
      const result = await execAsync(`yt-dlp -j "${videoUrl}"`);
      stdout = result.stdout;
    } catch (error) {
      console.log(`  ❌ yt-dlp failed: ${error.message}`);
      throw error;
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

// Transcript fetcher using YouTube Transcript API with Webshare proxy
async function getTranscript(videoId) {
  try {
    console.log('🐍 Fetching transcript with YouTube Transcript API...');
    
    // Individual proxy IPs from your Webshare dashboard
    const proxyList = [
      '198.23.239.134:6540',
      '207.244.217.165:6712', 
      '107.172.163.27:6543',
      '23.94.138.75:6349',
      '216.10.27.159:6837',
      '136.0.207.84:6661',
      '64.64.118.149:6732',
      '142.147.128.93:6593',
      '104.239.105.125:6655',
      '173.0.9.70:5653'
    ];
    
    // Pick a random proxy from the list
    const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
    console.log(`📡 Using proxy: ${randomProxy}`);
    
    // Create Python script to use YouTube Transcript API with individual proxy
    const pythonScript = `
import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig

try:
    # Setup proxy configuration using individual proxy IP
    proxy_config = GenericProxyConfig(
        http_url="http://${process.env.WEBSHARE_PROXY_USERNAME}:${process.env.WEBSHARE_PROXY_PASSWORD}@${randomProxy}",
        https_url="http://${process.env.WEBSHARE_PROXY_USERNAME}:${process.env.WEBSHARE_PROXY_PASSWORD}@${randomProxy}"
    )
    
    # Initialize API with proxy
    ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config)
    
    # Fetch transcript
    transcript = ytt_api.fetch('${videoId}')
    
    # Convert to text
    text = ' '.join([snippet.text for snippet in transcript])
    
    print(json.dumps({'success': True, 'transcript': text}))
    
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
`;

    const pythonCmd = `python3 -c "${pythonScript.replace(/"/g, '\\"')}"`;
    
    try {
      const { stdout } = await execAsync(pythonCmd);
      const result = JSON.parse(stdout.trim());
      
      if (result.success) {
        console.log(`✅ Success! Transcript length: ${result.transcript.length} characters`);
        return result.transcript;
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      const errorMsg = error.message.toLowerCase();
      console.log(`❌ Proxy failed: ${error.message}`);
      
      // If proxy fails, try with different proxy
      if (errorMsg.includes('proxy') || errorMsg.includes('connection') || errorMsg.includes('timeout')) {
        console.log('⚠️ Trying with different proxy...');
        const altProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
        console.log(`🔄 Using backup proxy: ${altProxy}`);
        
        const altPythonScript = `
import json
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig

try:
    proxy_config = GenericProxyConfig(
        http_url="http://${process.env.WEBSHARE_PROXY_USERNAME}:${process.env.WEBSHARE_PROXY_PASSWORD}@${altProxy}",
        https_url="http://${process.env.WEBSHARE_PROXY_USERNAME}:${process.env.WEBSHARE_PROXY_PASSWORD}@${altProxy}"
    )
    
    ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config)
    transcript = ytt_api.fetch('${videoId}')
    text = ' '.join([snippet.text for snippet in transcript])
    
    print(json.dumps({'success': True, 'transcript': text}))
    
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
`;

        const altPythonCmd = `python3 -c "${altPythonScript.replace(/"/g, '\\"')}"`;
        
        try {
          const { stdout: altStdout } = await execAsync(altPythonCmd);
          const altResult = JSON.parse(altStdout.trim());
          
          if (altResult.success) {
            console.log(`✅ Backup proxy succeeded! Transcript length: ${altResult.transcript.length} characters`);
            return altResult.transcript;
          } else {
            throw new Error(altResult.error);
          }
        } catch (altError) {
          console.log('⚠️ Backup proxy failed, trying without proxy...');
          
          // Final fallback - no proxy
          const noproxyScript = `
import json
from youtube_transcript_api import YouTubeTranscriptApi

try:
    ytt_api = YouTubeTranscriptApi()
    transcript = ytt_api.fetch('${videoId}')
    text = ' '.join([snippet.text for snippet in transcript])
    
    print(json.dumps({'success': True, 'transcript': text}))
    
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
`;

          const noproxyCmd = `python3 -c "${noproxyScript.replace(/"/g, '\\"')}"`;
          const { stdout: noproxyStdout } = await execAsync(noproxyCmd);
          const noproxyResult = JSON.parse(noproxyStdout.trim());
          
          if (noproxyResult.success) {
            console.log(`✅ No-proxy fallback succeeded! Transcript length: ${noproxyResult.transcript.length} characters`);
            return noproxyResult.transcript;
          } else {
            throw new Error(`All methods failed: ${noproxyResult.error}`);
          }
        }
      } else {
        throw new Error(result.error);
      }
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