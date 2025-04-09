import Anthropic from "@anthropic-ai/sdk";
import { APIPromise } from "@anthropic-ai/sdk/core";
import { Stream } from "@anthropic-ai/sdk/streaming";
import { ResponseMetrics } from "./session";
import {
  formatTemplate,
  getTemplate,
  isObjectTemplate,
  ObjectTemplate,
} from "./template";

export interface ResolvedAPIResult {
  resolvedResponse: string | null | undefined;
  responseMetrics?: ResponseMetrics;
  toolUseBlocks?: Anthropic.Messages.ToolUseBlock[];
}

export type ResolvedReturnValue =
  | Stream<Anthropic.Messages.MessageStreamEvent>
  | Stream<Anthropic.Completions.Completion>
  | Anthropic.Messages.Message
  | Anthropic.Completions.Completion;

/** This function papers over the difference between streamed and unstreamed
 * responses. It splits the response into two parts:
 * 1. The return value, which is what the caller should return immediately (may
 *    be stream or raw result)
 * 2. A promise that resolves to the final (string) result. If the original
 *    response is streamed, this promise doesn't resolve until the stream is
 *    finished.
 */
export async function getResolvedStream(
  resultPromise: APIPromise<
    | Stream<Anthropic.Messages.MessageStreamEvent>
    | Stream<Anthropic.Completions.Completion>
    | Anthropic.Messages.Message
    | Anthropic.Completions.Completion
  >,
  stream: boolean | null | undefined,
  feedbackKey: string,
  isChat: boolean,
): Promise<{
  returnValue: ResolvedReturnValue;
  finalResultPromise: Promise<ResolvedAPIResult>;
}> {
  if (stream) {
    const chunkStream = (await resultPromise) as
      | Stream<Anthropic.Messages.MessageStreamEvent>
      | Stream<Anthropic.Completions.Completion>;
    const wrappedStream = new WrappedStream(
      chunkStream as Stream<any>,
      isChat,
      feedbackKey,
    );
    return {
      returnValue: wrappedStream,
      finalResultPromise: wrappedStream.finishPromise,
    };
    // TODO: deal with streamed completions
  }
  const staticResult = (await resultPromise) as
    | Anthropic.Messages.Message
    | Anthropic.Completions.Completion;

  if (!staticResult.libretto) {
    staticResult.libretto = {};
  }
  staticResult.libretto.feedbackKey = feedbackKey;

  if (isChat) {
    return {
      returnValue: await resultPromise,
      finalResultPromise: Promise.resolve(
        getStaticChatCompletion(staticResult as Anthropic.Messages.Message),
      ),
    };
  }

  // Completion style (pretty old API)
  return {
    returnValue: await resultPromise,
    finalResultPromise: Promise.resolve(
      getStaticCompletion(staticResult as Anthropic.Completions.Completion),
    ),
  };
}

type PromptString = string | string[] | number[] | number[][];

function getStaticChatCompletion(
  result: Anthropic.Messages.Message,
): ResolvedAPIResult {
  // grab the content from the first message
  if (!result.content) {
    return { resolvedResponse: null };
  }

  const responseMetrics: ResponseMetrics = {
    usage: result.usage,
    stop_reason: result.stop_reason,
  };

  // Get the text content
  const allTextContent = result.content.filter((msg) => {
    return msg.type === "text";
  });

  if (allTextContent?.length > 1) {
    console.warn(
      `Unexpected multiple text messages in chat response, resolving to the first one`,
    );
  }

  // Get all tool use
  const toolUseBlocks = result.content.filter((msg) => {
    return msg.type === "tool_use";
  });

  return {
    resolvedResponse: allTextContent[0]?.text,
    toolUseBlocks: toolUseBlocks ?? undefined,
    responseMetrics: { usage: result.usage, stop_reason: result.stop_reason },
  };
}

