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
      try {
        // Search for the card name provided as an argument, or default to 'Lightning Bolt'
        let cardName = "Lightning Bolt";
        if (
          interaction.data.options &&
          Array.isArray(interaction.data.options)
        ) {
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
          const modelName = env.GEMINI_MODEL || "gemini-3-flash"; // default to free-tier gemini-2.5-flash
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${
            env.Gemini_API_Key
          }`;
          const geminiResp = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              // Mirror the client example: provide contents and generationConfig
              contents: [
                {
                  role: "user",
                  parts: [{ text: aiInput }],
                },
              ],
              generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                maxOutputTokens: 8192,
              },
            }),
          });
          if (geminiResp.ok) {
            const geminiData = await geminiResp.json();
            if (
              geminiData.candidates &&
              geminiData.candidates[0] &&
              geminiData.candidates[0].content &&
              geminiData.candidates[0].content.parts &&
              geminiData.candidates[0].content.parts[0].text
            ) {
              aiResponse = geminiData.candidates[0].content.parts[0].text;
              if (aiResponse.length > 1500) {
                aiResponse =
                  aiResponse.slice(0, 1500) +
                  "...\n[Response truncated for free tier]";
              }
            } else {
              aiResponse = `[No AI response. Full Gemini API response: ${JSON.stringify(geminiData)}]`;
            }
          } else {
            const errorText = await geminiResp.text();
            aiResponse = `[Gemini error: ${geminiResp.status}] ${errorText}`;
          }
        } catch (e) {
          aiResponse = `[Error calling Gemini API: ${e && e.message ? e.message : e}]`;
        }
        // Respond with the AI explanation
        return Response.json({
          type: 4,
          data: {
            content: `**${cardData.name}**\n${cardData.oracle_text}${rulingsText}\n\n**AI Explanation:**\n${aiResponse}`,
          },
        });
      } catch (e) {
        return Response.json({
          type: 4,
          data: {
            content: `An error occurred while processing your request: ${e && e.message ? e.message : e}`,
          },
        });
      }
    }
    // No fallback: do nothing for unhandled commands
  },
};
