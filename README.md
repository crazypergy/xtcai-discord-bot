# xtcai-discord-bot

A Discord bot inspired by the XCTAI app, focused on offering advanced card explanations and rulings for Magic: The Gathering (MTG), powered by AI.

## Features

- **Discord Integration:** Responds to slash commands and message events in Discord channels.
- **Explain Command (`/explain`):**
  - Returns details and rulings for specified MTG cards using the Scryfall API.
  - Summarizes card information and rulings.
  - Uses Gemini AI to provide a plain-language explanation of card rules or complex abilities.
  - Handles edge cases and returns descriptive errors if a card is not found or APIs fail.
- **Cloudflare Worker Support:** Designed to run both as a standard Discord.js bot and as a serverless Cloudflare Worker.
- **Secure and Robust:** Verifies Discord signatures for all incoming interaction requests, and gracefully handles errors or missing input.
- **Extensible:** The codebase offers simple extension points for new Discord commands and features.

## Intended Use

This bot is intended for MTG communities and Discord groups that want quick and insightful explanations for Magic cards, including up-to-date rules and AI-generated clarifications.

## Getting Started

### Prerequisites

- Node.js (for local Discord.js usage)
- A Discord bot token (see [Discord Developer Portal](https://discord.com/developers/applications))
- Optionally: A Cloudflare account (for Worker deployment)
- API access key for Gemini AI (Google's Generative Language API)

### Environment Variables

- `DISCORD_TOKEN` – Your Discord bot token (for local mode)
- `DISCORD_PUBLIC_KEY` – Your Discord application's public key (for Worker mode)
- `Gemini_API_Key` – Gemini AI API key (`https://ai.google.dev/`)
- `GEMINI_MODEL` (optional) – Specify a Gemini model; defaults to `gemini-2.5-flash`

### Installation and Local Running

1. Clone the repository:
   ```bash
   git clone https://github.com/crazypergy/xtcai-discord-bot.git
   cd xtcai-discord-bot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables (create a `.env` file with your keys).
4. Start the bot:
   ```bash
   node index.js
   ```

### Cloudflare Worker Deployment

1. Update your environment variables in the Cloudflare Workers dashboard with your Discord public key and Gemini API key.
2. Deploy the contents of `src/worker.js` and `src/verify.js` using the Cloudflare dashboard or via Wrangler.

## Usage

### Core Command

- `/explain card:Lightning Bolt`
  - Replace `Lightning Bolt` with any card name.
  - The bot will reply with the card's official text, relevant Scryfall rulings, and an AI-powered explanation.

### Example Interactions

- `/explain card:Counterspell`
- `/explain card:Necropotence`
- `/explain` (defaults to "Lightning Bolt")

## Contributing

Contributions, feature suggestions, and bug reports are welcome!

- Clone, branch, and submit pull requests.
- Please open issues for feature requests or bug reports.
- See the existing code structure for extension points, especially in `index.js` and `src/worker.js`.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgements

- [discord.js](https://discord.js.org/)
- [Scryfall API](https://scryfall.com/docs/api)
- [Google Gemini AI](https://ai.google.dev/)

## Issues

// xtcai-discord-bot Improvement Tasks
// Paste this list into worker.js or a TODO file and let Copilot help implement one by one

1. Implement proper Discord interaction deferral (type 5) for /explain command
   - Immediately return { type: 5 } response to avoid 3-second timeout
   - Move all slow work (Scryfall fetches + Gemini call) into an async IIFE
   - Use the interaction token to PATCH the @original webhook URL with final content
   - Add ctx.waitUntil() around the async block to keep the Worker alive on free plan

2. Add timeout + fallback for Gemini API call (25 seconds max)
   - Use AbortController + setTimeout to abort fetch after 25s
   - If timeout or error, set aiResponse to a fallback message like:
     "[Timeout after 25s] Gemini is slow right now – showing card text & rulings only."
   - Always include oracle_text + rulingsText in finalContent even if AI fails

3. Switch Gemini model to stable low-latency default
   - Change default model to "gemini-2.5-flash" (avoid preview models for now)
   - Use endpoint: https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent
   - Add optional env.GEMINI_MODEL override with clear fallback

4. Improve card name fallback logic
   - If no "card" option value is provided → default to "Lightning Bolt"
   - (Optional nice-to-have) Try to extract card name from interaction message content if available

5. Add more robust error messages in final patch
   - Distinguish between:
     - Card not found (404 from Scryfall)
     - Gemini API errors (e.g. 429 rate limit, 500 server error)
     - Timeout / abort
     - General fetch failures
   - Include helpful retry suggestion in error text

6. Shorten / truncate Gemini input more aggressively
   - Limit aiInput to oracle_text only if rulingsText > 300 chars
   - Or always truncate oracle_text to first 1500 chars
   - Goal: keep total prompt under ~2000–3000 tokens for faster response

7. Bump wrangler.toml compatibility_date
   - Set to a recent date (e.g. "2026-02-25" or later) to use latest runtime features

8. (Optional future) Add ephemeral option to /explain command
   - Add boolean option "private" (default false)
   - If true → use type: 6 + flags: 64 for private/ephemeral response

9. Add basic logging in Worker for debugging
   - console.log key steps (e.g. "Starting Scryfall fetch", "Gemini response received")
   - Log errors with JSON.stringify(e) if possible

10. Verify signature verification still works
    - Test with real Discord interaction (signature + timestamp + body concat)
    - Make sure hexToUint8Array handles uppercase/lowercase hex correctly

Start with #1 and #2 — these will fix the "still thinking..." hang on simple cards like Lightning Bolt.
