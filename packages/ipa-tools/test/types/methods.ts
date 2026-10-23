import { complete, createInference, type ChatRequest, type ChatChunk,
  type ChatDoneChunk, type DoneChunk, type Inference, type InferenceBackend,
  type InferenceRequest, type InferenceChunk, type InferenceChunkFor,
  type InferenceDoneFor, type SynthesizeRequest, type SynthesisChunk,
  type TranscribeRequest, type TranscriptionChunk, type TranscriptionMediaSource,
  type DecideRequest, type DecisionChunk, type DecisionDoneChunk,
  type DecisionAnswer, type DecisionState,
} from "../../src/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Methods = Assert<Equal<InferenceRequest["method"], "chat" | "decide" | "transcribe" | "synthesize">>;
type ChatCompatibility = Assert<Equal<DoneChunk, ChatDoneChunk>>;
type Distributive = Assert<Equal<InferenceChunkFor<InferenceRequest>, InferenceChunk>>;
type DoneMapping = Assert<Equal<InferenceDoneFor<ChatRequest>, DoneChunk>>;
type DecisionDoneMapping = Assert<Equal<InferenceDoneFor<DecideRequest>, DecisionDoneChunk>>;

declare const ipa: Inference;
declare const anyRequest: InferenceRequest;
declare const backend: InferenceBackend;
const chat = { method: "chat", messages: [{ role: "user", content: "Hello" }] } satisfies ChatRequest;
const transcribe = { method: "transcribe", media: { data: new Blob([], { type: "audio/wav" }) } } satisfies TranscribeRequest;
const synthesize = { method: "synthesize", text: "Hello" } satisfies SynthesizeRequest;
const decide = { method: "decide", state: { ticket: "Checkout is broken" },
  questions: { is_bug: { type: "noul", instructions: "Is this a software defect?" } },
} satisfies DecideRequest;

const chatStream = ipa.request(chat);
const transcriptionStream = ipa.request(transcribe);
const synthesisStream = ipa.request(synthesize);
const decisionStream = ipa.request(decide);
const unionStream = ipa.request(anyRequest);
type ChatInference = Assert<Equal<typeof chatStream, AsyncIterable<ChatChunk>>>;
type TranscriptionInference = Assert<Equal<typeof transcriptionStream, AsyncIterable<TranscriptionChunk>>>;
type SynthesisInference = Assert<Equal<typeof synthesisStream, AsyncIterable<SynthesisChunk>>>;
type DecisionInference = Assert<Equal<typeof decisionStream, AsyncIterable<DecisionChunk>>>;
type UnionInference = Assert<Equal<typeof unionStream, AsyncIterable<InferenceChunk>>>;

const client = createInference();
const clientChat = client.request(chat);
const clientTranscription = client.request(transcribe);
const clientSynthesis = client.request(synthesize);
const clientDecision = client.request(decide);
const clientUnion = client.request(anyRequest);
type ClientChat = Assert<Equal<typeof clientChat, AsyncIterable<ChatChunk>>>;
type ClientTranscription = Assert<Equal<typeof clientTranscription, AsyncIterable<TranscriptionChunk>>>;
type ClientSynthesis = Assert<Equal<typeof clientSynthesis, AsyncIterable<SynthesisChunk>>>;
type ClientDecision = Assert<Equal<typeof clientDecision, AsyncIterable<DecisionChunk>>>;
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
  // @ts-expect-error complete stays chat-only for decisions too
  await complete(decide);
  // @ts-expect-error client.complete stays chat-only for decisions too
  await client.complete(decide);
  for await (const chunk of decisionStream) {
    if (chunk.type === "done") {
      const answers: Record<string, DecisionAnswer> = chunk.answers;
      const answer = answers.is_bug;
      if (answer?.type === "noul") answer.noul;
      else if (answer?.type === "choice") answer.choice;
      else if (answer?.type === "score") answer.legend;
      // @ts-expect-error refusal must be narrowed before consuming answer fields
      else if (answer?.type === "refusal") answer.noul;
      // @ts-expect-error decisions are not chat
      chunk.message;
    }
    // @ts-expect-error decisions have no text deltas
    if (chunk.type === "delta") chunk.content;
  }
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
      else if ("answers" in chunk) chunk.answers;
      else if ("transcript" in chunk) chunk.transcript.text;
      else chunk.audio.byteLength;
    }
  }
}

// @ts-expect-error raw base64 requires a declared MIME type
const missingType: TranscriptionMediaSource = { data: "YQ==" };
// @ts-expect-error URL and data are mutually exclusive
const bothSources: TranscriptionMediaSource = { data: new Blob(), url: "https://example.com/a.wav" };
const wavRequest = { method: "synthesize", text: "Hello", output: { mediaType: "audio/wav" } } satisfies SynthesizeRequest;
const wavStream = ipa.request(wavRequest);
type WavInference = Assert<Equal<typeof wavStream, AsyncIterable<SynthesisChunk>>>;
const wavFeature: import("../../src/index.js").InferenceFeatures = {
  methods: { synthesize: { outputMediaTypes: ["audio/wav"] } },
};
const outputType: import("../../src/index.js").SynthesisMediaType = "audio/wav";
// @ts-expect-error raw PCM is not a synthesis output format
ipa.request({ method: "synthesize", text: "Hello", output: { mediaType: "audio/l16" } });
// @ts-expect-error pages do not choose voices
const pageVoice: SynthesizeRequest = { method: "synthesize", text: "Hello", voice: "a-provider-voice" };
// @ts-expect-error no method-named runtime function is added
ipa.transcribe(transcribe);
// @ts-expect-error no method-named runtime function is added for decisions
ipa.decide(decide);
// @ts-expect-error page code does not select decision models
const decisionModel: DecideRequest = { ...decide, model: "provider-model" };
// @ts-expect-error top-level state must be a string, object, or array
const scalarState: DecisionState = true;
// @ts-expect-error state must contain only JSON values
const binaryState: DecisionState = { recording: new Blob() };
// @ts-expect-error criteria for score must be ordered descriptions
const wrongScore: DecideRequest = { method: "decide", state: "ticket", questions: { q: { type: "score", instructions: "Urgency?", criteria: { low: "Routine", high: "Urgent" } } } };
