'use strict';
/* Every AI the Ask AI chat can talk to, behind one ask(). Each answers in the
   same shape, { text, model, stop }.

   Two kinds:
     api  Claude, ChatGPT, Grok, Gemini — over Obsidian's requestUrl with the
          user's own key (kept per device, never in the vault).
     cli  Claude Code, Codex — the user's own installed app, signed in to
          their Claude or ChatGPT plan, run by src/ai-cli.js on a computer.
          Talk only: every tool is switched off by the arguments below
          (claudeArgs, codexArgs, pinned in tests/ai-providers.test.cjs), and
          it runs in an empty temporary folder with nothing saved.

   Ask AI is a computer feature (Ruan, 3 Nov 2026): ask() refuses, before any
   request or run, when the caller's platform says mobile (a phone or tablet).

   The chat only reads and answers. No AI here is given a tool, web search
   or a way to change the vault.

   Pure: no DOM, no obsidian, no Node. Requests and runs are passed in, so
   the tests prove every body, argument list and reader. */

const PROVIDERS = [
  { id: 'claude', name: 'Claude', kind: 'api', model: 'claude-sonnet-5-5', keyHint: 'sk-ant-…', console: 'console.anthropic.com' },
  { id: 'chatgpt', name: 'ChatGPT', kind: 'api', model: 'gpt-5.5', keyHint: 'sk-…', console: 'platform.openai.com',
    url: 'https://api.openai.com/v1/chat/completions' },
  { id: 'grok', name: 'Grok', kind: 'api', model: 'grok-4.5', keyHint: 'xai-…', console: 'console.x.ai',
    url: 'https://api.x.ai/v1/chat/completions' },
  { id: 'gemini', name: 'Gemini', kind: 'api', model: 'gemini-flash-latest', keyHint: 'AIza…', console: 'aistudio.google.com',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
  { id: 'claude-code', name: 'Claude Code', kind: 'cli', bin: 'claude', model: '', plan: 'Claude' },
  { id: 'codex', name: 'Codex', kind: 'cli', bin: 'codex', model: '', plan: 'ChatGPT' },
];

const provider = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

/* Only user and assistant turns with something in them, oldest first. */
function cleanMessages(messages) {
  return (messages || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map(m => ({ role: m.role, content: String(m.content) }));
}

/* What a failed HTTP call says to the user. */
function httpFailure(name, status, body) {
  const err = body && body.error;
  const msg = err && err.message ? String(err.message) : (typeof err === 'string' ? err : '');
  if (status === 401 || status === 403) return `${name} rejected the API key. Check it in Settings → Vista → Ask AI.`;
  if (status === 404) return `${name} does not know that model${msg ? ': ' + msg : ''}. Change it in Settings → Vista → Ask AI.`;
  if (status === 429) return `Too many requests to ${name} right now — wait a minute and ask again.`;
  if (status >= 500) return `${name} is having trouble right now (${status}) — try again in a few minutes.`;
  return `${name} answered ${status}${msg ? ': ' + msg : ''}.`;
}

async function post(name, o, url, headers, body) {
  let res;
  try {
    res = await o.request({ url, method: 'POST', contentType: 'application/json', throw: false, headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`Could not reach ${name} — check your connection. ${String((e && e.message) || e)}`);
  }
  let json = null;
  try { json = res.json !== undefined ? res.json : JSON.parse(res.text); } catch (e) { json = null; }
  if (res.status !== 200) throw new Error(httpFailure(name, res.status, json));
  if (!json || typeof json !== 'object') throw new Error(`${name} sent an answer Vista could not read.`);
  return json;
}

/* ---- Claude: the Messages API ------------------------------------------ */

function claudeBody(o) {
  return { model: o.model || provider('claude').model, max_tokens: o.maxTokens || 2000, system: o.system, messages: cleanMessages(o.messages) };
}

function claudeRead(json) {
  const text = (json.content || []).filter(c => c && c.type === 'text').map(c => c.text || '').join('\n');
  return { text, model: json.model || '', stop: json.stop_reason === 'max_tokens' ? 'max_tokens' : (json.stop_reason || '') };
}

/* ---- ChatGPT, Grok, Gemini: chat completions ---------------------------
   All three speak OpenAI's chat completions shape. No token cap is sent:
   OpenAI's newer models refuse max_tokens, and each has a sane default. */

function chatBody(o, p) {
  return { model: o.model || p.model, messages: [{ role: 'system', content: o.system }].concat(cleanMessages(o.messages)) };
}

function chatRead(json) {
  const choice = (json.choices || [])[0] || {};
  const msg = choice.message || {};
  const text = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(c => (c && c.text) || '').join('\n') : '');
  return { text, model: json.model || '', stop: choice.finish_reason === 'length' ? 'max_tokens' : (choice.finish_reason || '') };
}

/* ---- the CLIs ----------------------------------------------------------- */

/* A CLI run starts with no memory, so the whole conversation goes in as
   text, the newest question last. Codex has no system-prompt flag: the rules
   lead its prompt. */
function cliPrompt(id, o) {
  const msgs = cleanMessages(o.messages);
  const last = msgs.length && msgs[msgs.length - 1].role === 'user' ? msgs.pop() : null;
  const parts = [];
  if (id === 'codex') parts.push(o.system);
  if (msgs.length) {
    parts.push('The conversation so far:\n\n' + msgs.map(m => `${m.role === 'user' ? 'Me' : 'You'}: ${m.content}`).join('\n\n'));
    parts.push('My next question:');
  }
  parts.push(last ? last.content : '');
  return parts.join('\n\n');
}

function claudeArgs(o) {
  const args = ['-p', '--output-format', 'json',
    /* "" switches every built-in tool off: no shell, no files, no web. */
    '--tools', '', '--permission-mode', 'dontAsk',
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence',
    /* Without this the user's own CLAUDE.md, plugins, skills, hooks and MCP
       servers load into the chat. It keeps the Claude login (--bare would
       not). */
    '--safe-mode',
    '--system-prompt', o.system];
  if (o.model) args.push('--model', o.model);
  return args;
}

function claudeCliRead(stdout) {
  let result = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    let e = null;
    try { e = JSON.parse(line); } catch (err) { continue; }
    if (e && e.type === 'result') result = e;
  }
  if (!result) throw new Error('Claude Code sent nothing Vista could read.');
  if (result.is_error) {
    const why = String(result.result || '');
    if (/login|log in|sign in|api key|auth/i.test(why)) throw new Error('Claude Code is not signed in. Open Terminal, run claude and sign in, then ask again.');
    throw new Error(`Claude Code stopped: ${why || result.subtype || 'unknown error'}`);
  }
  const used = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage)[0] : '';
  return { text: String(result.result || ''), model: used || 'Claude Code', stop: result.stop_reason || '' };
}

