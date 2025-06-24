# YouTube Transcript Fetcher

A modern web application to fetch and display transcripts from recent YouTube channel videos.

## Features

- Clean, modern UI with responsive design
- Fetch recent videos from any YouTube channel
- View full transcripts of videos in a modal
- Configurable number of videos to fetch (5-50)
- Error handling and loading states

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Get a YouTube Data API v3 key:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable YouTube Data API v3
   - Create credentials (API key)

3. Set your API key:
   ```bash
   export YOUTUBE_API_KEY=your_api_key_here
   ```
   Or create a `.env` file with:
   ```
   YOUTUBE_API_KEY=your_api_key_here
   ```

4. Start the server:
   ```bash
   npm start
   ```
   Or for development:
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000 in your browser

## Usage

1. Enter a YouTube channel URL (supports @handle, /c/, /channel/, /user/ formats)
2. Select how many recent videos to fetch
3. Click "Fetch Videos" to load the channel's recent videos
4. Click "View Transcript" on any video to see its full transcript

## API Endpoints

- `POST /api/channel-videos` - Fetch recent videos from a channel
- `POST /api/transcript` - Get transcript for a specific video

## Dependencies

- Express.js - Web server
- googleapis - YouTube Data API integration
- youtube-transcript - Transcript fetching
- cors - Cross-origin requests