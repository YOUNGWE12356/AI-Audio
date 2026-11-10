// Optional adapter for clients that only support local stdio MCP servers.
// Credentials live in the client environment, never in this file.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = new URL(process.env.T1_AUDIO_MCP_URL || 'https://kaka-ai-audio.wepieoa.com/mcp');
const token = process.env.T1_AUDIO_MCP_TOKEN;
if (!token || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
  console.error('请配置 T1_AUDIO_MCP_TOKEN；远程地址必须使用 HTTPS。');
  process.exit(1);
}
const client = new Client({ name: 't1-ai-audio-stdio', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const server = new Server({ name: 't1-ai-audio', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
server.setRequestHandler(CallToolRequestSchema, (request, extra) => client.callTool(request.params, undefined, { timeout: 30 * 60_000, signal: extra.signal }));
await server.connect(new StdioServerTransport());
const close = async () => { await client.close(); await server.close(); };
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
