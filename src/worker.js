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
      // Step 1: Immediately defer the interaction (this must be sent within ~3 seconds)
      const deferResponse = {
        type: 5, // Deferred Channel Message with Source → shows "thinking..." in Discord
      };

      // Return this RIGHT AWAY so Discord gets a response fast
      const initialResp = new Response(JSON.stringify(deferResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      // Step 2: Do the slow work in the background (async, fire-and-forget)
      (async () => {
        let patchUrl;
        try {
          // Extract needed info for patching later
          const applicationId = interaction.application_id;
          const token = interaction.token;
          patchUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;

          // Your existing logic starts here ↓
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
              "xtcai-discord-bot/1.0[](https://github.com/crazypergy/xctai)",
            Accept: "application/json",
          };

          const scryfallResp = await fetch(scryfallUrl, {
            headers: scryfallHeaders,
          });
          if (!scryfallResp.ok) {
            const errorText = await scryfallResp.text();
            throw new Error(
              `Card not found: ${cardName} - Scryfall error: ${errorText}`,
            );
          }

          const cardData = await scryfallResp.json();
          if (!cardData.oracle_text) {
            throw new Error(`No oracle text found for ${cardName}`);
          }

          // Fetch rulings (your existing code)
          let rulingsText = "";
          if (cardData.rulings_uri) {
            try {
              const rulingsResp = await fetch(cardData.rulings_uri, {
                headers: scryfallHeaders,
              });
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
              rulingsText += `\n\n[Error fetching rulings: ${e.message}]`;
            }
          }

          // Build input for Gemini (truncated if too long)
          let aiInput = `Card: ${cardName}\nText: ${cardData.oracle_text}`;
          if (rulingsText.length > 500) {
            aiInput += "\n\nRulings (truncated):" + rulingsText.slice(0, 500);
          } else {
            aiInput += rulingsText;
          }

          // Gemini call – update model & endpoint as discussed
          const modelName = env.GEMINI_MODEL || "gemini-2.5-flash"; // Confirmed working preview model
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.Gemini_API_Key}`;

          const geminiResp = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: aiInput }] }],
              generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                maxOutputTokens: 8192,
              },
            }),
          });

          let aiResponse = "";
          if (geminiResp.ok) {
            const geminiData = await geminiResp.json();
            if (geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
              aiResponse = geminiData.candidates[0].content.parts[0].text;
              if (aiResponse.length > 1500) {
                aiResponse = aiResponse.slice(0, 1500) + "...\n[Truncated]";
              }
            } else {
              aiResponse = "[No valid AI response received]";
            }
          } else {
            const errorText = await geminiResp.text();
            aiResponse = `[Gemini error ${geminiResp.status}]: ${errorText}`;
          }

          // Final content
          const finalContent = `**${cardData.name}**\n${cardData.oracle_text}${rulingsText}\n\n**AI Explanation:**\n${aiResponse}`;

          // Patch the deferred message with real content
          await fetch(patchUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: finalContent }),
          });
        } catch (e) {
          // Error fallback: patch with error message if possible
          const errorContent = `Error processing /explain: ${e.message || "Unknown issue"}`;
          if (patchUrl) {
            await fetch(patchUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: errorContent }),
            });
          }
          // Optional: log to console for Cloudflare logs
          console.error(e);
        }
      })();

      // Important: Return the defer response synchronously
      return initialResp;
    }
    // No fallback: do nothing for unhandled commands
  },
};