function getStaticCompletion(
  result: Anthropic.Completion | null,
): ResolvedAPIResult {
  if (!result) {
    return {
      resolvedResponse: null,
      responseMetrics: { usage: undefined, stop_reason: undefined },
    };
  }
  if (result.completion) {
    return {
      resolvedResponse: result.completion,
      responseMetrics: { stop_reason: result.stop_reason },
    };
  }
  return { resolvedResponse: undefined };
}
export function getResolvedMessages(
  messages:
    | Anthropic.Messages.MessageParam[]
    | ObjectTemplate<Anthropic.Messages.MessageParam[]>,
  params?: Record<string, any>,
) {
  if (isObjectTemplate(messages)) {
    if (!params) {
      throw new Error(`Template requires params, but none were provided`);
    }
    const resolvedMessages = formatTemplate(messages, params);
    return { messages: resolvedMessages, template: getTemplate(messages) };
  }
  return { messages, template: null };
}

export function getResolvedPrompt(
  s: PromptString | ObjectTemplate<string>,
  params?: Record<string, any>,
) {
  if (typeof s === "string") {
    return { prompt: s, template: null };
  }
  if (!s || Array.isArray(s)) {
    if (!s) {
      return { prompt: s, template: null };
    }
    if (typeof s[0] === "number") {
      console.warn(`Cannot use token numbers in prompt arrays`);
    }
    const str = s.join("");
    return { prompt: str, template: null };
  }
  if (!s) {
    return { prompt: s, template: null };
  }
  if (isObjectTemplate(s)) {
    if (!params) {
      throw new Error(`Template requires params, but none were provided`);
    }
    const resolvedPrompt = formatTemplate(s, params);
    return { prompt: resolvedPrompt, template: getTemplate(s) };
  }
  return { prompt: s, template: null };
}

class WrappedStream<
  T extends
    | Anthropic.Completions.Completion
    | Anthropic.Messages.MessageStreamEvent,
> extends Stream<T> {
  finishPromise: Promise<ResolvedAPIResult>;
  private resolveIterator!: (v: ResolvedAPIResult) => void;
  private accumulatedResult: string[] = [];
  private responseUsage: Anthropic.Messages.Usage | undefined;
  private finishReason:
    | Anthropic.Messages.Message["stop_reason"]
    | Anthropic.Messages.RawMessageDeltaEvent.Delta["stop_reason"]
    | Anthropic.Completions.Completion["stop_reason"]
    | undefined
    | null;
  isChat: boolean;
  feedbackKey: string;

  constructor(
    innerStream: Stream<T>,
    isChat: boolean | undefined,
    feedbacKey: string,
  ) {
    super((innerStream as any).iterator, innerStream.controller);
    this.isChat = !!isChat;
    this.finishPromise = new Promise((r) => (this.resolveIterator = r));
    this.feedbackKey = feedbacKey;
  }

  async *[Symbol.asyncIterator]() {
    // Turn iterator into an iterable
    const iter = super[Symbol.asyncIterator]();
    const iterable = { [Symbol.asyncIterator]: () => iter };
    try {
      for await (const item of iterable) {
        if (this.isChat) {
          const chatItem = item as Anthropic.Messages.MessageStreamEvent;
          if (!chatItem.libretto) {
            chatItem.libretto = {};
          }
          chatItem.libretto.feedbackKey = this.feedbackKey;
          if (chatItem.type === "content_block_delta") {
            this.accumulatedResult.push(
              chatItem.delta.type === "text_delta"
                ? chatItem.delta.text
                : chatItem.delta.partial_json,
            );
            // } else if (chatItem.choices[0].delta.function_call) {
            //   this.accumulatedResult.push(
            //     JSON.stringify(chatItem.choices[0].delta.function_call),
            //   );
          }
          if (chatItem.type === "message_delta" && chatItem.delta.stop_reason) {
            this.finishReason = chatItem.delta.stop_reason;
          }
          // TODO: get usage from streaming chat.
        } else {
          const completionItem = item as Anthropic.Completions.Completion;
          if (!completionItem.libretto) {
            completionItem.libretto = {};
          }
          completionItem.libretto.feedbackKey = this.feedbackKey;
          this.accumulatedResult.push(completionItem.completion);
          this.finishReason = completionItem.stop_reason;
        }
        yield item;
      }
    } finally {
      this.resolveIterator({
        resolvedResponse: this.accumulatedResult.join(""),
        responseMetrics: {
          usage: this.responseUsage,
          stop_reason: this.finishReason,
        },
      });
    }
  }
}
