'use strict';
/* The Ask AI providers: every request body, every reader, and the CLI
   argument lists that keep Claude Code and Codex to talk only. */
const assert = require('node:assert');
require('./_stub.cjs');
const P = require('../src/ai-providers');

const msgs = [
  { role: 'user', content: 'What is due?' },
  { role: 'assistant', content: 'Two reminders.' },
  { role: 'assistant', content: '   ' },
  { role: 'system', content: 'sneaky' },
  { role: 'user', content: 'Which first?' },
];

(async () => {
  /* only user/assistant turns with text survive, in order */
  assert.deepStrictEqual(P.cleanMessages(msgs).map(m => m.content), ['What is due?', 'Two reminders.', 'Which first?']);

  /* every provider the user named, plus the two plan apps */
  assert.deepStrictEqual(P.PROVIDERS.map(p => p.id), ['claude', 'chatgpt', 'grok', 'gemini', 'claude-code', 'codex']);
  assert.strictEqual(P.provider('nope').id, 'claude');

  /* Claude: system apart, messages as given */
  const cb = P.claudeBody({ system: 'SYS', messages: msgs });
  assert.strictEqual(cb.system, 'SYS');
  assert.strictEqual(cb.model, 'claude-sonnet-5-5');
  assert.strictEqual(cb.messages.length, 3);
  assert.ok(!('tools' in cb), 'no tools for the chat');
  assert.deepStrictEqual(P.claudeRead({ model: 'm', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] }), { text: 'a\nb', model: 'm', stop: 'max_tokens' });

  /* chat completions: system first, no token cap (gpt-5 refuses max_tokens) */
  const ob = P.chatBody({ system: 'SYS', messages: msgs, model: '' }, P.provider('grok'));
  assert.deepStrictEqual(ob.messages[0], { role: 'system', content: 'SYS' });
  assert.strictEqual(ob.messages.length, 4);
  assert.strictEqual(ob.model, 'grok-4.5');
  assert.ok(!('max_tokens' in ob) && !('tools' in ob));
  assert.deepStrictEqual(P.chatRead({ model: 'g', choices: [{ finish_reason: 'length', message: { content: 'hi' } }] }), { text: 'hi', model: 'g', stop: 'max_tokens' });
  assert.strictEqual(P.chatRead({ choices: [{ message: { content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] } }] }).text, 'x\ny');

  /* each API goes to its own endpoint with its own auth header */
  const seen = [];
  const request = async r => { seen.push(r); return { status: 200, json: r.url.includes('anthropic') ? { content: [{ type: 'text', text: 'ok' }] } : { choices: [{ message: { content: 'ok' } }] } }; };
  for (const id of ['claude', 'chatgpt', 'grok', 'gemini']) {
    const r = await P.ask({ provider: id, apiKey: 'K-' + id, system: 'S', messages: msgs, request });
    assert.strictEqual(r.text, 'ok');
  }
  assert.strictEqual(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(seen[0].headers['x-api-key'], 'K-claude');
  assert.strictEqual(seen[0].headers['anthropic-version'], '2023-06-01');
  assert.strictEqual(seen[1].url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(seen[2].url, 'https://api.x.ai/v1/chat/completions');
  assert.strictEqual(seen[3].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.strictEqual(seen[3].headers.Authorization, 'Bearer K-gemini');
  assert.ok(seen.every(r => r.throw === false && r.method === 'POST'));

  /* no key: a plain instruction, no request */
  await assert.rejects(P.ask({ provider: 'grok', apiKey: '', system: 'S', messages: msgs, request }), /Add your Grok API key/);
  /* failures in words */
  const fail = status => async () => ({ status, json: { error: { message: 'model x not found' } } });
  await assert.rejects(P.ask({ provider: 'gemini', apiKey: 'k', system: 'S', messages: msgs, request: fail(401) }), /rejected the API key/);
  await assert.rejects(P.ask({ provider: 'gemini', apiKey: 'k', system: 'S', messages: msgs, request: fail(404) }), /does not know that model: model x not found/);
  await assert.rejects(P.ask({ provider: 'claude', apiKey: 'k', system: 'S', messages: msgs, request: async () => { throw new Error('offline'); } }), /Could not reach Claude/);

  /* Claude Code: every tool off, nothing of the user's loaded, nothing saved */
  const ca = P.claudeArgs({ system: 'SYS' });
  const at = flag => ca[ca.indexOf(flag) + 1];
  assert.strictEqual(at('--tools'), '', 'empty --tools switches every tool off');
  assert.strictEqual(at('--permission-mode'), 'dontAsk');
  assert.strictEqual(at('--system-prompt'), 'SYS');
  for (const f of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(ca.includes(f), f);
  assert.ok(!ca.includes('--allowedTools') && !ca.includes('--bare'));
  assert.deepStrictEqual(P.claudeArgs({ system: 'S', model: 'opus' }).slice(-2), ['--model', 'opus']);
  const ccOut = JSON.stringify({ type: 'result', result: 'Hi', stop_reason: 'end_turn', modelUsage: { 'claude-opus-5-5': {} } });
  assert.deepStrictEqual(P.claudeCliRead(ccOut), { text: 'Hi', model: 'claude-opus-5-5', stop: 'end_turn' });
  assert.throws(() => P.claudeCliRead(JSON.stringify({ type: 'result', is_error: true, result: 'Please run /login' })), /not signed in/);

  /* Codex: read-only, no web, every local tool off */
  const xa = P.codexArgs({});
  assert.strictEqual(xa[xa.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(xa.includes('web_search="disabled"'));
  for (const f of P.CODEX_OFF) assert.ok(xa.includes(f), f);
  assert.strictEqual(xa[xa.length - 1], '-');
  const cx = l => l.map(o => JSON.stringify(o)).join('\n');
  assert.strictEqual(P.codexRead(cx([{ type: 'item.completed', item: { type: 'agent_message', text: 'OK' } }])).text, 'OK');
  assert.throws(() => P.codexRead(cx([{ type: 'item.started', item: { type: 'command_execution' } }, { type: 'item.completed', item: { type: 'agent_message', text: 'OK' } }])), /does not allow/);
  assert.throws(() => P.codexRead(cx([{ type: 'turn.failed', error: { message: '401 Unauthorized' } }])), /not signed in/);

  /* CLI prompt carries the conversation, newest question last; Codex gets the rules first */
  const cp = P.cliPrompt('claude-code', { system: 'SYS', messages: msgs });
  assert.ok(cp.includes('Me: What is due?') && cp.includes('You: Two reminders.'));
  assert.ok(cp.trim().endsWith('Which first?'));
  assert.ok(!cp.includes('SYS'));
  assert.ok(P.cliPrompt('codex', { system: 'SYS', messages: [{ role: 'user', content: 'Q' }] }).startsWith('SYS'));
  assert.strictEqual(P.cliPrompt('claude-code', { system: 'S', messages: [{ role: 'user', content: 'Q' }] }), 'Q');

  /* a CLI on a phone (no runner) says so instead of failing oddly */
  await assert.rejects(P.ask({ provider: 'claude-code', system: 'S', messages: msgs }), /runs on a computer only/);
  /* the runner gets the prompt on stdin and the found path */
  let ran = null;
  const r = await P.ask({ provider: 'codex', system: 'S', messages: msgs, binPath: '/x/codex', run: async (bin, args, o) => { ran = { bin, args, o }; return { code: 0, stdout: cx([{ type: 'item.completed', item: { type: 'agent_message', text: 'A' } }]), stderr: '' }; } });
  assert.strictEqual(r.text, 'A');
  assert.strictEqual(ran.bin, '/x/codex');
  assert.ok(ran.o.stdin.endsWith('Which first?'));
  await assert.rejects(P.ask({ provider: 'claude-code', system: 'S', messages: msgs, run: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } }), /Could not find Claude Code/);

  console.log('ai providers OK');
})().catch(e => { console.error(e); process.exit(1); });
