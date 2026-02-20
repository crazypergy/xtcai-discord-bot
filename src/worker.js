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
        const options = interaction.data.options;
        if (!options || options.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "Explain what? (Please provide a card name)" },
          });
        }
        const cardName = options[0].value;
        // Query Scryfall API for card
        const scryfallUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
        try {
          const scryfallResp = await fetch(scryfallUrl);
          if (!scryfallResp.ok) {
            return Response.json({
              type: 4,
              data: { content: `Card not found: ${cardName}` },
            });
          }
          const cardData = await scryfallResp.json();
          const textBox =
            cardData.oracle_text || "No text box found for this card.";
          return Response.json({
            type: 4,
            data: { content: textBox },
          });
        } catch (e) {
          return Response.json({
            type: 4,
            data: { content: `Error fetching card: ${cardName}` },
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
