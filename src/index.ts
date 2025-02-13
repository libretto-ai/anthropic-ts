export { Anthropic } from "./client";
export { Event, Feedback, send_event, sendFeedback } from "./session";
export { f, objectTemplate } from "./template";

export type LibrettoConfig = {
  apiKey?: string;
  promptTemplateName?: string;
  allowUnnamedPrompts?: boolean;
  redactPii?: boolean;
  chatId?: string;
};

export type LibrettoCreateParams = {
  apiKey?: string;
  promptTemplateName?: string;
  templateParams?: Record<string, any>;
  chatId?: string;
  chainId?: string;
  feedbackKey?: string;
  context?: Record<string, any>;

  /** @deprecated Use chainId instead */
  parentEventId?: string;
};

//todo: should we mark these as readonly?
type LibrettoCompletion = {
  feedbackKey?: string;
  context?: Record<string, any>;
};

export type LibrettoRunCreateParams = {
  apiKey?: string;
  promptTemplateName?: string;
};

declare module "@anthropic-ai/sdk" {
  interface ClientOptions {
    libretto?: LibrettoConfig;
  }
}

declare module "@anthropic-ai/sdk/resources/messages" {
  interface MessageCreateParamsBase {
    libretto?: LibrettoCreateParams;
  }

  interface Message {
    libretto?: LibrettoCompletion;
  }

  interface RawMessageStartEvent {
    libretto?: LibrettoCompletion;
  }
  interface RawMessageDeltaEvent {
    libretto?: LibrettoCompletion;
  }
  interface RawMessageStopEvent {
    libretto?: LibrettoCompletion;
  }
  interface RawContentBlockStartEvent {
    libretto?: LibrettoCompletion;
  }

  interface RawContentBlockDeltaEvent {
    libretto?: LibrettoCompletion;
  }
  interface RawContentBlockStopEvent {
    libretto?: LibrettoCompletion;
  }
}

declare module "@anthropic-ai/sdk/resources/completions" {
  interface CompletionCreateParamsBase {
    libretto?: LibrettoCreateParams;
  }

  interface Completion {
    libretto?: LibrettoCompletion;
  }
}
