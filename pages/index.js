import Head from 'next/head';
import Image from 'next/image';
import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    // Wait for the script to load before initializing
    const initializeApp = () => {
      if (typeof window !== 'undefined' && window.YouTubeTranscriptApp) {
        const app = new window.YouTubeTranscriptApp();
        window.app = app; // Make it globally available for onclick handlers
      } else {
        // Retry after a short delay if the class isn't loaded yet
        setTimeout(initializeApp, 100);
      }
    };
    
    initializeApp();
  }, []);

  return (
    <>
      <Head>
        <title>YouTube Transcript Fetcher</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
      </Head>

      <div className="container">
        <header>
          <h1>YouTube Transcript Generator</h1>
          <p>Instantly, without uploading video files.</p>
        </header>

        <div className="input-section">
          <div className="form-group">
            <label htmlFor="channelUrl">YouTube Channel URL</label>
            <input 
              type="text" 
              id="channelUrl" 
              placeholder="https://www.youtube.com/@collegeadmissionsecrets"
              defaultValue="https://www.youtube.com/@collegeadmissionsecrets"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="videoCount">Number of videos</label>
            <select id="videoCount" defaultValue="20">
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="50">50</option>
            </select>
          </div>
          
          <button id="fetchVideos" className="fetch-btn">Fetch Videos</button>
        </div>

        <div id="loading" className="loading hidden">
          <div className="spinner"></div>
          <p>Fetching videos...</p>
        </div>

        <div id="error" className="error hidden"></div>

        <div id="contentToggle" className="content-toggle hidden">
          <button id="videosToggle" className="toggle-btn active" data-type="videos">
            Videos (<span id="videosCount">0</span>)
          </button>
          <button id="shortsToggle" className="toggle-btn" data-type="shorts">
            Shorts (<span id="shortsCount">0</span>)
          </button>
        </div>

        <div id="videosContainer" className="videos-container"></div>

        <div id="transcriptModal" className="modal hidden">
          <div className="modal-content">
            <div className="modal-header">
              <h3 id="modalTitle" className="modal-title"></h3>
              <div className="modal-actions">
                <button id="copyTranscript" className="copy-btn">Copy</button>
                <button id="closeModal" className="close-btn">&times;</button>
              </div>
            </div>
            <div className="modal-body">
              <div id="transcriptLoading" className="loading">
                <div className="spinner"></div>
                <p>Fetching transcript...</p>
              </div>
              <div id="transcriptContent" className="transcript-content"></div>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        window.YouTubeTranscriptApp = class YouTubeTranscriptApp {
          constructor() {
            this.currentView = 'videos';
            this.allVideos = [];
            this.regularVideos = [];
            this.shorts = [];
            this.initializeEventListeners();
          }

          initializeEventListeners() {
            const fetchBtn = document.getElementById('fetchVideos');
            const closeModalBtn = document.getElementById('closeModal');
            const copyBtn = document.getElementById('copyTranscript');
            const modal = document.getElementById('transcriptModal');

            // Toggle buttons
            const videosToggle = document.getElementById('videosToggle');
            const shortsToggle = document.getElementById('shortsToggle');
            
            if (videosToggle) videosToggle.addEventListener('click', () => this.switchToVideos());
            if (shortsToggle) shortsToggle.addEventListener('click', () => this.switchToShorts());

            fetchBtn.addEventListener('click', () => this.fetchChannelVideos());
            closeModalBtn.addEventListener('click', () => this.closeModal());
            copyBtn.addEventListener('click', () => this.copyTranscript());
            
            modal.addEventListener('click', (e) => {
              if (e.target === modal) {
                this.closeModal();
              }
            });

            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                this.closeModal();
              }
            });
          }

          switchToVideos() {
            console.log('Switching to videos view');
            this.currentView = 'videos';
            this.updateToggleButtons();
            this.renderCurrentView();
          }

          switchToShorts() {
            console.log('Switching to shorts view');
            this.currentView = 'shorts';
            this.updateToggleButtons();
            this.renderCurrentView();
          }

          updateToggleButtons() {
            document.querySelectorAll('.toggle-btn').forEach(btn => {
              btn.classList.remove('active');
            });
            
            if (this.currentView === 'videos') {
              document.getElementById('videosToggle').classList.add('active');
            } else {
              document.getElementById('shortsToggle').classList.add('active');
            }
          }

          renderCurrentView() {
            const container = document.getElementById('videosContainer');
            container.innerHTML = '';

            const videosToShow = this.currentView === 'videos' ? this.regularVideos : this.shorts;
            
            console.log('Rendering view:', this.currentView, 'with', videosToShow.length, 'items');
            console.log('regularVideos length:', this.regularVideos.length);
            console.log('shorts length:', this.shorts.length);
            console.log('videosToShow sample:', videosToShow.slice(0, 3).map(v => \`\${v.title.substring(0, 20)}... (\${v.type})\`));
            
            if (videosToShow.length > 0) {
              const videoGrid = document.createElement('div');
              videoGrid.className = 'video-grid';
              
              videosToShow.forEach(video => {
                const videoCard = this.createVideoCard(video);
                videoGrid.appendChild(videoCard);
              });
              
              container.appendChild(videoGrid);
            } else {
              const message = this.currentView === 'videos' ? 'No videos found.' : 'No shorts found.';
              container.innerHTML = \`<div class="error">\${message}</div>\`;
            }
          }

          async fetchChannelVideos() {
            const channelUrl = document.getElementById('channelUrl').value.trim();
            const videoCount = document.getElementById('videoCount').value;
            
            if (!channelUrl) {
              this.showError('Please enter a YouTube channel URL');
              return;
            }

            this.showLoading(true);
            this.clearError();
            this.clearVideos();

            try {
              const response = await fetch('/api/channel-videos', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  channelUrl: channelUrl,
                  maxResults: videoCount,
                  contentType: 'both'
                })
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch videos');
              }

              this.processVideoData(data.videos, data.counts);
            } catch (error) {
              console.error('Error:', error);
              this.showError(error.message || 'Failed to fetch channel videos');
            } finally {
              this.showLoading(false);
            }
          }

          processVideoData(videos, counts) {
            if (videos.length === 0) {
              const container = document.getElementById('videosContainer');
              container.innerHTML = '<div class="error">No videos found for this channel.</div>';
              return;
            }

            console.log('Processing video data:', videos.length, 'total videos');
            console.log('Raw video data sample:', videos.slice(0, 3));

            // Store all videos and separate them
            this.allVideos = videos;
            this.regularVideos = videos.filter(v => {
              console.log('Filtering video:', v.title?.substring(0, 30), 'type:', v.type);
              return v.type !== 'short';
            });
            this.shorts = videos.filter(v => v.type === 'short');

            console.log('Separated videos:', this.regularVideos.length, 'regular,', this.shorts.length, 'shorts');
            console.log('Current view:', this.currentView);
            console.log('Sample video types:', videos.slice(0, 5).map(v => \`\${v.title?.substring(0, 30)}... -> \${v.type}\`));

            // Update counts in toggle buttons - show simple counts
            document.getElementById('videosCount').textContent = this.regularVideos.length;
            document.getElementById('shortsCount').textContent = this.shorts.length;

            // Show toggle buttons
            document.getElementById('contentToggle').classList.remove('hidden');

            // Render current view
            this.renderCurrentView();
          }

          createVideoCard(video) {
            const card = document.createElement('div');
            const isShort = video.type === 'short';
            card.className = isShort ? 'video-card short-card' : 'video-card';

            const publishDate = new Date(video.publishedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });

            const decodedTitle = this.decodeHtml(video.title);
            const escapedTitle = this.escapeHtml(decodedTitle);
            const thumbnailUrl = this.getThumbnailUrl(video);
            
            card.innerHTML = \`
              <div class="video-thumbnail-container \${isShort ? 'short-thumbnail' : ''}">
                <img src="\${thumbnailUrl}" alt="\${escapedTitle}" class="video-thumbnail" 
                     onerror="this.src=this.src.replace('maxresdefault', 'hqdefault')">
              </div>
              <div class="video-info">
                <h3 class="video-title">\${escapedTitle}</h3>
                <p class="video-date">Published: \${publishDate}</p>
                <div class="video-actions">
                  <div class="action-row">
                    <button class="transcript-btn" onclick="event.stopPropagation(); app.fetchTranscript('\${video.id}', '\${this.escapeHtml(decodedTitle)}')">
                      Transcript
                    </button>
                    <button class="summary-btn" onclick="event.stopPropagation(); app.fetchSummary('\${video.id}', '\${this.escapeHtml(decodedTitle)}')">
                      Summary
                    </button>
                  </div>
                  <button class="view-btn" onclick="event.stopPropagation(); window.open('https://www.youtube.com/watch?v=\${video.id}', '_blank')">
                    View Video
                  </button>
                </div>
              </div>
            \`;

            // Make entire card clickable to open video
            card.addEventListener('click', () => {
              window.open(\`https://www.youtube.com/watch?v=\${video.id}\`, '_blank');
            });

            return card;
          }

          async fetchTranscript(videoId, title) {
            this.openModal(title);
            this.showTranscriptLoading(true);

            try {
              const response = await fetch('/api/transcript', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ videoId })
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch transcript');
              }

              this.displayTranscript(data.transcript);
            } catch (error) {
              console.error('Error fetching transcript:', error);
              this.displayTranscriptError(error.message || 'Failed to fetch transcript');
            } finally {
              this.showTranscriptLoading(false);
            }
          }

          openModal(title) {
            const modal = document.getElementById('transcriptModal');
            const modalTitle = document.getElementById('modalTitle');
            
            modalTitle.textContent = title;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
          }

          closeModal() {
            const modal = document.getElementById('transcriptModal');
            modal.classList.add('hidden');
            document.body.style.overflow = 'auto';
            
            const transcriptContent = document.getElementById('transcriptContent');
            transcriptContent.innerHTML = '';
          }

          displayTranscript(transcript) {
            const content = document.getElementById('transcriptContent');
            
            // Make sure content is visible
            content.classList.remove('hidden');
            
            if (!transcript || transcript.trim() === '') {
              content.innerHTML = '<p class="error">No transcript available for this video.</p>';
              return;
            }
            
            // Check if content appears to be markdown (contains # headers)
            if (transcript.includes('#') && transcript.includes('##')) {
              // Render as markdown-style content
              content.innerHTML = this.parseMarkdown(transcript);
            } else {
              // Better sentence splitting for regular transcripts
              const sentences = transcript
                .split(/(?<=[.!?])\\s+/)
                .filter(s => s.trim().length > 0)
                .map(s => s.trim());
              
              const formattedTranscript = sentences.map(sentence => 
                \`<p>\${this.escapeHtml(sentence)}</p>\`
              ).join('');

              content.innerHTML = formattedTranscript;
            }
          }

          parseMarkdown(markdown) {
            let html = markdown;
            
            // Convert headers
            html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
            
            // Convert bold text
            html = html.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
            
            // Convert bullet points
            html = html.replace(/^\\* (.*$)/gm, '<li>$1</li>');
            html = html.replace(/^(\\d+)\\. (.*$)/gm, '<li>$2</li>');
            
            // Wrap consecutive <li> elements in <ul> or <ol>
            html = html.replace(/(<li>.*?<\\/li>)(\\s*<li>.*?<\\/li>)*/gs, (match) => {
              return '<ul>' + match + '</ul>';
            });
            
            // Convert line breaks to paragraphs
            html = html.replace(/\\n\\n/g, '</p><p>');
            html = html.replace(/^(?!<[hul])/gm, '<p>');
            html = html.replace(/(?<!>)$/gm, '</p>');
            
            // Clean up empty paragraphs and fix formatting
            html = html.replace(/<p><\\/p>/g, '');
            html = html.replace(/<p>(<[hul])/g, '$1');
            html = html.replace(/(<\\/[hul]>)<\\/p>/g, '$1');
            
            return html;
          }

          displayTranscriptError(error) {
            const content = document.getElementById('transcriptContent');
            content.innerHTML = \`<div class="error">Error: \${this.escapeHtml(error)}</div>\`;
          }

          showTranscriptLoading(show) {
            const loading = document.getElementById('transcriptLoading');
            const content = document.getElementById('transcriptContent');
            
            if (show) {
              loading.classList.remove('hidden');
              content.classList.add('hidden');
            } else {
              loading.classList.add('hidden');
              content.classList.remove('hidden');
            }
          }

          showLoading(show) {
            const loading = document.getElementById('loading');
            loading.classList.toggle('hidden', !show);
          }

          showError(message) {
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
          }

          clearError() {
            const errorDiv = document.getElementById('error');
            errorDiv.classList.add('hidden');
          }

          clearVideos() {
            const container = document.getElementById('videosContainer');
            container.innerHTML = '';
            
            // Hide toggle buttons and reset data
            document.getElementById('contentToggle').classList.add('hidden');
            this.allVideos = [];
            this.regularVideos = [];
            this.shorts = [];
            this.currentView = 'videos';
            this.updateToggleButtons();
          }

          async fetchSummary(videoId, title) {
            this.openModal(\`\${title} - Summary\`);
            this.showTranscriptLoading(true);

            try {
              const response = await fetch('/api/summary', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ videoId })
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || 'Failed to generate summary');
              }

              this.displayTranscript(data.summary);
            } catch (error) {
              console.error('Error generating summary:', error);
              this.displayTranscriptError(error.message || 'Failed to generate summary');
            } finally {
              this.showTranscriptLoading(false);
            }
          }

          copyTranscript() {
            const transcriptContent = document.getElementById('transcriptContent');
            const copyBtn = document.getElementById('copyTranscript');
            
            if (!transcriptContent.textContent) {
              return;
            }
            
            navigator.clipboard.writeText(transcriptContent.textContent).then(() => {
              const originalText = copyBtn.textContent;
              copyBtn.textContent = 'Copied!';
              copyBtn.style.background = '#10b981';
              
              setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '#3b82f6';
              }, 2000);
            }).catch(err => {
              console.error('Failed to copy transcript:', err);
              // Fallback for older browsers
              try {
                const textArea = document.createElement('textarea');
                textArea.value = transcriptContent.textContent;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (successful) {
                  const originalText = copyBtn.textContent;
                  copyBtn.textContent = 'Copied!';
                  copyBtn.style.background = '#10b981';
                  
                  setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.style.background = '#3b82f6';
                  }, 2000);
                }
              } catch (fallbackError) {
                // Silent fail
              }
            });
          }

          getThumbnailUrl(video) {
            // For shorts, try to get a better quality thumbnail
            if (video.type === 'short') {
              // Use img.youtube.com for better quality and try maxresdefault first
              return \`https://img.youtube.com/vi/\${video.id}/maxresdefault.jpg\`;
            }
            
            // For regular videos, use maxresdefault for best quality
            return video.thumbnail.replace('hqdefault', 'maxresdefault').replace('i.ytimg.com', 'img.youtube.com');
          }

          escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          decodeHtml(html) {
            const txt = document.createElement('textarea');
            txt.innerHTML = html;
            return txt.value;
          }
        }
      ` }} />
    </>
  );
}