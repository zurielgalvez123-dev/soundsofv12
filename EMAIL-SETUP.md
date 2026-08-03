# Email infrastructure

Outbound is Resend; inbound is ImprovMX forwarding. Both authenticated on
`soundsofv12.com`.

| Record | Host | Purpose |
|---|---|---|
| SPF | `send` | authorises Resend/SES to send as the domain |
| SPF | `@` | authorises SES + ImprovMX, blocks root spoofing |
| DKIM | `resend._domainkey` | signs outbound mail |
| DMARC | `_dmarc` | `p=none` — monitor only, required by Gmail/Yahoo bulk rules |
| MX | `send` | SES bounce/complaint handling — **Resend's domain verification depends on this; never remove it** |
| MX | `@` | ImprovMX inbound forwarding |

**Working inbound aliases** (all forward to `soundsofv12@gmail.com`):
`team@`, `booking@`, `hello@`, `privacy@`. Verified delivering end-to-end
2026-08-03 — Gmail returned a 250 accept.

`team@soundsofv12.com` is the Reply-To on outreach. It must stay on the
domain: a freemail Reply-To against a custom-domain From scores -2.75 on
SpamAssassin, because that shape is a common scam signature.

**Deliverability, measured on mail-tester:**

| Setup | Score |
|---|---|
| branded header template, freemail Reply-To | 5.1/10 |
| plain template, freemail Reply-To | 7.3/10 |
| plain template, domain Reply-To + postal address | expected ~10 |

The header image alone cost ~1.3 points (SpamAssassin's HTML_IMAGE_ONLY
rule), which is why cold outreach uses the plain template and the branded
one is reserved for opted-in fan mail.

Sending is throttled by `outreach/run_campaign.py` — 26 emails over 9
days, press first. The domain sent its first email ever on 2026-08-01, so
a burst would look like a compromised account and land in spam
permanently.
