import { complete, createInference, type ChatRequest, type ChatChunk,
  type ChatDoneChunk, type DoneChunk, type Inference, type InferenceBackend,
  type InferenceRequest, type InferenceChunk, type InferenceChunkFor,
  type InferenceDoneFor, type SynthesizeRequest, type SynthesisChunk,
  type TranscribeRequest, type TranscriptionChunk, type TranscriptionMediaSource,
} from "../../src/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Methods = Assert<Equal<InferenceRequest["method"], "chat" | "transcribe" | "synthesize">>;
type ChatCompatibility = Assert<Equal<DoneChunk, ChatDoneChunk>>;
type Distributive = Assert<Equal<InferenceChunkFor<InferenceRequest>, InferenceChunk>>;
type DoneMapping = Assert<Equal<InferenceDoneFor<ChatRequest>, DoneChunk>>;

declare const ipa: Inference;
declare const anyRequest: InferenceRequest;
declare const backend: InferenceBackend;
const chat = { method: "chat", messages: [{ role: "user", content: "Hello" }] } satisfies ChatRequest;
const transcribe = { method: "transcribe", media: { data: new Blob([], { type: "audio/wav" }) } } satisfies TranscribeRequest;
const synthesize = { method: "synthesize", text: "Hello" } satisfies SynthesizeRequest;

const chatStream = ipa.request(chat);
const transcriptionStream = ipa.request(transcribe);
const synthesisStream = ipa.request(synthesize);
const unionStream = ipa.request(anyRequest);
type ChatInference = Assert<Equal<typeof chatStream, AsyncIterable<ChatChunk>>>;
type TranscriptionInference = Assert<Equal<typeof transcriptionStream, AsyncIterable<TranscriptionChunk>>>;
type SynthesisInference = Assert<Equal<typeof synthesisStream, AsyncIterable<SynthesisChunk>>>;
type UnionInference = Assert<Equal<typeof unionStream, AsyncIterable<InferenceChunk>>>;

const client = createInference();
const clientChat = client.request(chat);
const clientTranscription = client.request(transcribe);
const clientSynthesis = client.request(synthesize);
const clientUnion = client.request(anyRequest);
type ClientChat = Assert<Equal<typeof clientChat, AsyncIterable<ChatChunk>>>;
type ClientTranscription = Assert<Equal<typeof clientTranscription, AsyncIterable<TranscriptionChunk>>>;
type ClientSynthesis = Assert<Equal<typeof clientSynthesis, AsyncIterable<SynthesisChunk>>>;
type ClientUnion = Assert<Equal<typeof clientUnion, AsyncIterable<InferenceChunk>>>;

async function checkBackend() {
  const instance = await backend.create({});
  const stream = instance.request(transcribe);
  type BackendInference = Assert<Equal<typeof stream, AsyncIterable<TranscriptionChunk>>>;
}

async function chatCompatibility() {
  const done: DoneChunk = await complete(chat);
  const clientDone: ChatDoneChunk = await client.complete(chat);
  done.message;
  clientDone.message;
  await complete(chat, { request: async function* (request: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: "done", model: "test", message: request.messages[0]! };
  } });
  // @ts-expect-error complete stays chat-only
  await complete(transcribe);
  // @ts-expect-error client.complete stays chat-only
  await client.complete(synthesize);
  for await (const chunk of transcriptionStream) {
    if (chunk.type === "done") {
      chunk.transcript.text;
      // @ts-expect-error transcription is not chat
      chunk.message;
    }
  }
  for await (const chunk of synthesisStream) {
    if (chunk.type === "done") {
      chunk.audio.byteLength;
      // @ts-expect-error synthesis is not transcription
      chunk.transcript;
    }
  }
  for await (const chunk of unionStream) {
    if (chunk.type === "done") {
      // @ts-expect-error an all-method done must first be narrowed
      chunk.message;
      if ("message" in chunk) chunk.message.content;
      else if ("transcript" in chunk) chunk.transcript.text;
      else chunk.audio.byteLength;
    }
  }
}

// @ts-expect-error raw base64 requires a declared MIME type
const missingType: TranscriptionMediaSource = { data: "YQ==" };
// @ts-expect-error URL and data are mutually exclusive
const bothSources: TranscriptionMediaSource = { data: new Blob(), url: "https://example.com/a.wav" };
// @ts-expect-error synthesis only returns MP3
ipa.request({ method: "synthesize", text: "Hello", output: { mediaType: "audio/wav" } });
// @ts-expect-error pages do not choose voices
const pageVoice: SynthesizeRequest = { method: "synthesize", text: "Hello", voice: "a-provider-voice" };
// @ts-expect-error no method-named runtime function is added
ipa.transcribe(transcribe);
