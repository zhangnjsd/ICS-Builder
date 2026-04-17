const { invoke } = window.__TAURI__.core;

let promptEl;
let apiUrlEl;
let apiModelEl;
let apiKeyEl;
let statusMsgEl;
let submitBtn;

function buildDeepseekFallbackUrls(url) {
  const trimmed = url.trim();
  const urls = [trimmed];

  if (/api\.deepseek\.com/i.test(trimmed)) {
    if (/\/v1\/chat\/completions\/?$/i.test(trimmed)) {
      urls.push(trimmed.replace(/\/v1\/chat\/completions\/?$/i, "/chat/completions"));
    } else if (/\/chat\/completions\/?$/i.test(trimmed)) {
      urls.push(trimmed.replace(/\/chat\/completions\/?$/i, "/v1/chat/completions"));
    } else if (!/\/v1\//i.test(trimmed)) {
      urls.push(trimmed.replace(/\/?$/, "/chat/completions"));
      urls.push(trimmed.replace(/\/?$/, "/v1/chat/completions"));
    }
  }

  return [...new Set(urls)];
}

async function generateIcs() {
  const prompt = promptEl.value;
  const apiKey = apiKeyEl.value;
  const apiUrl = apiUrlEl.value || apiUrlEl.placeholder;
  const apiModel = apiModelEl.value || apiModelEl.placeholder;

  if (!prompt || !apiKey) {
    statusMsgEl.textContent = "Please provide an API key and event description.";
    return;
  }

  statusMsgEl.textContent = "Calling LLM...";
  submitBtn.disabled = true;

  try {
    const systemPrompt =
      `You are an assistant. Based on the user's input, extract one or more event details.
Output ONLY a JSON array of event objects (without codeblocks or markdown or any other wraps, just JSON). 
Each object must have:
- "title" (string)
- "description" (string)
- "start_time" (ISO 8601 string, e.g., 2024-04-15T15:00:00)
- "timezone" (string, e.g., "Asia/Shanghai")
- "end_time" (ISO 8601 string)
Optional keys include:
- "location" (string)
- "rrule" (string, standard RRULE for recurrence, e.g., "FREQ=WEEKLY;COUNT=5" or "FREQ=DAILY;UNTIL=20261231T000000Z")
- "reminder_minutes" (integer, minutes before start time to trigger alarm)
- "is_busy" (boolean, true for OPAQUE/Busy, false for TRANSPARENT/Free)
- "privacy" (string, one of "PUBLIC", "PRIVATE", "CONFIDENTIAL")`;

    const requestBody = {
      model: apiModel,
      messages: [
        { role: "system", content: systemPrompt + "\nTime now: " + new Date().toISOString() },
        { role: "user", content: prompt }
      ],
      stream: false
    };

    // Direct frontend request (no backend proxy)
    const candidateUrls = buildDeepseekFallbackUrls(apiUrl);
    let response = null;
    let responseText = "";
    let usedUrl = candidateUrls[0];
    let lastNetworkError = null;

    for (let i = 0; i < candidateUrls.length; i += 1) {
      const currentUrl = candidateUrls[i];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      usedUrl = currentUrl;

      try {
        response = await fetch(currentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        responseText = await response.text();

        // Try next fallback endpoint only for 404.
        if (response.status === 404 && i < candidateUrls.length - 1) {
          continue;
        }

        break;
      } catch (e) {
        if (e.name === "AbortError") {
          throw new Error("LLM request timed out after 300s.");
        }
        lastNetworkError = e;
        if (i === candidateUrls.length - 1) {
          throw new Error(
            "Network error while calling LLM."
          );
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!response) {
      throw new Error(lastNetworkError?.message || "Request failed before receiving response.");
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `HTTP 404 from ${usedUrl}.`
        );
      }
      throw new Error(`HTTP ${response.status} from ${usedUrl}: ${responseText.slice(0, 300)}`);
    }

    const jsonRes = JSON.parse(responseText);

    if (jsonRes.error) {
      throw new Error(jsonRes.error.message || JSON.stringify(jsonRes.error));
    }

    let content = "";
    if (jsonRes.choices && jsonRes.choices.length > 0 && jsonRes.choices[0].message) {
      content = jsonRes.choices[0].message.content.trim();
    } else if (jsonRes.response) {
      content = jsonRes.response.trim();
    } else {
      throw new Error("Unrecognized response format from LLM: " + responseText.substring(0, 200));
    }

    // Cleanup code blocks
    if (content.startsWith("```json")) {
      content = content.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (content.startsWith("```")) {
      content = content.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    let eventData = JSON.parse(content);
    if (!Array.isArray(eventData)) {
      eventData = [eventData]; // ensure array
    }

    statusMsgEl.textContent = `Generating and opening ${eventData.length} event(s) ICS...`;

    const filePath = await invoke("generate_ics", {
      events: eventData
    });

    statusMsgEl.textContent = `Generated ${eventData.length} event(s) ICS at ${filePath}! Requesting Android calendar to open...`;
  } catch (error) {
    statusMsgEl.textContent = `Error: ${error.message || error}`;
  } finally {
    submitBtn.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  promptEl = document.querySelector("#prompt");
  apiUrlEl = document.querySelector("#api-url");
  apiModelEl = document.querySelector("#api-model");
  apiKeyEl = document.querySelector("#api-key");
  statusMsgEl = document.querySelector("#status-msg");
  submitBtn = document.querySelector("#submit-btn");

  const savedUrl = localStorage.getItem("apiUrl");
  const savedModel = localStorage.getItem("apiModel");
  const savedKey = localStorage.getItem("apiKey");

  if (savedUrl) apiUrlEl.value = savedUrl;
  if (savedModel) apiModelEl.value = savedModel;
  if (savedKey) apiKeyEl.value = savedKey;

  document.querySelector("#ics-form").addEventListener("submit", (e) => {
    e.preventDefault();
    localStorage.setItem("apiUrl", apiUrlEl.value);
    localStorage.setItem("apiModel", apiModelEl.value);
    localStorage.setItem("apiKey", apiKeyEl.value);
    generateIcs();
  });
});
