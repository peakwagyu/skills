# Peak Wagyu agent skills

[![skills.sh](https://skills.sh/b/peakwagyu/skills)](https://skills.sh/peakwagyu/skills)

Skills that let an AI agent order [Peak Wagyu](https://peakwagyu.com) (Japanese Fullblood Wagyu, shipped frozen in the US).

```sh
npx skills add peakwagyu/skills
```

| Skill                                      | What it does                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`peak-wagyu`](skills/peak-wagyu/SKILL.md) | Reads the live menu, builds a cart through Shopify's [Universal Commerce Protocol](https://ucp.dev), and hands the person a checkout link to pay. |

The agent never pays. Checkout is always the person's.

## Testing

```sh
pnpm test:e2e
```

This runs a headless Claude Code subagent that has only this skill installed, gives it a real request, and lets it build a real cart on peakwagyu.com. It then reads the checkout back from the store and checks it, without ever checking out. It needs `claude` signed in, plus `curl` and `jq`. The report is written to `test/out/<timestamp>/summary.md`, alongside the transcript and the checkout JSON.
