# amazon-influencer-finder

Local Next.js workspace for discovering Amazon Influencer / Storefront pages from keywords, extracting only public social links, and syncing results to Google Sheets.

## Current status

- Project scaffolded with Next.js + TypeScript + App Router
- Basic dashboard shell added at `/`
- API route placeholders added for health checks and run tracking
- Environment variable template added at `.env.local.example`
- Build and lint are passing

## What happens next

1. Add a persistent local job store
2. Wire keyword submission to a real run creation flow
3. Add SerpAPI search for Amazon storefront discovery
4. Add Playwright scraping with blocked detection
5. Add Google Sheets write support
6. Connect the UI to live run status and results

## Run locally

```bash
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Then open `http://localhost:3000`.

## Check the build

```bash
npm run lint
npm run build
```
