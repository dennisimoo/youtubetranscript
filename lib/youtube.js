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

// Transcript fetcher using yt-dlp VTT subtitle files
async function getTranscript(videoId) {
  try {
    console.log('🎥 Fetching transcript using yt-dlp...');
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tempDir = './temp';
    const outputTemplate = `${tempDir}/${videoId}.%(ext)s`;
    
    // Create temp directory if it doesn't exist
    await execAsync(`mkdir -p ${tempDir}`);
    
    // Download VTT subtitle file using yt-dlp with proxy
    const proxyUrl = `http://${process.env.WEBSHARE_PROXY_USERNAME}:${process.env.WEBSHARE_PROXY_PASSWORD}@rotating-residential.webshare.io:9000`;
    const ytdlpCmd = `yt-dlp --proxy "${proxyUrl}" --write-subs --write-auto-subs --sub-langs en --sub-format vtt --skip-download -o "${outputTemplate}" "${videoUrl}"`;
    
    try {
      await execAsync(ytdlpCmd);
    } catch (error) {
      throw new Error(`yt-dlp failed: ${error.message}`);
    }
    
    // Find the VTT file
    const { stdout: lsOutput } = await execAsync(`ls ${tempDir}/${videoId}.*.vtt 2>/dev/null || echo ""`);
    const vttFiles = lsOutput.trim().split('\n').filter(f => f.length > 0);
    
    if (vttFiles.length === 0) {
      throw new Error('No VTT subtitle file found');
    }
    
    const vttFile = vttFiles[0];
    console.log(`📄 Found VTT file: ${vttFile}`);
    
    // Read and parse VTT file
    const { stdout: vttContent } = await execAsync(`cat "${vttFile}"`);
    const transcript = parseVttToTranscript(vttContent);
    
    // Clean up VTT file
    await execAsync(`rm -f "${vttFile}"`);
    
    if (!transcript || transcript.length === 0) {
      throw new Error('No transcript content extracted from VTT file');
    }
    
    console.log(`✅ Success! Transcript length: ${transcript.length} characters`);
    return transcript;
    
  } catch (error) {
    throw new Error(`Failed to get transcript: ${error.message}`);
  }
}

// Helper function to parse VTT content into clean transcript text
function parseVttToTranscript(vttContent) {
  const segments = vttContent.split('\n\n');
  const transcriptLines = [];
  const seenLines = new Set();
  
  for (const segment of segments) {
    const lines = segment.trim().split('\n');
    if (lines.length < 2) continue;
    
    let textLines = [];
    
    // Extract text lines (skip timestamp lines)
    if (lines[0].includes('-->')) {
      // First line has timestamp
      textLines = lines.slice(1);
    } else if (lines.length > 1 && lines[1].includes('-->')) {
      // Second line has timestamp
      textLines = lines.slice(2);
    } else {
      continue;
    }
    
    // Process text lines
    for (const line of textLines) {
      const cleanLine = line.trim();
      if (cleanLine && 
          !cleanLine.startsWith('WEBVTT') && 
          !cleanLine.startsWith('NOTE')) {
        
        // Remove HTML tags and clean up
        const finalLine = cleanLine.replace(/<[^>]+>/g, '').trim();
        
        if (finalLine && !seenLines.has(finalLine)) {
          transcriptLines.push(finalLine);
          seenLines.add(finalLine);
        }
      }
    }
  }
  
  // Join all lines into a single transcript
  return transcriptLines.join(' ');
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