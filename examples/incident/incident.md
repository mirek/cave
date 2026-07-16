# Friday's checkout incident

At 14:05 UTC checkout latency spiked to ~4s and errors hit 12%. Checkout
calls payments, the payments service goes through the auth gateway, and auth keeps
sessions in redis-cache — which had been failing over intermittently since
a 13:50 config push. The CDN was the first suspect (unlikely, maybe 30%),
but the redis failover looks like the real cause (85%): rolling the config
back brought latency down to ~180ms by 14:40. Billing is still
investigating a few double-charges (60% it's related).
