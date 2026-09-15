FROM node:20-slim

# Install Chromium, Xvfb, fonts, and required native rendering dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libasound2 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DISPLAY=:99

WORKDIR /app

# Ensure persistent directory for Chrome profile
RUN mkdir -p /var/lib/sentient/chrome-profile && chown -R node:node /var/lib/sentient

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8080

# Wrapper script to run Xvfb and the Express API server
CMD ["sh", "-c", "Xvfb :99 -screen 0 1440x900x24 -ac & node server.js"]
