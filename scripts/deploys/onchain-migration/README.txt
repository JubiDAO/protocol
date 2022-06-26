Contains the last onchain migration run

Could be multiple scripts (as often there are multiple contracts to deploy, then configure).

The state of each contract deployed is written to `deployed-args` and checked in for posterity.

Goal is to only have one set of scripts, which can be tested locally, on rinkeby and on mainnet via config
(either env vars or command line args)
