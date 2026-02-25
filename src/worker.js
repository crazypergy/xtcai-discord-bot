// src/worker.js
// XTCAI - eXplain The Card AI (Magic: The Gathering card explainer)
// Cloudflare Worker version with Discord interaction deferral

import { verifySignature } from "./verify.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Verify Discord request signature
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

    // Discord ping verification
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // Handle /explain slash command
    if (interaction.type === 2 && interaction.data?.name === "explain") {
      // 1. Immediately defer the interaction (shows "thinking..." instantly)
      const deferResponse = { type: 5 }; // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

      const initialResponse = Response.json(deferResponse, {
        headers: { "Content-Type": "application/json" },
      });

      // 2. Run slow work in background (protected by ctx.waitUntil)
      ctx.waitUntil(
        (async () => {
          let patchUrl = null;
          try {
            const applicationId = interaction.application_id;
            const token = interaction.token;
            patchUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;

            // Get card name (option first, fallback to default)
            let cardName = "Lightning Bolt";
            if (interaction.data.options?.length) {
              const cardOption = interaction.data.options.find(
                (opt) => opt.name === "card",
              );
              if (cardOption?.value?.trim()) {
                cardName = cardOption.value.trim();
              }
            }

            // Scryfall lookup
            const scryfallUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
            const headers = {
              "User-Agent":
                "xtcai-discord-bot/1.0 (contact: https://github.com/crazypergy/xtcai-discord-bot)",
              Accept: "application/json",
            };

            const scryfallResp = await fetch(scryfallUrl, { headers });
            if (!scryfallResp.ok) {
              const errText = await scryfallResp.text();
              throw new Error(
                `Scryfall error ${scryfallResp.status}: ${errText}`,
              );
            }

            const cardData = await scryfallResp.json();
            if (!cardData?.oracle_text) {
              throw new Error("No oracle text found for this card.");
            }

            // Fetch rulings
            let rulingsText = "";
            if (cardData.rulings_uri) {
              try {
                const rulingsResp = await fetch(cardData.rulings_uri, {
                  headers,
                });
                if (rulingsResp.ok) {
                  const rulings = await rulingsResp.json();
                  if (rulings.data?.length > 0) {
                    rulingsText = "\n\n**Rulings:**";
                    rulings.data.forEach((r) => {
                      rulingsText += `\n- (${r.published_at}) ${r.comment}`;
                    });
                  }
                }
              } catch (e) {
                rulingsText += `\n\n[Rulings fetch failed: ${e.message}]`;
              }
            }

            // Prepare prompt for Gemini
            let prompt =
              `You are a Magic: The Gathering rules expert.\n` +
              `Explain this card clearly and concisely for all player levels. Explain in no more than two paragraphs.\n` +
              `Card: ${cardData.name}\n` +
              `Mana cost: ${cardData.mana_cost || "—"}\n` +
              `Type: ${cardData.type_line}\n` +
              `Oracle text: ${cardData.oracle_text}\n` +
              (rulingsText ? rulingsText : "No additional rulings.");

            if (prompt.length > 12000) {
              prompt = prompt.slice(0, 12000) + "... (truncated)";
            }

            // Gemini call with timeout
            const TIMEOUT_MS = 22000;
            let aiResponse =
              "[AI explanation timed out – card basics shown below]";

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

            try {
              const model = env.GEMINI_MODEL || "gemini-2.5-flash";
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.Gemini_API_Key}`;

              const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: prompt }] }],
                  generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    maxOutputTokens: 2048,
                  },
                }),
                signal: controller.signal,
              });

              clearTimeout(timeoutId);

              if (resp.ok) {
                const data = await resp.json();
                aiResponse =
                  data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
                  "[No explanation received]";
                if (aiResponse.length > 1800) {
                  aiResponse = aiResponse.slice(0, 1800) + "\n… (truncated)";
                }
              } else {
                aiResponse = `[Gemini API error ${resp.status}]`;
              }
            } catch (err) {
              if (err.name === "AbortError") {
                aiResponse = "[Timeout after 22s] – Gemini is slow right now";
              } else {
                aiResponse = `[Gemini fetch error: ${err.message || "unknown"}]`;
              }
            }

            // Build final message
            let content =
              `**${cardData.name}** ${cardData.mana_cost || ""}\n` +
              `${cardData.type_line}\n\n` +
              `${cardData.oracle_text}${rulingsText}\n\n` +
              `**AI Explanation:**\n${aiResponse}`;

            if (content.length > 1990) {
              content = content.slice(0, 1990) + "\n… (message truncated)";
            }

            // Send final response via webhook
            await fetch(patchUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content }),
            });
          } catch (err) {
            const errorContent = `Sorry, an error occurred:\n${err.message || "Unknown error"}\n\nTry again or check the card name.`;
            if (patchUrl) {
              await fetch(patchUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: errorContent }),
              }).catch(() => {}); // best effort
            }
          }
        })().catch((err) => console.error("Background task failed:", err)),
      );

      return initialResponse;
    }

    // Fallback for unknown commands
    return Response.json({
      type: 4,
      data: { content: "Sorry, I don't support that command yet." },
    });
  },
};
