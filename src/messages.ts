import _Anthropic from "@anthropic-ai/sdk";
import Core, { APIPromise } from "@anthropic-ai/sdk/core";
import { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/messages";
import { Stream } from "@anthropic-ai/sdk/streaming";
import crypto from "crypto";
import { LibrettoConfig, objectTemplate, send_event } from ".";
import { PiiRedactor } from "./pii";
import {
  getResolvedMessages,
  getResolvedPrompt,
  getResolvedStream,
} from "./resolvers";

function getResolvedSystemPrompt(
  system: _Anthropic.Messages.MessageCreateParams["system"],
  params?: Record<string, any>,
) {
  if (!system) {
    return undefined;
  }

  // if not a string, we need to create a string representation
  let systemToUse = system;
  if (Array.isArray(systemToUse)) {
    // Even if the call has objectTemplate around this array, we lose that
    // context by combining the strings, so re-wrap with objectTemplate
    systemToUse = objectTemplate(
      systemToUse.map((item) => item.text).join("\n"),
    );
  }

  // Need to resolve the system prompt
  return getResolvedPrompt(systemToUse, params);
}

export class LibrettoMessages extends _Anthropic.Messages {
  protected piiRedactor?: PiiRedactor;

  constructor(
    client: _Anthropic,
    protected config: LibrettoConfig,
  ) {
    super(client);

    if (config.redactPii) {
      this.piiRedactor = new PiiRedactor();
    }
  }

  override create(
    body: _Anthropic.Messages.MessageCreateParamsNonStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<_Anthropic.Messages.Message>;
  override create(
    body: _Anthropic.Messages.MessageCreateParamsStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<_Anthropic.Messages.MessageStreamEvent>>;
  override create(
    body: MessageCreateParamsBase,
    options?: Core.RequestOptions,
  ): APIPromise<
    Stream<_Anthropic.Messages.MessageStreamEvent> | _Anthropic.Messages.Message
  >;
  override create(
    body: _Anthropic.Messages.MessageCreateParams,
    options?: Core.RequestOptions,
  ):
    | APIPromise<_Anthropic.Messages.Message>
    | APIPromise<Stream<_Anthropic.Messages.MessageStreamEvent>> {
    return this._create(body, options) as
      | APIPromise<Stream<_Anthropic.Messages.MessageStreamEvent>>
      | APIPromise<_Anthropic.Messages.Message>;
  }

  private async _create(
    body: _Anthropic.Messages.MessageCreateParams,
    options?: Core.RequestOptions,
  ): Promise<
    _Anthropic.Messages.Message | Stream<_Anthropic.Messages.MessageStreamEvent>
  > {
    const now = Date.now();
    const { libretto, messages, system, stream, ...anthropicBody } = body;

    // Anthropic handles system seprately and outside of user/assistant messages,
    // so we need to resolve it differently
    const resolvedSystem = getResolvedSystemPrompt(
      system,
      libretto?.templateParams,
    );

    const { messages: resolvedMessages, template } = getResolvedMessages(
      messages,
      libretto?.templateParams,
    );

    const resultPromise = super.create(
      {
        ...anthropicBody,
        system: resolvedSystem?.prompt,
        messages: resolvedMessages,
        stream,
      },
      options,
    );

    const resolvedPromptTemplateName =
      libretto?.promptTemplateName ?? this.config.promptTemplateName;

    if (!resolvedPromptTemplateName && !this.config.allowUnnamedPrompts) {
      return resultPromise;
    }

    const feedbackKey = libretto?.feedbackKey ?? crypto.randomUUID();
    const { finalResultPromise, returnValue } = await getResolvedStream(
      resultPromise,
      stream,
      feedbackKey,
      true,
    );

    // note: not awaiting the result of this
    finalResultPromise.then(
      async ({ resolvedResponse, responseMetrics, toolUseBlocks }) => {
        const responseTime = Date.now() - now;
        let params = libretto?.templateParams ?? {};

        // Redact PII before recording the event
        if (this.piiRedactor) {
          try {
            resolvedResponse = this.piiRedactor.redact(resolvedResponse);
            params = this.piiRedactor.redact(params);
          } catch (err) {
            console.log("Failed to redact PII", err);
          }
        }

        // The Sytem message needs to be prepended to template if it exists
        const templateWithSystem: any[] = template?.map((item) => item) ?? [];
        if (templateWithSystem?.length && resolvedSystem) {
          const librettoSystemMsg = {
            role: "system",
            content: resolvedSystem.template ?? resolvedSystem.prompt,
          };
          templateWithSystem.unshift(librettoSystemMsg);
        }

        await send_event({
          responseTime,
          response: resolvedResponse,
          rawResponse: returnValue,
          toolCalls: toolUseBlocks,
          tools: body.tools,
          responseMetrics,
          params: params,
          apiKey:
            libretto?.apiKey ??
            this.config.apiKey ??
            process.env.LIBRETTO_API_KEY,
          promptTemplateChat:
            params?.promptTemplateChat ??
            templateWithSystem ??
            resolvedMessages,
          promptTemplateName: resolvedPromptTemplateName,
          apiName:
            libretto?.promptTemplateName ?? this.config.promptTemplateName,
          prompt: {},
          chatId: libretto?.chatId ?? this.config.chatId,
          chainId: libretto?.chainId ?? libretto?.parentEventId,
          context: libretto?.context,
          feedbackKey,
          modelParameters: {
            modelProvider: "anthropic",
            modelType: "chat",
            ...anthropicBody,
          },
        });
      },
    );

    return returnValue as
      | _Anthropic.Messages.Message
      | Stream<_Anthropic.Messages.MessageStreamEvent>;
  }
}
