#!/usr/bin/env node
// End-to-end test of the peak-wagyu skill: a headless Claude Code subagent,
// given only the installed skill and a person's request, builds a real cart on
// peakwagyu.com and stops at checkout. The checkout it reports is then read back
// from the store over UCP and checked independently of what the agent claims.
//
// Never pays: the agent's tools can't, and the test only reads the checkout.
// Output (gitignored): test/out/<timestamp>/{summary.md,transcript.jsonl,checkout.json}

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UCP = 'https://peakwagyu.com/api/ucp/mcp';
const PROFILE =
  'https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json';
const MINIMUM_CENTS = 150_00;
const BUDGET_CENTS = 300_00;

const PROMPT = `I'd like to order Japanese wagyu from Peak Wagyu for a steak night for 4 people. Budget is around $300. It ships to Austin, TX 78704. Don't ask me questions, just make reasonable choices. Put the order together and give me the checkout link, but don't pay. End your reply with a line of the form "CHECKOUT_ID: <the checkout id>".`;

const out = join(ROOT, 'test/out', new Date().toISOString().replace(/[:.]/g, '-'));
const workspace = join(out, 'workspace');
mkdirSync(join(workspace, '.claude/skills'), { recursive: true });
cpSync(join(ROOT, 'skills/peak-wagyu'), join(workspace, '.claude/skills/peak-wagyu'), {
  recursive: true,
});

// --- Run the subagent ------------------------------------------------------

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY; // run on the signed-in Claude Code plan
const transcript = await new Promise((resolve, reject) => {
  const child = spawn(
    'claude',
    [
      '-p',
      PROMPT,
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      'Bash,Read,Skill',
      '--allowedTools',
      'Bash,Read,Skill',
    ],
    { cwd: workspace, env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
  });
  child.on('error', reject);
  child.on('close', () => resolve(buf));
});
writeFileSync(join(out, 'transcript.jsonl'), transcript);

const events = transcript
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const toolUses = events
  .filter((e) => e.type === 'assistant')
  .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_use'));
const finalText = events.findLast((e) => e.type === 'result')?.result ?? '';
const checkoutId = finalText.match(/CHECKOUT_ID:\s*`?(gid:\/\/shopify\/Checkout\/[^\s`]+)/)?.[1];

// --- Read the checkout back from the store ----------------------------------

async function ucp(name, args) {
  const res = await fetch(UCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { ...args, meta: { 'ucp-agent': { profile: PROFILE } } } },
    }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(`${name}: ${JSON.stringify(error)}`);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

const checkout = checkoutId ? await ucp('get_checkout', { id: checkoutId }) : null;
writeFileSync(join(out, 'checkout.json'), JSON.stringify(checkout, null, 2));

const total = (type) => checkout?.totals?.find((t) => t.type === type)?.amount ?? 0;
const subtotal = total('subtotal');
const codes = checkout?.messages?.map((m) => m.code) ?? [];
const minimumMessage = checkout?.messages?.find((m) => /order minimum/i.test(m.content ?? ''));
const continueUrl = checkout?.continue_url ?? '';
const linkPath = continueUrl ? new URL(continueUrl).pathname : '';

const checks = [
  ['The agent loaded the peak-wagyu skill', toolUses.some((t) => t.name === 'Skill' && /peak-wagyu/.test(JSON.stringify(t.input)))],
  ['The agent built the cart over UCP', toolUses.some((t) => t.name === 'Bash' && /create_cart/.test(t.input.command))],
  ['The agent never tried to complete the checkout', !toolUses.some((t) => /complete_checkout/.test(JSON.stringify(t.input)))],
  ['The reply names a checkout ID', Boolean(checkoutId)],
  ['The store returns that checkout', Boolean(checkout?.id)],
  ['The checkout is not completed (nobody paid)', checkout && checkout.status !== 'completed'],
  ['The checkout has at least one line', (checkout?.line_items?.length ?? 0) > 0],
  [`The subtotal clears the $${MINIMUM_CENTS / 100} minimum`, subtotal >= MINIMUM_CENTS],
  ["The store's order-minimum validation is satisfied", !minimumMessage],
  [`The subtotal is near the $${BUDGET_CENTS / 100} budget (at most +25%)`, subtotal <= BUDGET_CENTS * 1.25],
  ["The reply links the checkout's continue_url", Boolean(linkPath) && finalText.includes(linkPath)],
];

// --- Artifact ---------------------------------------------------------------

const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const lines = (checkout?.line_items ?? []).map(
  (l) => `| ${l.item.title} | ${l.quantity} | ${usd(l.item.price)} |`,
);
const passed = checks.every(([, ok]) => ok);
const summary = `# peak-wagyu skill E2E — ${passed ? 'PASS' : 'FAIL'}

${new Date().toISOString()}

## Request

> ${PROMPT}

## Checks

${checks.map(([name, ok]) => `- [${ok ? 'x' : ' '}] ${name}`).join('\n')}

## Checkout (read back from the store)

- ID: \`${checkoutId ?? 'none'}\`
- Status: \`${checkout?.status ?? 'n/a'}\`
- Subtotal: ${usd(subtotal)} · Total: ${usd(total('total'))}
- Messages: ${codes.map((c) => `\`${c}\``).join(', ') || 'none'}
- Continue URL: ${continueUrl || 'none'}

| Cut | Qty | Price |
| --- | --- | --- |
${lines.join('\n')}

## The agent's reply

${finalText}
`;
writeFileSync(join(out, 'summary.md'), summary);

console.log(summary);
console.log(`Artifact: ${out}`);
process.exit(passed ? 0 : 1);