/* Codex's own tools that could read the Mac or reach out, each checked
   against `codex features list` (0.166). `--sandbox read-only` only stops
   WRITES, so these are switched off as well, and web search with them. */
const CODEX_OFF = ['shell_tool', 'unified_exec', 'view_image', 'multi_agent', 'apps', 'plugins', 'hooks', 'browser_use', 'computer_use'];

function codexArgs(o) {
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '-c', 'web_search="disabled"'];
  for (const f of CODEX_OFF) args.push('--disable', f);
  if (o.model) args.push('-m', o.model);
  args.push('-');
  return args;
}

const CODEX_FORBIDDEN = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'collab_tool_call', 'web_search']);

function codexRead(stdout, model) {
  const texts = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    let e = null;
    try { e = JSON.parse(line); } catch (err) { continue; }
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'turn.failed' || e.type === 'error') {
      const why = String((e.error && e.error.message) || e.message || 'unknown error');
      if (/not logged in|log ?in|sign in|unauthori[sz]ed|401/i.test(why)) throw new Error('Codex is not signed in. Open Terminal, run codex login, then ask again.');
      throw new Error(`Codex stopped: ${why}`);
    }
    /* Anything but talk means a tool the arguments turned off ran anyway:
       the answer is thrown away. */
    if (e.item && CODEX_FORBIDDEN.has(e.item.type)) throw new Error('Codex tried to use a tool on this computer, which Vista does not allow. The answer was discarded.');
    if (e.type === 'item.completed' && e.item && e.item.type === 'agent_message') texts.push(String(e.item.text || ''));
  }
  if (!texts.length) throw new Error('Codex sent nothing Vista could read.');
  return { text: texts.join('\n'), model: model ? `Codex ${model}` : 'Codex', stop: '' };
}

async function askCli(p, o) {
  if (typeof o.run !== 'function') throw new Error(`${p.name} runs on a computer only (it uses the ${p.bin} app you sign in to with your ${p.plan} plan).`);
  const args = p.id === 'codex' ? codexArgs(o) : claudeArgs(o);
  let res;
  try {
    res = await o.run(o.binPath || p.bin, args, { stdin: cliPrompt(p.id, o), timeoutMs: o.timeoutMs });
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new Error(`Could not find ${p.name} (${p.bin}). Install it, or set its path in Settings → Vista → Ask AI.`);
    if (e && e.code === 'TOOBIG') throw new Error(`${p.name} printed far more than an answer needs and was stopped.`);
    if (e && e.code === 'KILLED') throw new Error(`${p.name} was stopped because Vista was turned off.`);
    if (e && e.code === 'TIMEOUT') throw new Error(`${p.name} took longer than ${Math.max(1, Math.round((o.timeoutMs || 0) / 60000))} minutes and was stopped.`);
    throw new Error(`${p.name} could not start: ${String((e && e.message) || e)}`);
  }
  try {
    return p.id === 'codex' ? codexRead(res.stdout, o.model) : claudeCliRead(res.stdout);
  } catch (e) {
    const tail = String(res.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (res.code !== 0 && tail && /sent nothing/.test(e.message)) throw new Error(`${p.name} stopped: ${tail}`);
    throw e;
  }
}

/* ---- one way in --------------------------------------------------------- */

const MOBILE_REFUSAL = 'Ask AI is on the computer only.';

/* o: { provider, system, messages: [{ role, content }], model, apiKey,
   request (api), run + binPath + timeoutMs (cli), platform (Obsidian's
   Platform) } → { text, model, stop }. The one place a question leaves the
   plugin, so the mobile refusal lives here: nothing below it can run. */
async function ask(o) {
  if (o.platform && o.platform.isMobile) throw new Error(MOBILE_REFUSAL);
  const p = provider(o.provider);
  if (p.kind === 'cli') return askCli(p, o);
  if (!o.apiKey) throw new Error(`Add your ${p.name} API key in Settings → Vista → Ask AI.`);
  if (p.id === 'claude') {
    const json = await post(p.name, o, 'https://api.anthropic.com/v1/messages', { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' }, claudeBody(o));
    return claudeRead(json);
  }
  const json = await post(p.name, o, p.url, { Authorization: `Bearer ${o.apiKey}` }, chatBody(o, p));
  return chatRead(json);
}

module.exports = { MOBILE_REFUSAL, PROVIDERS, CODEX_OFF, provider, ask, cleanMessages, httpFailure, claudeBody, claudeRead, chatBody, chatRead, cliPrompt, claudeArgs, claudeCliRead, codexArgs, codexRead };
