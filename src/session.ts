import Anthropic from "@anthropic-ai/sdk";
import { ResolvedAPIResult, ResolvedReturnValue } from "./resolvers";

function getUrl(apiName: string, environmentName: string): string {
  if (process.env[environmentName]) {
    return process.env[environmentName]!;
  }
  const prefix =
    process.env.LIBRETTO_API_PREFIX ?? "https://app.getlibretto.com/api";
  return `${prefix}/${apiName}`;
}

interface AnthropicMessagesParameters
  extends Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages"> {
  modelProvider: "anthropic";
  modelType: "chat";
}
interface AnthropicCompletionParameters
  extends Omit<
    Anthropic.Completions.CompletionCreateParamsNonStreaming,
    "prompt"
  > {
  modelProvider: "anthropic";
  modelType: "completion";
}
export type ModelParameters =
  | AnthropicMessagesParameters
  | AnthropicCompletionParameters;

/**
 *
 */
export interface EventMetadata {
  promptTemplateText?: string | null;
  promptTemplateTextId?: string;
  promptTemplateChat?: any[];
  promptTemplateName?: string;
  apiName?: string;
  apiKey?: string;
  chatId?: string;
  chainId?: string;
  modelParameters?: ModelParameters;
  feedbackKey?: string;
  context?: Record<string, any>;
  tools?: any[];
}

export type ResponseMetrics = {
  usage?: Anthropic.Messages.Usage | undefined;
  stop_reason:
    | Anthropic.Messages.Message["stop_reason"]
    | Anthropic.Completions.Completion["stop_reason"]
    | undefined
    | null;
};

export interface PromptEvent {
  params: Record<string, any>;
  /** Included after response */
  response?: string | null;
  /** Plain, raw result from OpenAI */
  rawResponse?: ResolvedReturnValue | null;
  /** Possible list of  */
  toolCalls?: ResolvedAPIResult["toolUseBlocks"] | null;
  /** Response time in ms */
  responseTime?: number;
  /** Included only if there is an error from Anthropic, or error in validation */
  responseErrors?: string[];
  responseMetrics?: ResponseMetrics;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  prompt: {}; //hack
}

export type Event = EventMetadata & PromptEvent;

export async function send_event(event: Event) {
  if (!event.apiKey) {
    console.warn(`No LIBRETTO_API_KEY provided, no event will be sent`);
    return;
  }

  const url = getUrl("event", "LIBRETTO_REPORTING_URL");
  const body = JSON.stringify(event);
  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    const responseJson = await extractJsonBody(response);
    if (!response.ok) {
      throw new Error(`Failed to send event: ${JSON.stringify(responseJson)}`);
    }
    return responseJson;
  } catch (e) {
    console.error("Failed to send event to libretto: ", e);
  }
}
async function extractJsonBody(response: Response) {
  try {
    const responseJson = await response.json();
    return responseJson;
  } catch (e) {
    throw new Error(
      `Unparseable response: ${response.status} ${response.statusText} ${e}`,
    );
  }
}

export interface Feedback {
  /** The feedback_key that was passed to the `event` API. */
  feedbackKey?: string;
  /* A rating from 0 to 1 on the quality of the prompt response */
  rating?: number;
  /**
   * A better response than what the prompt responded with. (e.g. a correction
   * from a user)
   */
  betterResponse?: string;

  apiKey?: string;
}

/** Send feedback to the  */
export async function sendFeedback(body: Feedback) {
  if (!body.feedbackKey) {
    console.warn("Could not send feedback to Libretto: missing feedback key");
    return;
  }

  body.apiKey = body.apiKey ?? process.env.LIBRETTO_API_KEY;
  if (!body.apiKey) {
    console.warn("Could not send feedback to Libretto: missing API key");
    return;
  }

  // the endpoint expects snake_case variables
  const snakeCaseBody = Object.fromEntries(
    Object.entries(body).map(([k, v]) => {
      if (k === "feedbackKey") return ["feedback_key", v];
      if (k === "betterResponse") return ["better_response", v];
      return [k, v];
    }),
  );

  const url = getUrl("feedback", "LIBRETTO_FEEDBACK_URL");
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(snakeCaseBody),
    headers: { "Content-Type": "application/json" },
  });
  const responseJson = await extractJsonBody(response);
  if (!response.ok) {
    throw new Error(`Failed to send feedback: ${JSON.stringify(responseJson)}`);
  }

  return responseJson;
}

export interface UpdateChainParams {
  id: string;
  result?: string | null;
  apiKey?: string;
}

export async function updateChain(body: UpdateChainParams) {
  if (!body.id) {
    console.warn("[Libretto] Could not update chain: missing id");
    return;
  }

  body.apiKey = body.apiKey ?? process.env.LIBRETTO_API_KEY;
  if (!body.apiKey) {
    console.warn("[Libretto] Could not update chain: missing API key");
    return;
  }

  const url = getUrl("v1/updateChain", "LIBRETTO_UPDATE_CHAIN_URL");
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const responseJson = await extractJsonBody(response);
  if (!response.ok) {
    throw new Error(
      `[Libretto] Failed to update chain: ${JSON.stringify(responseJson)}`,
    );
  }

  return responseJson;
}
