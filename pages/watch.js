import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Watch() {
  const router = useRouter();
  const [videoId, setVideoId] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [channelTitle, setChannelTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState({ transcript: false, summary: false, videoInfo: false });
  const [error, setError] = useState({ transcript: '', summary: '', videoInfo: '' });
  const [activeTab, setActiveTab] = useState('transcript');
  const [copyFeedback, setCopyFeedback] = useState('');

  useEffect(() => {
    if (router.isReady) {
      const { v } = router.query;
      if (v) {
        setVideoId(v);
        // Auto-fetch video info and transcript when video ID is available
        fetchVideoInfo(v);
        fetchTranscript(v);
      }
    }
  }, [router.isReady, router.query]);

  const fetchVideoInfo = async (id) => {
    setLoading(prev => ({ ...prev, videoInfo: true }));
    setError(prev => ({ ...prev, videoInfo: '' }));

    try {
      const response = await fetch('/api/video-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId: id })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch video info');
      }

      setVideoTitle(data.title);
      setChannelTitle(data.channelTitle);
    } catch (err) {
      console.error('Error fetching video info:', err);
      setError(prev => ({ ...prev, videoInfo: err.message }));
      // Fallback title
      setVideoTitle('Video');
    } finally {
      setLoading(prev => ({ ...prev, videoInfo: false }));
    }
  };

  const fetchTranscript = async (id) => {
    setLoading(prev => ({ ...prev, transcript: true }));
    setError(prev => ({ ...prev, transcript: '' }));

    try {
      const response = await fetch('/api/transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId: id })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch transcript');
      }

      setTranscript(data.transcript);
      // Auto-start summary generation after transcript loads
      if (data.transcript && !summary) {
        setTimeout(() => fetchSummary(id), 1000); // Small delay to not overload
      }
    } catch (err) {
      console.error('Error fetching transcript:', err);
      setError(prev => ({ ...prev, transcript: err.message }));
    } finally {
      setLoading(prev => ({ ...prev, transcript: false }));
    }
  };

  const fetchSummary = async (id = videoId) => {
    if (summary) return; // Don't fetch if already have summary
    
    setLoading(prev => ({ ...prev, summary: true }));
    setError(prev => ({ ...prev, summary: '' }));

    try {
      const response = await fetch('/api/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId: id })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate summary');
      }

      setSummary(data.summary);
    } catch (err) {
      console.error('Error generating summary:', err);
      setError(prev => ({ ...prev, summary: err.message }));
    } finally {
      setLoading(prev => ({ ...prev, summary: false }));
    }
  };

  const copyToClipboard = async (text, type = 'content') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(`${type === 'transcript' ? 'Transcript' : 'Summary'} copied!`);
      setTimeout(() => setCopyFeedback(''), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback(''), 2000);
    }
  };

  const parseMarkdown = (markdown) => {
    if (!markdown) return '';
    
    let html = markdown;
    
    // Convert headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // Convert bold text
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert bullet points
    html = html.replace(/^\* (.*$)/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>');
    
    // Wrap consecutive <li> elements in <ul>
    html = html.replace(/(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/gs, (match) => {
      return '<ul>' + match + '</ul>';
    });
    
    // Convert line breaks to paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/^(?!<[hul])/gm, '<p>');
    html = html.replace(/(?<!>)$/gm, '</p>');
    
    // Clean up empty paragraphs and fix formatting
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<[hul])/g, '$1');
    html = html.replace(/(<\/[hul]>)<\/p>/g, '$1');
    
    return html;
  };

  const formatTranscript = (text) => {
    if (!text) return '';
    
    // Check if content appears to be markdown (contains # headers)
    if (text.includes('#') && text.includes('##')) {
      return parseMarkdown(text);
    } else {
      // Better sentence splitting for regular transcripts
      const sentences = text
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 0)
        .map(s => s.trim());
      
      return sentences.map(sentence => 
        `<p>${sentence.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
      ).join('');
    }
  };

  // Don't render anything until router is ready to avoid hydration issues
  if (!router.isReady) {
    return (
      <>
        <Head>
          <title>Loading... - YouTube Transcript</title>
        </Head>
        <div className="container">
          <header>
            <h1>YouTube Transcript Generator</h1>
            <p>Loading...</p>
          </header>
        </div>
      </>
    );
  }

  if (!videoId) {
    return (
      <>
        <Head>
          <title>Video not found - YouTube Transcript</title>
        </Head>
        <div className="container">
          <header>
            <h1>Video Not Found</h1>
            <p>No video ID provided in the URL.</p>
          </header>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{videoTitle || 'Video Transcript'} - YouTube Transcript</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <div className="container">
        <header>
          <h1>YouTube Transcript Generator</h1>
          <a href="/" className="back-link">← Back to Channel Search</a>
        </header>

        <div className="video-info-section">
          <div className="video-preview">
            <img 
              src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`} 
              alt="Video thumbnail"
              className="video-thumbnail-large"
              onError={(e) => {
                e.target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
              }}
            />
            <div className="video-details">
              <h2>{videoTitle || (loading.videoInfo ? 'Loading...' : 'Video')}</h2>
              {channelTitle && <p className="channel-name">by {channelTitle}</p>}
              <a 
                href={`https://www.youtube.com/watch?v=${videoId}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="view-on-youtube"
              >
                View on YouTube ↗
              </a>
            </div>
          </div>
        </div>

        <div className="content-tabs">
          <button 
            className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            Transcript
          </button>
          <button 
            className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            Summary
          </button>
        </div>

        <div className="content-section">
          {activeTab === 'transcript' && (
            <div className="transcript-section">
              <div className="section-header">
                <h3>Transcript</h3>
                {transcript && (
                  <button 
                    className="copy-btn"
                    onClick={() => copyToClipboard(transcript, 'transcript')}
                  >
                    {copyFeedback && activeTab === 'transcript' ? copyFeedback : 'Copy'}
                  </button>
                )}
              </div>
              
              {loading.transcript && (
                <div className="loading">
                  <div className="spinner"></div>
                  <p>Fetching transcript...</p>
                </div>
              )}
              
              {error.transcript && (
                <div className="error">Error: {error.transcript}</div>
              )}
              
              {transcript && !loading.transcript && (
                <div 
                  className="content-display"
                  dangerouslySetInnerHTML={{ __html: formatTranscript(transcript) }}
                />
              )}
            </div>
          )}

          {activeTab === 'summary' && (
            <div className="summary-section">
              <div className="section-header">
                <h3>AI Summary</h3>
                {summary && (
                  <button 
                    className="copy-btn"
                    onClick={() => copyToClipboard(summary, 'summary')}
                  >
                    {copyFeedback && activeTab === 'summary' ? copyFeedback : 'Copy'}
                  </button>
                )}
              </div>
              
              {loading.summary && (
                <div className="loading">
                  <div className="spinner"></div>
                  <p>Generating summary...</p>
                </div>
              )}
              
              {error.summary && (
                <div className="error">Error: {error.summary}</div>
              )}
              
              {summary && !loading.summary && (
                <div 
                  className="content-display"
                  dangerouslySetInnerHTML={{ __html: formatTranscript(summary) }}
                />
              )}
              
              {!summary && !loading.summary && !error.summary && (
                <div className="placeholder">
                  <p>AI summary will be generated automatically after transcript loads.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .back-link {
          color: #3b82f6;
          text-decoration: none;
          font-size: 14px;
          margin-top: 8px;
          display: inline-block;
        }
        
        .back-link:hover {
          text-decoration: underline;
        }
        
        .video-info-section {
          margin: 2rem 0;
          padding: 1.5rem;
          background: #f8fafc;
          border-radius: 8px;
        }
        
        .video-preview {
          display: flex;
          gap: 1.5rem;
          align-items: flex-start;
        }
        
        .video-thumbnail-large {
          width: 300px;
          height: 169px;
          object-fit: cover;
          border-radius: 8px;
          flex-shrink: 0;
        }
        
        .video-details h2 {
          margin: 0 0 0.5rem 0;
          color: #1f2937;
          font-size: 1.5rem;
          line-height: 1.4;
        }
        
        .channel-name {
          margin: 0 0 1rem 0;
          color: #6b7280;
          font-size: 0.9rem;
        }
        
        .view-on-youtube {
          color: #dc2626;
          text-decoration: none;
          padding: 8px 16px;
          border: 1px solid #dc2626;
          border-radius: 4px;
          display: inline-block;
          font-size: 14px;
          transition: all 0.2s;
        }
        
        .view-on-youtube:hover {
          background: #dc2626;
          color: white;
        }
        
        .content-tabs {
          display: flex;
          gap: 0;
          margin: 2rem 0 0 0;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .tab-btn {
          padding: 12px 24px;
          border: none;
          background: none;
          color: #6b7280;
          font-size: 16px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
        }
        
        .tab-btn:hover {
          color: #374151;
        }
        
        .tab-btn.active {
          color: #3b82f6;
          border-bottom-color: #3b82f6;
        }
        
        .content-section {
          min-height: 400px;
        }
        
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 1.5rem 0 1rem 0;
        }
        
        .section-header h3 {
          margin: 0;
          color: #1f2937;
        }
        
        .copy-btn {
          padding: 8px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        
        .copy-btn:hover {
          background: #2563eb;
        }
        
        .copy-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .content-display {
          line-height: 1.6;
          color: #374151;
          max-width: none;
        }
        
        .content-display h1, .content-display h2, .content-display h3 {
          color: #1f2937;
          margin: 1.5rem 0 1rem 0;
        }
        
        .content-display h1 { font-size: 1.5rem; }
        .content-display h2 { font-size: 1.3rem; }
        .content-display h3 { font-size: 1.1rem; }
        
        .content-display ul {
          margin: 1rem 0;
          padding-left: 2rem;
        }
        
        .content-display li {
          margin: 0.5rem 0;
        }
        
        .content-display p {
          margin: 1rem 0;
        }
        
        .placeholder {
          text-align: center;
          color: #6b7280;
          padding: 2rem;
        }
        
        .loading {
          text-align: center;
          padding: 2rem;
        }
        
        .spinner {
          border: 4px solid #f3f4f6;
          border-top: 4px solid #3b82f6;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto 1rem;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .error {
          color: #dc2626;
          background: #fef2f2;
          padding: 1rem;
          border-radius: 4px;
          border: 1px solid #fecaca;
        }
        
        @media (max-width: 768px) {
          .video-preview {
            flex-direction: column;
          }
          
          .video-thumbnail-large {
            width: 100%;
            height: auto;
          }
          
          .content-tabs {
            overflow-x: auto;
          }
        }
      `}</style>
    </>
  );
}