import { objectTemplate } from "../src";
import { Anthropic } from "../src/client";

async function main() {
  const anthropic = new Anthropic({
    // apiKey: process.env.ANTHROPIC_API_KEY
  });

  console.log("Testing Chat API with Tools...");
  const completion = await anthropic.messages.create({
    messages: objectTemplate([
      { role: "user", content: "What's the weather like in {location}?" },
    ]),
    model: "claude-3-7-sonnet-latest",
    max_tokens: 1024,
    temperature: 1,
    tools: [
      {
        name: "get_current_weather",
        input_schema: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city and state, e.g. San Francisco, CA",
            },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      },
    ],
    libretto: {
      promptTemplateName: "anthropic-tools-weather-report",
      templateParams: { location: "Chicago" },
    },
  });
  console.log("Chat API with tools replied with: ", completion);
}

main()
  .then(() => {
    console.log("Done.");
  })
  .catch((e) => {
    console.log("error: ", e);
  });
