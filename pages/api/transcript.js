const { getTranscript } = require('../../lib/youtube');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}