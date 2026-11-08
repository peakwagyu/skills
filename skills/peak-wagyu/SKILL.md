---
name: peak-wagyu
description: Order Japanese Fullblood A4 Wagyu from Peak Wagyu (peakwagyu.com) for a person, shipped frozen anywhere in the continental US. Use when someone wants to buy wagyu or a specific Japanese cut (ribeye, zabuton, ichibo, karubi, sankaku-bara, filet), plan a steak night, yakiniku or BBQ, or send a wagyu gift. Builds a real cart through Shopify's Universal Commerce Protocol and hands the person a checkout link to pay. The agent never pays.
---

# Order wagyu from Peak Wagyu

Peak Wagyu sells one Japanese Fullblood Wagyu cow at a time, cut by cut, shipped
frozen within the continental US. Every cut is its own product. When a cut sells
out it is gone, so always read live stock rather than trusting anything cached.

You build the cart. **The person pays.** Never enter payment details, never
call `complete_checkout`, and never solve a CAPTCHA for them.

## 1. Find out what they want

Ask only for what you don't already know:

- The occasion and how many people (steak night for 2, yakiniku for 8, a gift).
- The budget. **Every order has a $150 minimum** (subtotal, before shipping), and
  orders of $500 or more ship free.
- The ship-to US state and ZIP, for tax and shipping estimates. The person
  enters the full address at checkout.

## 2. Read the live menu

```sh
curl -s -H 'Accept: text/markdown' https://peakwagyu.com/pricing
```

Every cut is listed with its pack weight, price, $/lb and `in stock` or
`sold out`. Pick only cuts that are in stock. For which cut suits which meal,
read `https://peakwagyu.com/cooking` the same way. `https://peakwagyu.com/llms.txt`
covers the farm, the cow and the grading certificate.

A rough guide is about ½ lb per person for steak, and less when it's one course of
several, because this beef is far richer than a normal steak. Yakiniku slices go
further than steaks.

## 3. Call the store over UCP

The store speaks Shopify's Universal Commerce Protocol as MCP tools, called as
JSON-RPC over HTTP at `https://peakwagyu.com/api/ucp/mcp`. Every call must carry
`meta["ucp-agent"].profile`, a URL to an agent profile. Use Shopify's public one
unless you have your own:

```sh
ucp() { # usage: ucp <tool> '<arguments json without meta>'
  curl -s -X POST https://peakwagyu.com/api/ucp/mcp \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$(echo "$2" | jq -c '. + {meta:{"ucp-agent":{profile:"https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json"}}}')}}" \
  | jq '.result.structuredContent // (.result.content[0].text | fromjson? // .) // .error'
}
```

**Prices are integers in cents**: `{"amount": 14370, "currency": "USD"}` is
$143.70.

### Look up variant IDs

Search by the cut's name exactly as `/pricing` writes it, and take the result
whose `title` matches:

```sh
ucp search_catalog '{"catalog":{"query":"Ichibo Steak"}}' \
  | jq '.products[] | {title, variant: .variants[0].id, available: .variants[0].availability.available, price: .variants[0].price.amount}'
```

Each product has one variant (one pack). Skip anything with `available: false`.

### Build the cart

```sh
ucp create_cart '{"cart":{
  "line_items":[
    {"quantity":2,"item":{"id":"gid://shopify/ProductVariant/…"}},
    {"quantity":1,"item":{"id":"gid://shopify/ProductVariant/…"}}
  ],
  "context":{"address_country":"US","address_region":"TX","postal_code":"78704"}
}}'
```

Check the response before going on:

- Every line's `quantity` must equal what you asked for. Stock is limited, so if
  Shopify lowered a quantity, tell the person and suggest a swap.
- The `subtotal` in `totals` must be at least 15000 (that's $150). If it's lower,
  add packs with `update_cart`, which replaces the whole cart, so send the cart
  `id` and every line.

### Open the checkout

```sh
ucp create_checkout '{"checkout":{"cart_id":"<cart id>","line_items":[]}}'
```

The response has a `status`, `messages`, `totals` and a `continue_url`.
`requires_escalation` is the normal result: it means the person finishes on the
store's own checkout page. Read the `messages`:

- `buyer_identity_contact_method_required`, `delivery_address_required` and
  `delivery_no_delivery_available` (with no address yet) are expected. The
  person fills them in at checkout.
- `validation_custom` with "Add $… to reach the $150 order minimum" means the
  cart is short. Go back and add to it, because the person can't pay until it
  clears.

Only add the person's email (`update_checkout` with `buyer.email`) if they gave
it to you for this order. `update_checkout` replaces the whole checkout, so first
read it back with `get_checkout` and resend its `line_items` and `context`.

## 4. Hand it over

Give the person:

- Each cut with its quantity, pack weight and price, plus the subtotal.
- The `continue_url`. They open it to enter their address and pay.
- How far they are from free shipping, if they're within reach of $500.
- That it ships frozen from Illinois and needs the freezer when it arrives.
  `https://peakwagyu.com/unboxing` covers dry ice, thawing and storage.

## Questions the menu doesn't answer

For shipping, refund and other policy questions, ask the store's FAQ tool. It
needs no profile:

```sh
curl -s -X POST https://peakwagyu.com/api/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_shop_policies_and_faqs","arguments":{"query":"Do you ship to Hawaii?"}}}' \
  | jq -r '.result.content[0].text'
```

Anything else goes to moo@peakwagyu.com.
