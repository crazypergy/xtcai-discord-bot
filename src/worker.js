// Basic Cloudflare Worker for Discord Interactions (slash commands)
// XTCAI - eXplain The Card AI (Magic: The Gathering card explainer)

import { verifySignature } from "./verify.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Discord signature verification
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const publicKey = env.DISCORD_PUBLIC_KEY;
    const body = await request.text();

    if (!signature || !timestamp || !publicKey) {
      return new Response("Missing signature headers", { status: 401 });
    }

    const isValid = await verifySignature(publicKey, signature, timestamp, body);
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    // Ping-pong for Discord's initial verification
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // Handle /explain command
    if (
      interaction.type === 2 &&
      interaction.data &&
      interaction.data.name === "explain"
    ) {
      try {
        // Get card name from option (default to 'Lightning Bolt' for testing)
        let cardName = "Lightning Bolt";
        if (interaction.data.options && Array.isArray(interaction.data.options)) {
          const cardOption = interaction.data.options.find((opt) => opt.name === "card");
          if (cardOption && cardOption.value) {
            cardName = cardOption.value;
          }
        }

        const scryfallUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
        const scryfallHeaders = {
          "User-Agent": "xtcai-discord-bot/1.0 (https://github.com/crazypergy/xtcai-discord-bot)",
          Accept: "application/json",
        };

        const scryfallResp = await fetch(scryfallUrl, { headers: scryfallHeaders });
        const debugInfo = `Scryfall URL: ${scryfallUrl}\nStatus: ${scryfallResp.status}`;

        if (!scryfallResp.ok) {
          const errorText = await scryfallResp.text();
          return Response.json({
            type: 4,
            data: {
              content: `Card not found: ${cardName}\n${debugInfo}\nScryfall error: ${errorText}`,
            },
          });
        }

        const cardData = await scryfallResp.json();

        if (!cardData.oracle_text) {
          return Response.json({
            type: 4,
            data: {
              content: `No text box found for this card.\n${debugInfo}\nScryfall data: ${JSON.stringify(cardData, null, 2)}`,
            },
          });