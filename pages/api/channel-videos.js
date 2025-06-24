const { youtube, extractChannelId, isYouTubeShort, isYouTubeShortEnhanced, parseDuration } = require('../../lib/youtube');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

        console.log(`Video: ${item.snippet.title.substring(0, 50)}...`);
        if (videoDetails) {
          const durationSeconds = parseDuration(videoDetails.duration);
          console.log(`  Duration: ${videoDetails.duration} (${durationSeconds}s)`);
          
          // If isShort is null, it means duration ≤3 minutes and we need to check if vertical
          if (isShort === null) {
            console.log(`  🤔 Duration ≤3 minutes, using yt-dlp to check if vertical...`);
            const enhancedResult = await isYouTubeShortEnhanced(item.id.videoId, false);
            console.log(`  🔄 Enhanced detection returned: ${enhancedResult}`);
            isShort = enhancedResult;
            console.log(`  ✅ Updated isShort to: ${isShort}`);
          }
        } else {
          // No video details, default to regular video
          isShort = false;
        }

        console.log(`  Final result: ${isShort ? 'SHORT' : 'VIDEO'} (isShort=${isShort})`);
        console.log(`Video: ${item.snippet.title.substring(0, 50)}... -> ${isShort ? 'SHORT' : 'VIDEO'} (isShort=${isShort})`);

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
}