FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npm start -- --hostname 0.0.0.0 --port ${PORT:-3000}"]
