const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineString} = require("firebase-functions/params");
const admin = require("firebase-admin");
const https = require("https");

admin.initializeApp();

const geminiApiKey = defineString("GEMINI_API_KEY");
const model = "gemini-2.5-pro";

// This function builds the correct prompt string based on the task
function getPrompt(task, data) {
  try {
    switch (task) {
      case "summarize":
        return `You are a real estate AI. Provide a detailed summary for this plot. Respond with only a valid JSON object. Plot: ${JSON.stringify(data.plot)} JSON format: { "pros": [], "cons": [], "verdict": "" }`;
      case "best_value":
        const estimatedPrice = data.plot.price * (0.9 + Math.random() * 0.2);
        return `You are a real estate AI. Analyze this plot's value. Respond with only a valid JSON object. Plot: ${JSON.stringify(data.plot)} AI Estimated Market Value is ${estimatedPrice}. JSON format: { "rating": "Excellent|Good|Fair|Overpriced", "analysis": "" }`;
      case "compare":
        return `You are a real estate AI. Compare these two plots. Respond with only a valid JSON object. Plot 1: ${JSON.stringify(data.plots[0])} Plot 2: ${JSON.stringify(data.plots[1])} JSON format: { "recommendation": "" }`;
      default:
        return null;
    }
  } catch (e) {
    console.error("Error creating prompt:", e);
    return null;
  }
}

exports.callGemini = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  const { task, ...data } = request.data;
  const prompt = getPrompt(task, data);

  if (!prompt) {
    throw new HttpsError("invalid-argument", "A valid 'task' is required or the data is malformed.");
  }

  return new Promise((resolve, reject) => {
    const apiKey = geminiApiKey.value();
    const requestBody = JSON.stringify({
      contents: [{parts: [{text: prompt}]}],
      safetySettings: [
        {category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE"},
        {category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE"},
        {category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE"},
        {category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE"},
      ],
    });

    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            const responseData = JSON.parse(responseBody);
            if (!responseData.candidates || responseData.candidates.length === 0) {
              console.error("API returned no candidates. Response:", responseBody);
              reject(new HttpsError("internal", "The AI model blocked the response."));
              return;
            }
            const text = responseData.candidates[0].content.parts[0].text;
            resolve({result: text});
          } else {
            console.error("API Error Response:", responseBody);
            reject(new HttpsError("internal", "The AI model returned an error."));
          }
        } catch (error) {
          console.error("Error parsing AI response:", error);
          reject(new HttpsError("internal", "Failed to parse the AI response."));
        }
      });
    });

    req.on("error", (error) => {
      console.error("Error calling Gemini API:", error);
      reject(new HttpsError("internal", "Failed to connect to the AI model."));
    });

    req.write(requestBody);
    req.end();
  });
});
