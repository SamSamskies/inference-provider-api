import { createAgent, runTools, type ToolPolicy, type ToolArgumentValidator,
  type ToolRunContext, type ToolApprovalRequest, type ToolApprovalHandler } from "../../src/index.js";

const validate: ToolArgumentValidator = (args, context) => {
  const run: ToolRunContext = context;
  const schema: Record<string, unknown> | undefined = context.tool?.function.parameters;
  // @ts-expect-error Arguments remain unknown; validators do not transform their type
  args.text;
  return typeof args === "object" && args !== null;
};
const policy: ToolPolicy = { validateArguments: validate, requiresApproval: true };
const approve: ToolApprovalHandler = async (request: ToolApprovalRequest) => {
  const args: unknown = request.arguments;
  const signal: AbortSignal | undefined = request.signal;
  // @ts-expect-error Approval context is read-only
  request.name = "another";
  return true;
};
runTools({ messages: [], toolPolicies: { send: policy }, onApprovalRequest: approve, maxToolResultChars: 1000 });
createAgent({ name: "Test", instructions: "", tools: {
  send: { ...policy, execute: (args) => args },
} }).run("hello", { onApprovalRequest: approve, maxToolResultChars: 1000 });

// @ts-expect-error An approval handler must return an explicit boolean, never void
const invalidApproval: ToolApprovalHandler = () => {};
// @ts-expect-error A validator must return an explicit boolean, never a parsed object
const invalidValidator: ToolArgumentValidator = () => ({ ok: true });
// @ts-expect-error Approval policy is an app-owned boolean, not provider instructions
const invalidPolicy: ToolPolicy = { requiresApproval: "ask the model" };
