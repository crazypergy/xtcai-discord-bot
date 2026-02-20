// Basic Cloudflare Worker for Discord Interactions (slash commands)
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

    const isValid = await verifySignature(
      publicKey,
      signature,
      timestamp,
      body,
    );
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    // Ping-pong for Discord's initial verification
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // Respond to /explain command with Scryfall API integration
    if (interaction.type === 2) {
      if (interaction.data && interaction.data.name === "explain") {
        // Always search for 'Lightning Bolt'
        const cardName = "Lightning Bolt";
        const scryfallUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
        const scryfallHeaders = {
          "User-Agent":
            "xtcai-discord-bot/1.0 (https://github.com/crazypergy/xctai)",
          Accept: "application/json",
        };
        try {
          const scryfallResp = await fetch(scryfallUrl, {
            headers: scryfallHeaders,
          });
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
                content: `No text box found for this card.\n${debugInfo}\nScryfall data: ${JSON.stringify(cardData)}`,
              },
            });
          }
          return Response.json({
            type: 4,
            data: { content: cardData.oracle_text },
          });
        } catch (e) {
          return Response.json({
            type: 4,
            data: {
              content: `Error fetching card: ${cardName}\n${e && e.message ? e.message : e}`,
            },
          });
        }
      } else {
        return Response.json({
          type: 4,
          data: {
            content: "Hello from XCTAI Discord Worker!",
          },
        });
      }
    }

    return new Response("Unhandled interaction", { status: 400 });
  },
};
