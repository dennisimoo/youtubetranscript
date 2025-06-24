const { getTranscript, generateSummary } = require('../../lib/youtube');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}