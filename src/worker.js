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
    if (
      interaction.type === 2 &&
      interaction.data &&
      interaction.data.name === "explain"
    ) {
      // Search for the card name provided as an argument, or default to 'Lightning Bolt'
      let cardName = "Lightning Bolt";
      if (interaction.data.options && Array.isArray(interaction.data.options)) {
        const cardOption = interaction.data.options.find(
          (opt) => opt.name === "card",
        );
        if (cardOption && cardOption.value) {
          cardName = cardOption.value;
        }
      }
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
        // Fetch rulings
        let rulingsText = "";
        if (cardData.rulings_uri) {
          try {
            const rulingsResp = await fetch(cardData.rulings_uri, {
              headers: scryfallHeaders,
            });
            if (rulingsResp.ok) {
              const rulingsData = await rulingsResp.json();
              if (rulingsData.data && rulingsData.data.length > 0) {
                rulingsText = "\n\nRulings:";
                for (const ruling of rulingsData.data) {
                  rulingsText += `\n- (${ruling.published_at}) ${ruling.comment}`;
                }
              }
            }
          } catch (e) {
            rulingsText += `\n\n[Error fetching rulings: ${e && e.message ? e.message : e}]`;
          }
        }
        // Call Gemini AI
        // Free tier: limit input size and handle quota errors
        let aiInput = `Card: ${cardName}\nText: ${cardData.oracle_text}`;
        if (rulingsText.length > 500) {
          aiInput += "\n\nRulings: (truncated)" + rulingsText.slice(0, 500);
        } else {
          aiInput += rulingsText;
        }
        let aiResponse = "";
        try {
          // Use the correct Gemini API endpoint and model for free tier (v1, not v1beta)
          const geminiResp = await fetch(
            "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=" +
              env.Gemini_API_Key,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [{ text: aiInput }],
                  },
                ],
              }),
            },
          );
          if (geminiResp.ok) {
            const geminiData = await geminiResp.json();
            aiResponse =
              geminiData.candidates &&
              geminiData.candidates[0] &&
              geminiData.candidates[0].content &&
              geminiData.candidates[0].content.parts &&
              geminiData.candidates[0].content.parts[0].text
                ? geminiData.candidates[0].content.parts[0].text
                : "[No AI response]";
            if (aiResponse.length > 1500) {
              aiResponse =
                aiResponse.slice(0, 1500) +
                "...\n[Response truncated for free tier]";
            }
          } else {
            const errorText = await geminiResp.text();
            if (geminiResp.status === 429 || errorText.includes("quota")) {
              aiResponse =
                "[Gemini API quota exceeded or rate limited. Please try again later or upgrade your plan.]";
            } else {
              aiResponse = `[Gemini error: ${geminiResp.status}] ${errorText}`;
            }
          }
        } catch (e) {
          aiResponse = `[Gemini error: ${e && e.message ? e.message : e}]`;
        }
        return Response.json({
          type: 4,
          data: { content: aiResponse },
        });
      } catch (e) {
        return Response.json({
          type: 4,
          data: {
            content: `Error fetching card info: ${e && e.message ? e.message : e}`,
          },
        });
      }
    }
    // Fallback for other commands or missing data
    return new Response(null, { status: 204 }); // No Content
  },
};
