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
        }

        // Fetch rulings
        let rulingsText = "";
        if (cardData.rulings_uri) {
          try {
            const rulingsResp = await fetch(cardData.rulings_uri, { headers: scryfallHeaders });
            if (rulingsResp.ok) {
              const rulingsData = await rulingsResp.json();
              if (rulingsData.data && rulingsData.data.length > 0) {
                rulingsText = "\n\n**Rulings:**";
                for (const ruling of rulingsData.data) {
                  rulingsText += `\n- (${ruling.published_at}) ${ruling.comment}`;
                }
              }
            }
          } catch (e) {
            rulingsText += `\n\n[Error fetching rulings: ${e.message || String(e)}]`;
          }
        }

        // Prepare input for Gemini
        let aiInput = `You are an expert Magic: The Gathering rules explainer.\n` +
                      `Explain this card clearly, concisely and accurately for players of all levels.\n` +
                      `Start with a simple summary, then explain mechanics, interactions and any important rulings.\n\n` +
                      `Card name: ${cardData.name}\n` +
                      `Mana cost: ${cardData.mana_cost || "N/A"}\n` +
                      `Type: ${cardData.type_line}\n` +
                      `Oracle text: ${cardData.oracle_text}\n` +
                      (rulingsText ? rulingsText : "No additional rulings.");

        // Call Gemini AI (corrected endpoint + authentication)
        let aiResponse = "";
        try {
          const modelName = env.GEMINI_MODEL || "gemini-1.5-flash"; // or "gemini-1.5-flash-latest", "gemini-2.5-flash" etc.
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

          const geminiResp = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY,  // ← correct header authentication
            },
            body: JSON.stringify({
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

          if (!geminiResp.ok) {
            const errorText = await geminiResp.text();
            console.log("Gemini API error:", geminiResp.status, errorText);
            aiResponse = `⚠️ Gemini API error (HTTP ${geminiResp.status}): ${errorText.slice(0, 300)}`;
          } else {
            const geminiData = await geminiResp.json();
            const candidate = geminiData.candidates?.[0];
            if (candidate?.content?.parts?.[0]?.text) {
              aiResponse = candidate.content.parts[0].text.trim();
              if (aiResponse.length > 1800) {
                aiResponse = aiResponse.slice(0, 1800) + "\n\n… (response truncated)";
              }
            } else {
              console.log("Gemini invalid response structure:", JSON.stringify(geminiData));
              aiResponse = "[Gemini returned an unexpected response format]";
            }
          }
        } catch (e) {
          console.error("Gemini fetch failed:", e.message || String(e));
          aiResponse = `[Error connecting to Gemini: ${e.message || String(e)}]`;
        }

        // Final response to Discord
        const explanation = `**${cardData.name}** (${cardData.mana_cost || ""})\n` +
                           `${cardData.type_line}\n\n` +
                           `${cardData.oracle_text}${rulingsText}\n\n` +
                           `**AI Explanation:**\n${aiResponse || "No explanation could be generated at this time."}`;

        return Response.json({
          type: 4,
          data: {
            content: explanation.slice(0, 1990), // Discord message limit ~2000 chars
          },
        });
      } catch (e) {
        console.error("Command handler error:", e);
        return Response.json({
          type: 4,
          data: {
            content: `An error occurred while processing your request: ${e.message || String(e)}`,
          },
        });
      }
    }

    // Fallback for unhandled interactions
    return Response.json({
      type: 4,
      data: {
        content: "Sorry, I don't know how to handle that command yet.",
      },
    });
  },
};