# OKLink manual verification checklist — X Layer testnet (1952)

Generated `2026-09-07` from `4f76259` by `scripts/gen-verification-package.mjs`.

Form: <https://www.oklink.com/x-layer-testnet/verify-contract-preliminary>
Method: **Solidity (Standard JSON Input)** — this repo has imported sources, so do not flatten.

## Same for every contract

| Field | Value |
|---|---|
| Compiler type | Solidity (Standard-Json-Input) |
| Compiler version | `v0.8.28` |
| Open source license | `BUSL-1.1` |
| Optimization | `Yes` |
| Optimizer runs | `200` |
| EVM version | `cancun` |
| via-IR | `No` |
| Metadata bytecode hash | `none` (already encoded in the Standard JSON — do not override) |
| CBOR metadata | `No` |
| Linked libraries | none (all internal libraries, inlined) |

The Standard JSON files already carry `settings.optimizer`, `settings.evmVersion`, `settings.metadata` and `settings.remappings`, so the only fields to fill on the form are the address, the contract name, the Standard JSON file, and the constructor arguments.

## Per contract

### Authority

- **Address:** `0x263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Contract name (for the form):** `src/core/Authority.sol:Authority`
- **Standard JSON Input:** `docs/verification/1952/standard-json/Authority.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000ba8132637cbfce8d76991e1d681aa2e29f204b05`
- **Constructor arguments (decoded):** `0xBA8132637cbFCE8d76991E1D681aa2e29f204b05`
- **Source commit (last touched):** `7ac8553` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `1044` bytes · keccak256 `0x7cd2166f20e51e1cdb35adac45fd9bf40c943a7d10fd83c3253ed3336781afd0`
- **Local build runtime bytecode:** `1044` bytes · keccak256 `0x7cd2166f20e51e1cdb35adac45fd9bf40c943a7d10fd83c3253ed3336781afd0` · length **matches** (immutables aside, source shape is correct)

### AssetRegistry

- **Address:** `0x70d4fcd5414ed20538f1778f7028dc949409958d`
- **Contract name (for the form):** `src/core/AssetRegistry.sol:AssetRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/AssetRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`
- **Source commit (last touched):** `7ac8553` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `4708` bytes · keccak256 `0x71d1c9d61a5e0cfb11da5271499292eee60868e2a2248fb1b1595a713341454c`
- **Local build runtime bytecode:** `4708` bytes · keccak256 `0xd7101db21748468e04c2173cab1e8f8cf7c73477c8f262c49e59d23e2733e0b5` · length **matches** (immutables aside, source shape is correct)

### EvidenceRegistry

- **Address:** `0xdba478bef267df507bd0726d54ac5daa0177ffdf`
- **Contract name (for the form):** `src/core/EvidenceRegistry.sol:EvidenceRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/EvidenceRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`
- **Source commit (last touched):** `c80523d` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `3817` bytes · keccak256 `0xc82834a752057a707654d1f2ba3d368e925ec4100efda48155018d96552289e2`
- **Local build runtime bytecode:** `3817` bytes · keccak256 `0x7f1e1296ab14aa7b2a97f1abc7b4ac00518bf5f84989a2dc8fe1607e1c3ab8f4` · length **matches** (immutables aside, source shape is correct)

### PassportRegistry

- **Address:** `0x3d5ce1e17451134e6748b896e6f0ab1dbae0cd50`
- **Contract name (for the form):** `src/core/PassportRegistry.sol:PassportRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/PassportRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38000000000000000000000000dba478bef267df507bd0726d54ac5daa0177ffdf`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0xDBA478bEF267Df507BD0726d54ac5DAA0177FfDF`
- **Source commit (last touched):** `c80523d` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `5577` bytes · keccak256 `0x54f9693e7058685dfb070a1cb55c0e608aa502f7de1b217a045426e4cfbaf569`
- **Local build runtime bytecode:** `5577` bytes · keccak256 `0x859d773f99cb9878707be12071b0efad84c412a3edee7b4d429701cb89547b4e` · length **matches** (immutables aside, source shape is correct)

### RiskPolicyRegistry

