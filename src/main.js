const { invoke } = window.__TAURI__.core;

let promptEl;
let apiUrlEl;
let apiModelEl;
let apiKeyEl;
let statusMsgEl;
let submitBtn;

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
    const systemPrompt = "You are an assistant. Based on the user's input, extract event details. Output ONLY valid JSON (without codeblocks or markdown or any other wraps, just JSON). Required keys: \"title\" (string), \"description\" (string), \"start_time\" (ISO 8601 string, e.g., 2024-04-15T15:00:00Z), \"end_time\" (ISO 8601 string).";

    const requestBody = {
      model: apiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}, text: ${await response.text()}`);
    }

    const jsonRes = await response.json();
    let content = jsonRes.choices[0].message.content.trim();
    
    // Sometimes LLMs wrap JSON in markdown block even when told not to. Clean it up if so.
    if (content.startsWith("```json")) {
      content = content.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (content.startsWith("```")) {
      content = content.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    const eventData = JSON.parse(content);

    statusMsgEl.textContent = "Generating and opening ICS...";
    const result = await invoke("generate_ics", { 
      title: eventData.title,
      description: eventData.description,
      startTime: eventData.start_time,
      endTime: eventData.end_time
    });
    statusMsgEl.textContent = result;
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
