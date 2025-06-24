# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.11.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Install Python for youtube-transcript-api and yt-dlp
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y python3 python3-pip python3-venv && \
    pip3 install --break-system-packages youtube-transcript-api yt-dlp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install node modules
COPY package-lock.json package.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]