- **Address:** `0xc1e338ab59b450738108e8643ea73e2696c8d552`
- **Contract name (for the form):** `src/core/RiskPolicyRegistry.sol:RiskPolicyRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/RiskPolicyRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`
- **Source commit (last touched):** `0598ada` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `9965` bytes · keccak256 `0x2a214e7edad6a3c9ee600ebaaf3382cf90fc72b28a7906cd3d0045546620dfc0`
- **Local build runtime bytecode:** `9965` bytes · keccak256 `0x88430abe9788a9f1710d35c4dd5f3cae3e9947dedd712350bfb6c0e4357bf0d0` · length **matches** (immutables aside, source shape is correct)

### ChainlinkFeedAdapter

- **Address:** `0x11d4a1ed14f8883a6ca40ff01d9543cd7cc09ebc`
- **Contract name (for the form):** `src/adapters/ChainlinkFeedAdapter.sol:ChainlinkFeedAdapter`
- **Standard JSON Input:** `docs/verification/1952/standard-json/ChainlinkFeedAdapter.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`
- **Source commit (last touched):** `7ac8553` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `4130` bytes · keccak256 `0x03bb6663f0ec720e5ccc9975b3bf33d9b4253dac444ccdd74e199ea180769942`
- **Local build runtime bytecode:** `4130` bytes · keccak256 `0x48c7275ba7a1ac7ae7b6bc45a3eefc7a64758faa765fa32b61c402cb3e969d50` · length **matches** (immutables aside, source shape is correct)

### CollateralVault

- **Address:** `0x68a29192aeac5415d991b0f72edf1ded135bcb7a`
- **Contract name (for the form):** `src/core/CollateralVault.sol:CollateralVault`
- **Standard JSON Input:** `docs/verification/1952/standard-json/CollateralVault.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a3800000000000000000000000070d4fcd5414ed20538f1778f7028dc949409958d`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0x70d4FCd5414ED20538F1778f7028dc949409958D`
- **Source commit (last touched):** `daf1e72` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `3803` bytes · keccak256 `0x1006e944a06f4d21aac0738aa793c1bdb2a9298893aa3934fc9705da7c75a861`
- **Local build runtime bytecode:** `3803` bytes · keccak256 `0xbb5a2d80ae620da9d724b1963ed7cdf1227a7949677894db3f2c0d912a0f686b` · length **matches** (immutables aside, source shape is correct)

### LiquidityVault

- **Address:** `0xf5a5ca0981c575a2a49e016ea7d0f69c67dd1771`
- **Contract name (for the form):** `src/core/LiquidityVault.sol:LiquidityVault`
- **Standard JSON Input:** `docs/verification/1952/standard-json/LiquidityVault.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a3800000000000000000000000014494c714cb18f24a5fe68c6136203781abb2676000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000175573616e636520536574746c656d656e74205661756c7400000000000000000000000000000000000000000000000000000000000000000000000000000000047555534400000000000000000000000000000000000000000000000000000000`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0x14494C714cB18F24a5FE68c6136203781abb2676`, `Usance Settlement Vault`, `uUSD`
- **Source commit (last touched):** `1263f50` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `10058` bytes · keccak256 `0xa7b9885785c947f9d7cfac8ead184e75d829bde86c78a09bb48b5b26834fea4d`
- **Local build runtime bytecode:** `10058` bytes · keccak256 `0xe4e7df2ecd858c69555fbb1a2cdd0e1121a65feb5bc8ecb77e8690c1dd51e1f0` · length **matches** (immutables aside, source shape is correct)

### FinancingEngine

