import { z } from 'zod';
/**
 * A stateless Model Context Protocol server over Streamable HTTP. Every POST carries one
 * JSON-RPC message (or a legacy batch) and receives a plain JSON response; no session or
 * server-initiated stream is needed because every tool completes within the request.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly?: boolean;
  destructive?: boolean;
  run(args: z.output<S>, context: ToolContext): Promise<unknown>;
}
export interface ToolContext {
  /** The incoming MCP request: its credentials and client address are forwarded to the API. */
  request: Request;
}
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool {
  return tool as unknown as Tool;
}
export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  instructions: string;
}
interface Message {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}
type Reply =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: { code: number; message: string; data?: unknown };
    };
export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};
const failure = (id: Message['id'], code: number, message: string, data?: unknown): Reply => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});
function inputSchema(schema: z.ZodType) {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return json;
}
export function describeTools(tools: Tool[]) {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchema(t.input),
    annotations: {
      title: t.title,
      readOnlyHint: Boolean(t.readOnly),
      destructiveHint: Boolean(t.destructive),
      openWorldHint: false,
    },
  }));
}
export const toolText = (value: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});
async function handle(
  message: Message,
  tools: Tool[],
  info: ServerInfo,
  context: ToolContext,
): Promise<Reply | null> {
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return failure(message?.id, RPC.invalidRequest, 'Invalid JSON-RPC message');
  const notification = message.id === undefined;
  const ok = (result: unknown): Reply | null =>
    notification ? null : { jsonrpc: '2.0', id: message.id!, result };
  switch (message.method) {
    case 'initialize': {
      const requested = String(message.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, title: info.title, version: info.version },
        instructions: info.instructions,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: describeTools(tools) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === message.params?.name);
      if (!tool)
        return failure(message.id, RPC.invalidParams, `Unknown tool: ${message.params?.name}`);
      const args = tool.input.safeParse(message.params?.arguments ?? {});
      if (!args.success)
        return ok(
          toolText(
            `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
            true,
          ),
        );
      try {
        return ok(toolText(await tool.run(args.data, context)));
      } catch (error) {
        // Tool failures go back to the model as results it can read and react to.
        return ok(toolText(error instanceof Error ? error.message : 'Tool failed', true));
      }
    }
    default:
      if (notification) return null;
      return failure(message.id, RPC.methodNotFound, `Method not found: ${message.method}`);
  }
}
/** Handles one HTTP POST body; returns 202 when it only carried notifications. */
export async function respond(
  body: unknown,
  tools: Tool[],
  info: ServerInfo,
  context: ToolContext,
): Promise<Response> {
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Message[];
  if (!messages.length)
    return Response.json(failure(null, RPC.invalidRequest, 'Empty batch'), { status: 400 });
  const replies: Reply[] = [];
  for (const m of messages) {
    const reply = await handle(m, tools, info, context);
    if (reply) replies.push(reply);
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(batch ? replies : replies[0], {
    headers: { 'cache-control': 'no-store' },
  });
}
