import { f, objectTemplate } from "../src";
import { Anthropic } from "../src/client";

async function main() {
  const anthropic = new Anthropic({
    // apiKey: process.env.ANTHROPIC_API_KEY
  });

  console.log("Testing Chat API with string system message...");
  const messages = await anthropic.messages.create({
    system: objectTemplate(
      "You are a {tone} chatbot, greet the person by name",
    ),
    messages: objectTemplate([{ role: "user", content: "{name}" }]),
    max_tokens: 1024,
    model: "claude-3-haiku-20240307",
    libretto: {
      promptTemplateName: "ts-anthropic-test-chat-str-system",
      templateParams: { tone: "irate", name: "John" },
    },
  });
  console.log("Chat API replied with: ", messages.content[0]);

  console.log("Testing Chat API with array system message...");
  const messages2 = await anthropic.messages.create({
    system: objectTemplate([
      {
        type: "text",
        text: "You are a {tone} chatbot, greet the person by name",
      },
      {
        type: "text",
        text: "Don't forget to say you're welcome at the end too!",
      },
    ]),
    messages: objectTemplate([{ role: "user", content: "{name}" }]),
    max_tokens: 1024,
    model: "claude-3-haiku-20240307",
    libretto: {
      promptTemplateName: "ts-anthropic-test-chat-arr-system",
      templateParams: { tone: "friendly", name: "John" },
    },
  });
  console.log("Chat API replied with: ", messages2.content[0]);

  console.log("Testing Completion API...");
  const completion = await anthropic.completions.create({
    prompt:
      f`\n\nHuman: Say hello and greet the person by their name: {name}\n\nAssistant:` as unknown as string,
    model: "claude-2.1",
    max_tokens_to_sample: 1024,
    libretto: {
      promptTemplateName: "ts-anthropic-test-completion",
      templateParams: { name: "Pacman" },
    },
  });

  console.log("Completion API replied with: ", completion);
}

main()
  .then(() => {
    console.log("Done.");
  })
  .catch((e) => {
    console.log("error: ", e);
  });