- **Address:** `0x002fc00ca45afd710ad333e4375402bb55e19327`
- **Contract name (for the form):** `src/core/FinancingEngine.sol:FinancingEngine`
- **Standard JSON Input:** `docs/verification/1952/standard-json/FinancingEngine.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38000000000000000000000000f5a5ca0981c575a2a49e016ea7d0f69c67dd177100000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000000000000000000000000000000000000000003e8`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0xf5A5ca0981C575a2A49e016ea7d0F69c67dd1771`, `(200, 400, 6000, 8000, 1000)`
- **Source commit (last touched):** `7ac8553` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `4540` bytes · keccak256 `0x1a4f4c39a5a03d3ba2b8a2958d8243af70ff73532862e1736df734667cd7cdcd`
- **Local build runtime bytecode:** `4540` bytes · keccak256 `0xdb6edfaea358e02eba798d100284e1422aae6dadc23cb38403c9509202a29bd3` · length **matches** (immutables aside, source shape is correct)

### ClearingHouse

- **Address:** `0xa38c072f7970d70f00c5ad9b911c222357255cc0`
- **Contract name (for the form):** `src/core/ClearingHouse.sol:ClearingHouse`
- **Standard JSON Input:** `docs/verification/1952/standard-json/ClearingHouse.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a3800000000000000000000000070d4fcd5414ed20538f1778f7028dc949409958d0000000000000000000000003d5ce1e17451134e6748b896e6f0ab1dbae0cd50000000000000000000000000c1e338ab59b450738108e8643ea73e2696c8d55200000000000000000000000068a29192aeac5415d991b0f72edf1ded135bcb7a000000000000000000000000f5a5ca0981c575a2a49e016ea7d0f69c67dd1771000000000000000000000000002fc00ca45afd710ad333e4375402bb55e1932700000000000000000000000011d4a1ed14f8883a6ca40ff01d9543cd7cc09ebc`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0x70d4FCd5414ED20538F1778f7028dc949409958D`, `0x3D5Ce1e17451134e6748B896e6f0Ab1dBAe0cd50`, `0xC1e338ab59b450738108e8643eA73e2696C8d552`, `0x68a29192aEac5415D991B0f72eDf1DEd135Bcb7a`, `0xf5A5ca0981C575a2A49e016ea7d0F69c67dd1771`, `0x002Fc00cA45afD710AD333E4375402BB55e19327`, `0x11D4a1eD14f8883A6CA40FF01D9543cD7cc09eBc`
- **Source commit (last touched):** `252d7aa` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `24490` bytes · keccak256 `0x81bb4560170a196ad2183a88ad2f18cd394ddd68a789d73a490dbc307b004829`
- **Local build runtime bytecode:** `24490` bytes · keccak256 `0xa9e6f3f0bc67ad8d22c0a5587cb23c96b71918010f6e133ef2118c300f34561a` · length **matches** (immutables aside, source shape is correct)

### FeeController

- **Address:** `0x44fe9a83186c4c9fc20f14342b10b59861ad1961`
- **Contract name (for the form):** `src/core/FeeController.sol:FeeController`
- **Standard JSON Input:** `docs/verification/1952/standard-json/FeeController.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38000000000000000000000000c1e338ab59b450738108e8643ea73e2696c8d552000000000000000000000000dd280e77039d504b9ce648b300964aca36651b48`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0xC1e338ab59b450738108e8643eA73e2696C8d552`, `0xDd280E77039d504B9cE648b300964acA36651b48`
- **Source commit (last touched):** `0598ada` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `4742` bytes · keccak256 `0xdc797bf69403d64f33bd8edaa73fe2cf36b5f14f5f5ee0c2546560f7914849dd`
- **Local build runtime bytecode:** `4742` bytes · keccak256 `0xd4cfa8951b0d1ac8b4ecad48a4f5b22475b19d911cc6399c55825fdac605722c` · length **matches** (immutables aside, source shape is correct)

### MandateRegistry

- **Address:** `0x71dd68dfc114be35d5fdb524aa21b9d699e9cf5b`
- **Contract name (for the form):** `src/core/MandateRegistry.sol:MandateRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/MandateRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`
- **Source commit (last touched):** `7ac8553` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `12372` bytes · keccak256 `0x041c8da5c773c4b4dcf6ac2a358176d7c19813be6446cefe2c7fabbffc5b7007`
- **Local build runtime bytecode:** `12372` bytes · keccak256 `0x121ce28df200cf9173152807a33efaafaa6eacd47b1fa13517f043e12e80df37` · length **matches** (immutables aside, source shape is correct)

### DelegationGateway

- **Address:** `0x1fe2f202d0ce10d20f3a8470c4cab51d45993659`
- **Contract name (for the form):** `src/core/DelegationGateway.sol:DelegationGateway`
- **Standard JSON Input:** `docs/verification/1952/standard-json/DelegationGateway.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38000000000000000000000000a38c072f7970d70f00c5ad9b911c222357255cc000000000000000000000000071dd68dfc114be35d5fdb524aa21b9d699e9cf5b`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0xA38C072F7970d70f00C5AD9b911C222357255cc0`, `0x71dd68dFc114BE35D5FDb524aA21b9D699e9Cf5b`
- **Source commit (last touched):** `252d7aa` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `2759` bytes · keccak256 `0x600b6e456706b3a80062b4a8370251e1df6919a22f408622c16e2553a0ddd638`
- **Local build runtime bytecode:** `2759` bytes · keccak256 `0xddb39721968e31757271ab6771f8c6f987233e30b2f58edcc58770e93b62fbff` · length **matches** (immutables aside, source shape is correct)

### IntentBook

- **Address:** `0x35eaa2f92045eb6ced6817a296a7ddf701854442`
- **Contract name (for the form):** `src/core/IntentBook.sol:IntentBook`
- **Standard JSON Input:** `docs/verification/1952/standard-json/IntentBook.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a3800000000000000000000000071dd68dfc114be35d5fdb524aa21b9d699e9cf5b000000000000000000000000a38c072f7970d70f00c5ad9b911c222357255cc0`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0x71dd68dFc114BE35D5FDb524aA21b9D699e9Cf5b`, `0xA38C072F7970d70f00C5AD9b911C222357255cc0`
- **Source commit (last touched):** `7ac8553` · package built from `4f76259` · deployed from broadcast at `cf08fa1`
- **Expected on-chain runtime bytecode:** `7873` bytes · keccak256 `0x67697b1da03815e3e45023065c66b29b0fa1adb0cc79680c9537e4ffeafda49f`
- **Local build runtime bytecode:** `7873` bytes · keccak256 `0x1bbf6e68a289d33bd2481d026ae2e2a2c9c89e0d75ec7da10b69b7bcdec6f801` · length **matches** (immutables aside, source shape is correct)

### SentinelTemplateRegistry

- **Address:** `0xd8e1c67cf2b3ae98e414d937653a51556432c275`
- **Contract name (for the form):** `src/core/SentinelTemplateRegistry.sol:SentinelTemplateRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/SentinelTemplateRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`
- **Source commit (last touched):** `97129e4` · package built from `4f76259` · deployed from broadcast at `a3d89fe`
- **Expected on-chain runtime bytecode:** `4440` bytes · keccak256 `0x36b70bfda40cdf04fd2cacc12d1b9328ac7f10657d097ec0b1dad3449fb8e6be`
- **Local build runtime bytecode:** `4440` bytes · keccak256 `0xb18dc8b10a2a24c74e516ef47a001842d649f6e31686d355c425ac1d16ef4f11` · length **matches** (immutables aside, source shape is correct)

### SentinelInstanceRegistry

- **Address:** `0x882c941a94cab3d1c40ec5ac5d1d7d3499436d08`
- **Contract name (for the form):** `src/core/SentinelInstanceRegistry.sol:SentinelInstanceRegistry`
- **Standard JSON Input:** `docs/verification/1952/standard-json/SentinelInstanceRegistry.json`
- **Constructor arguments (ABI-encoded):** `0x000000000000000000000000263c72eabe2d0d323ea9dce71c80c75f673d5a38000000000000000000000000d8e1c67cf2b3ae98e414d937653a51556432c275`
- **Constructor arguments (decoded):** `0x263c72Eabe2D0D323Ea9DCE71c80c75F673D5a38`, `0xD8E1c67cf2b3ae98e414D937653A51556432c275`
- **Source commit (last touched):** `97129e4` · package built from `4f76259` · deployed from broadcast at `a3d89fe`
- **Expected on-chain runtime bytecode:** `4596` bytes · keccak256 `0x5eb3d0b7047de5cd14ab5c6db8e76ebecbead2b62dba061ebe5d7306fe3ed0ae`
- **Local build runtime bytecode:** `4596` bytes · keccak256 `0x9de22fc9181058450d2ef6cd83ce07922716e17fcbfe340be1ee38198349aec4` · length **matches** (immutables aside, source shape is correct)

